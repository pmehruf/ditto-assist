/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Import types & engine logic
import { getPlanConfig, MatchOutput } from "./src/types.js";
import { classifyDeterministic, sanitizeOutput, applyPostGuards, finalizeOutput, resolvePlanQuestion } from "./src/engine.js";
import { getGoogleAuthUrl, exchangeCodeForIdentity } from "./src/server/auth/googleOAuth.js";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./src/server/auth/session.js";
import { attachUser } from "./src/server/auth/middleware.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);
app.use("/assets", express.static(path.join(process.cwd(), "assets")));

const PORT = Number(process.env.PORT) || 3000;
// Lazy initialization of GoogleGenAI as suggested in Environment constraints
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return aiClient;
}

// 1. API Route: Match PED to Policy questionnaire
app.post("/api/match", async (req, res) => {
  try {
    const { planName, ped } = req.body;

    if (!planName || !ped) {
      return res.status(400).json({ error: "Missing planName or ped in request body" });
    }

    const PLAN_CONFIG = getPlanConfig();
    const config = PLAN_CONFIG[planName];

    if (!config) {
      return res.status(400).json({ error: `Insurance plan '${planName}' not supported.` });
    }

    // A. Check Deterministic Engine first!
    let output = classifyDeterministic(ped, planName, config);

    if (output) {
      // Deterministic processing path
      output = sanitizeOutput(output, ped, config);
      output = applyPostGuards(output, ped, planName, config);
      const finalResult = finalizeOutput(output, ped, config, config.questions);
      return res.json({
        ...finalResult,
        source: "Deterministic Engine"
      });
    }

    // B. Call Gemini API Fallback
    const ai = getAiClient();
    const numberedQuestions = config.questions.map((q, i) => `${i + 1}. ${q}`);

    const prompt = [
      "You are an expert Chief Medical Underwriter mapping a pre-existing disease (PED) to a health insurance questionnaire.",
      "Your primary directive is STRICT DETERMINISTIC ROUTING based on clinical pathology. Never guess, stretch definitions, or over-diagnose.",
      "",
      "CRITICAL UNDERWRITING FIREWALLS (MUST OBEY):",
      "1. AMBIGUOUS SYMPTOMS SHIELD: Return question_number 0 ONLY for subjective, generic complaints (e.g., body pain, weakness, nausea, dizziness, acidity). DO NOT trigger this shield for named clinical syndromes/phenomena (e.g., Raynaud's phenomenon, Bell's palsy). Named syndromes are definitive diagnoses and must be mapped to their appropriate medical category.",
      "2. SYSTEMIC & AUTOIMMUNE: Connective tissue, systemic, or autoimmune disorders (e.g., Lupus, Vasculitis, Raynaud's, Scleroderma) must map to questions explicitly covering 'Immunity' or 'Autoimmune'. If the specific plan lacks such a broad question, return 0.",
      "3. DIAGNOSTIC/LAB SHIELD: If the input is merely a lab finding (e.g., high SGPT, eosinophilia, hba1c 6.5) without an underlying named disease, return 0.",
      "4. VENOUS VS ARTERIAL: Venous conditions (Varicose Veins, DVT) are NOT primary cardiac diseases. Do not map them to Heart/Arterial questions. Return 0.",
      "5. BENIGN GROWTHS: Do not map benign cysts, lipomas, or polyps to 'Cancer' or 'Malignancy' questions. Return 0 unless the question explicitly includes benign tumors.",
      "6. LIFESTYLE HABITS: Habits (smoking, drinking) or non-medical life stages (pregnancy, routine checkups) must return 0.",
      "7. LOW CONFIDENCE / AMBIGUITY SHIELD: If a condition spans multiple organ systems, could logically map to more than one question, or you have to 'stretch' the clinical definition to force a fit, DO NOT GUESS. You must set match_type to 'ESCALATE', question_number to 0, and list the exact candidate questions causing the conflict in 'confused_questions'.",
      "8. INVALID / TYPO SHIELD (USE YOUR INTELLIGENCE): If the input is heavily misspelled, unrecognizable as a valid medical term, or complete gibberish (e.g., 'Deep vein erithro clocasia', 'asdfgh'), DO NOT classify it as a symptom. You must call out the error. Set match_type to 'INVALID' and question_number to 0.",
      "9. SPECIFIC ORGANS FIREWALL: If the plan does NOT have a question explicitly mentioning a particular organ or system (e.g. skin, endocrine/thyroid, blood/coagulation, ear/nose/throat (ENT), lipids/cholesterol, musculoskeletal etc.), do NOT map diseases of that organ to other unrelated/different categories. You MUST use question_number: 0 and match_type: 'FALLBACK'.",
      "10. MAIN QUESTIONS PRIORITIZATION: Do NOT include 'Any other...' or 'Other Medical conditions' (general fallback) or 'Umbrella' questions (general tests, medication, surgery, or hospitalization) in the 'confused_questions' list or use them to trigger an ESCALATE. First map against specific main category questions. Only use the general/fallback and umbrella options if all specific main categories are clinically ruled out. Never compare a specific main category question against fallback/umbrella questions.",
      "",
      "CRITICAL EXPLANATION TEMPLATES (USE EXACTLY IF TRIGGERED):",
      "If you returned 0 specifically because of the Ambiguous Symptoms Shield (Rule 1), your explanation MUST be exactly:",
      `"*${ped}* is a clinical symptom or general finding, not a definitive medical diagnosis.\\\\n\\\\nBecause this can result from minor, acute, or transient issues, it does not automatically map to a disease category. If an underlying condition has been diagnosed, please declare that specific diagnosis. Otherwise, proceed with the 'Others' section."`,
      "",
      "If you returned match_type 'ESCALATE' specifically because of the Low Confidence / Ambiguity Shield (Rule 7), your explanation MUST exactly follow this structure:",
      `"📝 *${ped}* is <Insert a 1-sentence medical definition>. \\\\nHowever, *it exhibits complex clinical features that could logically map to multiple different categories (or none perfectly).*\\\\n\\\\n🫸🏽If you are not confident about taking a decision independently, please connect with your Mentor/Guide before proceeding,* to avoid any incorrect declaration."`,
      "",
      "If you returned match_type 'INVALID' specifically because of the Invalid / Typo Shield (Rule 8), your explanation MUST exactly follow this structure:",
      `"🤖 Our medical dictionary has officially given up on “${ped}”. \\\\n\\\\n*Kindly confirm the spelling with the customer or check the reports before trying again.🙏🏼*"`
    ].join("\n");

    const systemInstruction = [
      `PLAN: ${planName}`,
      "QUESTIONS TO CHOOSE FROM:",
      numberedQuestions.join("\n"),
      `OTHER / FALLBACK (use question_number: 0): ${config.anyOther}`,
      `PED TO CLASSIFY: ${ped}`,
      "",
      "Response MUST be valid JSON conforming to the requested schema. Ensure 'match_type' is exactly one of 'P1', 'P2', 'FALLBACK', 'ESCALATE', or 'INVALID'."
    ].join("\n");

    // Perform highly resilient content generation with auto-retries & multiple model fallbacks
    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
    let response: any = null;
    let lastError: any = null;

    for (const model of modelsToTry) {
      let attempts = 0;
      while (attempts < 3) {
        try {
          console.log(`Calling Gemini API (model: ${model}, attempt ${attempts + 1})...`);
          response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction,
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  ped_input: {
                    type: Type.STRING,
                    description: "The exact PED medical term that was queried."
                  },
                  match_type: {
                    type: Type.STRING,
                    description: "Must be 'P1', 'P2', 'FALLBACK', 'ESCALATE', or 'INVALID'."
                  },
                  question_number: {
                    type: Type.INTEGER,
                    description: "The 1-based question number index from the given list of questions. Set to 0 if match_type is 'FALLBACK', 'ESCALATE', or 'INVALID'."
                  },
                  explanation: {
                    type: Type.STRING,
                    description: "Provide the clinical justification or template explanation text."
                  },
                  confused_questions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING
                    },
                    description: "Only when match_type is 'ESCALATE', list the exact candidate questions from the questionnaire that the clinical condition could map to, which caused the ambiguity."
                  }
                },
                required: ["ped_input", "match_type", "question_number", "explanation"]
              }
            }
          });
          break; // Succeeded! Break out of retry loop
        } catch (err: any) {
          lastError = err;
          const errMsg = err.message || String(err);
          console.warn(`Attempt failed with model ${model}: ${errMsg}`);
          
          const isTransient = /demand|unavailable|temporary|quota|limit|exhausted/i.test(errMsg);
          if (isTransient) {
            attempts++;
            if (attempts < 3) {
              await new Promise(r => setTimeout(r, 600 * attempts));
              continue;
            }
          }
          break; // Non-transient or exhausted retries: try next model
        }
      }
      if (response) break; // Break out of model loop if succeeded
    }

    if (!response) {
      throw lastError || new Error("Failed to get response from Gemini API across models and retries");
    }

    const text = response.text;
    if (!text) {
      throw new Error("No response returned from the Gemini API model.");
    }

    const result = JSON.parse(text);

    // Turn numeric selection back into a question string mapping
    let matched_question = config.anyOther;
    let match_type: MatchOutput["match_type"] = "FALLBACK";

    if (result.match_type === "ESCALATE") {
      matched_question = "Unable to Conclude";
      match_type = "ESCALATE";
    } else if (result.match_type === "INVALID") {
      matched_question = "Invalid Medical Term";
      match_type = "INVALID";
    } else {
      const qNum = parseInt(result.question_number, 10);
      if (!isNaN(qNum) && qNum > 0 && qNum <= config.questions.length) {
        matched_question = config.questions[qNum - 1];
        match_type = (result.match_type || "P1") as MatchOutput["match_type"];
      } else {
        matched_question = config.anyOther;
        match_type = "FALLBACK";
      }
    }

    let parsedOutput: MatchOutput = {
      ped_input: result.ped_input || ped,
      match_type,
      matched_question,
      explanation: result.explanation || "No explanation provided by AI.",
      confused_questions: result.confused_questions || []
    };

    // Apply global post-processing sanitization and post-guards
    parsedOutput = sanitizeOutput(parsedOutput, ped, config);
    parsedOutput = applyPostGuards(parsedOutput, ped, planName, config);
    const finalResult = finalizeOutput(parsedOutput, ped, config, config.questions);

    return res.json({
      ...finalResult,
      source: "Live Gemini API"
    });

  } catch (error: any) {
    console.error("Match API Error: ", error);
    // Secure general fallback matching standard Apps Script logic on failure
    const planName = req.body.planName || "Optima Secure";
    const ped = req.body.ped || "";
    const PLAN_CONFIG = getPlanConfig();
    const config = PLAN_CONFIG[planName];

    const fallbackOutput: MatchOutput = {
      match_type: "FALLBACK",
      ped_input: ped,
      matched_question: config ? config.anyOther : "Other Medical conditions",
      explanation: `Live API Failed (${error.message || error}). Treating as unclassified condition.`
    };
    return res.json({
      ...fallbackOutput,
      source: "Match API Error Fallback"
    });
  }
});

// Dynamic route to let the advisor save newly discovered conditions permanently to the codebase
app.post("/api/add-ped-mapping", async (req, res) => {
  try {
    const { ped, category } = req.body;
    if (!ped || !category) {
      return res.status(400).json({ error: "Missing required parameters: ped and category" });
    }

    const pedLower = ped.trim().toLowerCase();
    const pedClean = ped.trim();

    console.log(`[Persisting PED] "${pedClean}" into Category "${category}"`);

    // 1. Update src/types.ts (TOP_PED_DICTIONARY)
    const typesPath = path.join(process.cwd(), "src", "types.ts");
    if (fs.existsSync(typesPath)) {
      let typesContent = fs.readFileSync(typesPath, "utf-8");
      
      // Ensure key doesn't already exist in TOP_PED_DICTIONARY (by word-boundary or quote bounds)
      const alreadyInDict = typesContent.includes(`"${pedLower}":`) || typesContent.includes(`'${pedLower}':`);
      if (!alreadyInDict) {
        const targetStr = `"gerd": "digestive"`;
        if (typesContent.includes(targetStr)) {
          // Replace "gerd": "digestive" with "gerd": "digestive",\n  "new_ped": "category"
          typesContent = typesContent.replace(
            targetStr,
            `"gerd": "digestive",\n  "${pedLower}": "${category}"`
          );
          fs.writeFileSync(typesPath, typesContent, "utf-8");
          console.log(`Success: Added "${pedLower}": "${category}" to TOP_PED_DICTIONARY in types.ts`);
        } else {
          console.warn("Could not find reference anchor in types.ts: " + targetStr);
        }
      } else {
        console.log(`PED "${pedLower}" is already mapped in types.ts`);
      }
    } else {
      console.error("types.ts does not exist at " + typesPath);
    }

    // 2. Update src/constants/scriptDictionary.ts (SCRIPT_DICTIONARY)
    const appPath = path.join(process.cwd(), "src", "constants", "scriptDictionary.ts");
    if (fs.existsSync(appPath)) {
      let appContent = fs.readFileSync(appPath, "utf-8");

      const alreadyInScript = appContent.includes(`"${pedClean}"`) || appContent.includes(`'${pedClean}'`);
      if (!alreadyInScript) {
        const targetStr = `"hba1c 6.5"`;
        if (appContent.includes(targetStr)) {
          // Replace "hba1c 6.5" with "hba1c 6.5",\n  "new_ped"
          appContent = appContent.replace(
            targetStr,
            `"hba1c 6.5",\n  "${pedClean}"`
          );
          fs.writeFileSync(appPath, appContent, "utf-8");
          console.log(`Success: Added "${pedClean}" to SCRIPT_DICTIONARY in scriptDictionary.ts`);
        } else {
          console.warn("Could not find reference anchor in scriptDictionary.ts: " + targetStr);
        }
      } else {
        console.log(`PED "${pedClean}" is already listed in scriptDictionary.ts`);
      }
    } else {
      console.error("scriptDictionary.ts does not exist at " + appPath);
    }

    return res.json({ success: true, ped: pedClean, category });
  } catch (err: any) {
    console.error("Error in add-ped-mapping API: ", err);
    return res.status(500).json({ error: `Internal codebase modification failure: ${err.message}` });
  }
});

// AI Workflow for Add Plan
app.post("/api/ai-plan-workflow", async (req, res) => {
  try {
    const { planName, insurerName, questions = [], illnessSchedules = [] } = req.body;
    
    // Fallback results initialized
    let categoryMappings = questions.map((q: any) => {
      const text = q.text || "";
      let mappedCategory: string | null = null;
      if (/diabet|sugar|glucose/i.test(text)) mappedCategory = "diabetes";
      else if (/hyperten|blood pressure\b|bp high|bp\s+high/i.test(text)) mappedCategory = "hypertension";
      else if (/lipid|cholesterol|triglyceride/i.test(text)) mappedCategory = "lipid";
      else if (/asthma|lung|tuberculosis|tb|respiratory|pleura|bronchitis|copd/i.test(text)) mappedCategory = "respiratory";
      else if (/stroke|paralysis|epilepsy|fits|seizure|neurolog|brain|spinal cord/i.test(text)) mappedCategory = "neuro";
      else if (/psychiatr|mental|depress|anxiety|insomnia/i.test(text)) mappedCategory = "psychiatric";
      else if (/ulcer|digestive|stomach|intestine|piles|fissure|fistula|appendix/i.test(text)) mappedCategory = "digestive";
      else if (/liver|jaundice|gall|hepatitis/i.test(text)) mappedCategory = "liver";
      else if (/kidney|renal|urinary|prostate|dialysis/i.test(text)) mappedCategory = "kidney";
      else if (/reproduct|ovarian|uterus|cervix|prostate|pcod|semen/i.test(text)) mappedCategory = "reproductive";
      else if (/thyroid|endocrine|gland|goiter|pituitary/i.test(text)) mappedCategory = "endocrine";
      else if (/blood disorder|anaemia|anemia|haemophilia|thalassaemia|genetic/i.test(text)) mappedCategory = "blood";
      else if (/skin|psoriasis|dermatitis|keloid/i.test(text)) mappedCategory = "skin";
      else if (/cancer|tumour|tumor|cyst|polyp|growth/i.test(text)) mappedCategory = "neoplasm";
      else if (/autoimmune|sle|lupus|rheumatoid arthritis/i.test(text)) mappedCategory = "autoimmune";
      else if (/ear|nose|throat|tonsil|sinus/i.test(text)) mappedCategory = "ent";
      else if (/eye|vision|cataract|glaucoma/i.test(text)) mappedCategory = "eye";

      return {
        question: text,
        mappedCategory,
        confidence: mappedCategory ? "HIGH" : "MEDIUM",
        explanation: mappedCategory ? `Matched category "${mappedCategory}" based on keyword rules` : "No direct keyword match found."
      };
    });

    let illnessMappings = illnessSchedules.map((ill: any) => {
      const text = ill.scheduleText || "";
      const isValid = text.trim().length > 5;
      return {
        illnessId: ill.illnessId,
        illnessName: ill.illnessId,
        isValid,
        notes: isValid ? "Schedule wording is structured and clear." : "Wording is empty or lacks specificity."
      };
    });

    // Attempt Gemini call
    try {
      if (process.env.GEMINI_API_KEY) {
        const ai = getAiClient();
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Analyze this health insurance plan questionnaire and its custom waiting period schedules.
          
          Plan Name: "${planName}"
          Insurer: "${insurerName}"
          
          Questions:
          ${JSON.stringify(questions, null, 2)}
          
          Custom Waiting Period Illness Schedules:
          ${JSON.stringify(illnessSchedules, null, 2)}

          Respond with a JSON object containing:
          1. "categoryMappings": array of objects, each having { "question": string, "mappedCategory": string | null, "confidence": "HIGH"|"MEDIUM"|"LOW", "explanation": string }
          2. "illnessMappings": array of objects, each having { "illnessId": string, "illnessName": string, "isValid": boolean, "notes": string }

          Map question to one of these flat category keys: 'diabetes', 'hypertension', 'lipid', 'respiratory', 'neuro', 'psychiatric', 'digestive', 'liver', 'kidney', 'reproductive', 'endocrine', 'blood', 'skin', 'neoplasm', 'autoimmune', 'ent', 'eye'.
          Ensure validity checks verify if waiting periods are explicit. Output valid JSON only.`,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        });

        if (response && response.text) {
          const parsed = JSON.parse(response.text.trim());
          if (parsed.categoryMappings) categoryMappings = parsed.categoryMappings;
          if (parsed.illnessMappings) illnessMappings = parsed.illnessMappings;
        }
      }
    } catch (gErr) {
      console.warn("Gemini AI workflow fallback triggered:", gErr);
    }

    return res.json({
      success: true,
      categoryMappings,
      illnessMappings
    });
  } catch (err: any) {
    console.error("AI workflow API execution error:", err);
    return res.status(500).json({ error: `Internal AI workflow error: ${err.message}` });
  }
});

// --- Google Workspace OAuth (Phase 4b) ---
// Restricted to @joinditto.in accounts; see src/server/auth/googleOAuth.ts for
// the server-side domain enforcement (the `hd` URL param alone is not a
// security boundary).
const OAUTH_STATE_COOKIE = "ditto_oauth_state";
const isProdEnv = () => process.env.NODE_ENV === "production";

app.get("/api/auth/google/login", (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000, // 5 minutes: just long enough to complete the redirect round-trip
    });
    res.redirect(getGoogleAuthUrl(state));
  } catch (err: any) {
    console.error("Failed to start Google OAuth flow:", err);
    res
      .status(500)
      .send(
        "Sign-in is not configured yet. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example."
      );
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE);

  try {
    const { code, state } = req.query;
    if (!code || typeof code !== "string" || !state || state !== expectedState) {
      res.status(400).send("Invalid or expired sign-in attempt. Please try signing in again.");
      return;
    }

    const identity = await exchangeCodeForIdentity(code);
    const token = createSessionToken(identity);
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.redirect("/");
  } catch (err: any) {
    console.error("Google OAuth callback failed:", err);
    res
      .status(401)
      .send(
        `Sign-in failed: ${err.message || "unknown error"}. Please try again with a @joinditto.in Google Workspace account.`
      );
  }
});

app.get("/api/auth/session", (req, res) => {
  if (!req.user) {
    res.status(401).json({ user: null });
    return;
  }
  res.json({ user: req.user });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

// Helper function to safely serve files only if they exist on disk, preventing ENOENT stat crashes
function safeSendFile(filePath: string, res: any) {
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
}

// Route to serve the shared mascot and assistant images from the assets/.aistudio folder
app.get("/input_file_:id.png", (req, res) => {
  const id = req.params.id;
  const filePath = path.join(process.cwd(), "assets", ".aistudio", `input_file_${id}.png`);
  safeSendFile(filePath, res);
});

// Route to serve the doctor mascot image from the assets/.aistudio folder
app.get("/doctor_mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "doctor-mascot.png");
  safeSendFile(filePath, res);
});

// Route to serve the payment questions placeholder image
app.get("/payment_questions.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "payment questions.png");
  safeSendFile(filePath, res);
});
app.get("/payment-questions.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "payment questions.png");
  safeSendFile(filePath, res);
});
app.get("/payment%20questions.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "payment questions.png");
  safeSendFile(filePath, res);
});

// Route to serve the narrative mascot image from the assets/.aistudio folder
app.get("/narrative_mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "narrative mascot.png");
  safeSendFile(filePath, res);
});
app.get("/narrative%20mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "narrative mascot.png");
  safeSendFile(filePath, res);
});
app.get("/assets/.aistudio/narrative%20mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "narrative mascot.png");
  safeSendFile(filePath, res);
});

// Route to serve the guide mascot image from the assets/.aistudio folder
app.get("/guide_mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "GUIDE MASCOT.png");
  safeSendFile(filePath, res);
});
app.get("/guide%20mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "GUIDE MASCOT.png");
  safeSendFile(filePath, res);
});
app.get("/assets/.aistudio/guide_mascot.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "GUIDE MASCOT.png");
  safeSendFile(filePath, res);
});
app.get("/assets/.aistudio/GUIDE%20MASCOT.png", (req, res) => {
  const filePath = path.join(process.cwd(), "assets", ".aistudio", "GUIDE MASCOT.png");
  safeSendFile(filePath, res);
});

// Configure Vite integration or static file rendering
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
