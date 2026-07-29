/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Import types & engine logic
import { getPlanConfig, MatchOutput, CATEGORY_LABELS, CATEGORY_AUTO_MAP_RULES } from "./src/types.js";
import { classifyDeterministic, sanitizeOutput, applyPostGuards, finalizeOutput, resolvePlanDecision, normalizeDictionaryKey, applyHighConfidenceCategoryOverride, type DbDictionarySource } from "./src/engine.js";
import { ensurePedOverridesLoaded, promotePedMappingOverride, unmapPedMappingOverride, inferCategoryKeyForQuestion } from "./src/server/pedMappingLive.js";
import { ensurePedRuntimeCacheLoaded, getDbAliasLookup, planOverrideLookup as dbPlanOverrideLookup } from "./src/server/pedRuntimeCache.js";
import type { Repositories } from "./src/server/db/repositories/index.js";
import { dbRowToPlanConfig } from "./src/server/planConfigUtils.js";
import { getGoogleAuthUrl, exchangeCodeForIdentity } from "./src/server/auth/googleOAuth.js";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./src/server/auth/session.js";
import { attachUser, requireAuth } from "./src/server/auth/middleware.js";
import { getDb } from "./src/server/db/client.js";
import { createRepositories, normalizeCondition } from "./src/server/db/repositories/index.js";
import type { UsersRepository } from "./src/server/db/repositories/index.js";

dotenv.config();

const app = express();

// Cloud Run (and most PaaS hosts) always sit behind a reverse proxy that
// terminates TLS and forwards the real client IP via X-Forwarded-For.
// Without this, express-rate-limit v7 either throws a validation error on
// every request or buckets all traffic under the proxy's single IP instead
// of the real caller's — silently defeating the rate limiter. `1` trusts
// exactly one hop (the platform's own proxy), which matches Cloud Run.
app.set("trust proxy", 1);

// Baseline security headers (audit fix, see Production_Readiness_Audit.md
// Finding 7). CSP is deliberately left off for now rather than guessed at:
// this app renders a lot of inline `style={{...}}` props (see e.g.
// AnnouncementLogPage.tsx) and loads Google Fonts via an @import in
// index.html, both of which a default/strict CSP would silently break with
// no error visible outside a real browser's console — and this environment
// has no way to browser-test that before shipping it. Tightening CSP is a
// good follow-up, but it needs a dedicated pass with real browser
// verification rather than a blind guess that could break rendering.
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting (audit fix, see Production_Readiness_Audit.md Finding 7):
// every /api/* route gets a generous baseline limit; the Gemini-backed and
// codebase-mutation endpoints (previously reachable with zero auth AND zero
// rate limiting — see Finding 4) get a much tighter one, since those are
// the ones an attacker could otherwise use to run up API costs or spam
// writes.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const expensiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});
app.use("/api", apiLimiter);

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

// dbRowToPlanConfig / PlanOverridesShape moved to
// src/server/planConfigUtils.ts (imported above) — a script that only needs
// this one pure helper (scripts/validatePedMigration.ts, Phase 4) can no
// longer accidentally import server.ts's top-level app.listen()/Vite
// dev-server side effects along with it.

// ─────────────────────────────────────────────────────────────────────────
// Three-level lookup memory — versioning constants.
//
//   L1  Deterministic Engine  (engine.ts — unchanged, always wins)
//   L2  AI Memory             (ai_memory table — cache + human governance)
//   L3  Gemini                (only on an L1 + L2 miss)
//
// ENGINE_VERSION is part of the L2 cache key. Bump it whenever the
// deterministic engine's classification behaviour changes (new/edited regex
// section, dictionary routing, shields, post-guards). Bumping naturally
// invalidates every previously cached AI answer — the new key simply misses,
// so a condition the updated engine can now resolve deterministically stops
// being served from a stale AI cache entry.
//
// PROMPT_VERSION is recorded per entry so the queue can show which prompt
// produced an answer; bump it when the /api/match prompt text changes.
// ─────────────────────────────────────────────────────────────────────────
const ENGINE_VERSION = "2026-07-18.1";
const PROMPT_VERSION = "match-v1";

// ─────────────────────────────────────────────────────────────────────────
// PED Repository DB migration, Phase 3 (PED_REPOSITORY_DB_MIGRATION_DESIGN.md
// §3/§4) — runtime cutover feature flag. Defaults to "legacy" (today's
// exact behavior: TOP_PED_DICTIONARY + the 4 hardcoded plan-specific
// blocks in engine.ts) so nothing about production behavior changes just
// from this code shipping. Only an explicit `PED_SOURCE=db` env var flips
// classifyDeterministic over to reading src/server/pedRuntimeCache.ts's
// DB-backed alias/plan-override cache instead. Per the rollback strategy in
// the design doc, flipping this back to "legacy" (env var change + restart,
// no deploy) is the cheapest rollback path if the DB-backed path ever
// misbehaves — that's the whole reason this is a flag and not a code
// branch decided at build time. Stays on "legacy" until Phase 4's cutover
// validation report has been reviewed and Checkpoint B is explicitly
// signed off.
const PED_SOURCE: "legacy" | "db" = process.env.PED_SOURCE === "db" ? "db" : "legacy";

/**
 * Builds the optional 4th argument for classifyDeterministic. Returns null
 * on the default "legacy" flag setting (classifyDeterministic behaves
 * exactly as it always has) or if the DB-backed cache hasn't loaded for any
 * reason — a failed/slow DB cache load must never break matching, so this
 * degrades to the legacy path rather than throwing.
 */
async function getDbSource(repos: Pick<Repositories, "pedAliases" | "pedRepository" | "categories" | "planOverrides">): Promise<DbDictionarySource | null> {
  if (PED_SOURCE !== "db") return null;
  try {
    await ensurePedRuntimeCacheLoaded(repos);
    return { aliasLookup: getDbAliasLookup(), planOverrideLookup: dbPlanOverrideLookup };
  } catch (err) {
    console.error("Failed to build DB-backed classifyDeterministic source (falling back to legacy dictionary):", err);
    return null;
  }
}

// 1. API Route: Match PED to Policy questionnaire
app.post("/api/match", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    const { planName, ped } = req.body;

    if (!planName || !ped) {
      return res.status(400).json({ error: "Missing planName or ped in request body" });
    }

    const repos = createRepositories(getDb());
    const {
      planConfigs: planConfigsRepo,
      pedMappingOverrides: pedOverridesRepo,
      aiMemory: aiMemoryRepo,
    } = repos;
    await ensurePedOverridesLoaded(pedOverridesRepo);
    const dbSource = await getDbSource(repos);

    const PLAN_CONFIG = getPlanConfig();
    let config = PLAN_CONFIG[planName];

    // DB-authored plans (added or edited via the Add/Edit Plan wizard) are
    // the live source of truth and take precedence over the hardcoded
    // bootstrap defaults — this is what lets a newly-added plan be matched
    // against immediately, with no code change or redeploy.
    try {
      const dbPlan = await planConfigsRepo.get(planName);
      if (dbPlan) config = dbRowToPlanConfig(dbPlan);
    } catch (err) {
      console.error("Failed to load DB plan config (falling back to hardcoded defaults if any exist):", err);
    }

    if (!config) {
      return res.status(400).json({ error: `Insurance plan '${planName}' not supported.` });
    }

    // ── LEVEL 1 ── Deterministic Engine. Highest priority, unchanged.
    // If this resolves, we return immediately: no AI Memory read, no Gemini.
    // `dbSource` is null unless PED_SOURCE=db — see getDbSource above.
    let output = classifyDeterministic(ped, planName, config, dbSource);

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

    // ── LEVEL 2 ── AI Memory. Consulted only because L1 could not classify
    // this PED. A hit means Gemini is NOT called again for this
    // (condition, plan, engineVersion) triple. This layer can never override
    // an L1 result — L1 has already returned above if it matched.
    const normalizedPed = normalizeCondition(ped);
    let cached: Awaited<ReturnType<typeof aiMemoryRepo.findCached>> = undefined;
    try {
      cached = await aiMemoryRepo.findCached(normalizedPed, planName, ENGINE_VERSION);
    } catch (err: any) {
      // A cache failure must never break a lookup — fall through to Gemini.
      // Called out loudly because the fallback is invisible from the UI: the
      // advisor still gets an answer, so a broken L2 looks like "working"
      // while silently re-billing Gemini on every repeat lookup.
      const missingTable = /relation .*ai_memory.* does not exist/i.test(err?.message || "");
      console.error(
        missingTable
          ? "[AI MEMORY] Table 'ai_memory' is missing — L2 cache is INACTIVE (every lookup will call Gemini and nothing will reach AI Mapping Review). Run: npm run db:migrate"
          : "[AI MEMORY] Cache read failed (continuing to Gemini):",
        missingTable ? "" : err
      );
    }

    if (cached && cached.status !== "archived") {
      const storedResult = (cached.aiResponse as { result?: MatchOutput } | null)?.result;

      // Guard: a cached answer is only reusable if the question it points at
      // still exists in this plan. Plan questions can be edited after an
      // entry was cached; serving a question that no longer exists would be
      // worse than re-asking. Anything else is treated as a cache miss.
      const pointsAtLiveQuestion =
        !!storedResult &&
        (storedResult.matched_question === config.anyOther ||
          config.questions.includes(storedResult.matched_question) ||
          ["Unable to Conclude", "Invalid Medical Term", "No questions applicable"].includes(
            storedResult.matched_question
          ));

      if (cached.status === "rejected") {
        // An admin rejected this AI answer. Do NOT re-ask Gemini (that's the
        // whole point of recording the rejection) and do NOT serve the
        // rejected mapping — tell the advisor it needs manual review.
        try {
          await aiMemoryRepo.touch(cached.id);
        } catch (_) {}
        return res.json({
          ped_input: ped,
          match_type: "FALLBACK",
          matched_question: config.anyOther,
          explanation:
            `*"${ped}" has been flagged for manual review.*\n\n` +
            `A previous AI-suggested mapping for this condition was reviewed and rejected, so no automated ` +
            `mapping is available. Please confirm the correct declaration with your Mentor/Guide before proceeding, ` +
            `and declare under the 'Others Section' if no specific question applies.`,
          confused_questions: [],
          source: "AI Memory (Rejected — Manual Review Required)",
        });
      }

      if (pointsAtLiveQuestion) {
        // Same HIGH-confidence Plan Decision Engine override applied on the
        // live Gemini path, applied here too (2026-07-29): a cached
        // "pending" answer recorded before this rule existed (or before a
        // plan's category mapping was added/fixed) must be corrected on
        // replay, not just on the next brand-new lookup — otherwise every
        // repeat search for the same condition would keep serving the
        // stale answer indefinitely via L2. Never applied to "approved"
        // entries — those reflect an explicit human review decision and
        // are left untouched.
        let toServe = storedResult;
        if (cached.status !== "approved" && storedResult) {
          try {
            const override = applyHighConfidenceCategoryOverride(
              storedResult.matched_question,
              storedResult.match_type,
              cached.suggestedCategoryKey,
              cached.confidence,
              config,
              ped
            );
            if (override.applied) {
              console.log(
                `[Plan Decision Engine] Replaying cached "${ped}" answer with HIGH-confidence category "${cached.suggestedCategoryKey}" — ` +
                  `applying Plan Decision Engine routing "${override.matchedQuestion}" in place of the previously cached "${storedResult.matched_question}".`
              );
              toServe = {
                ...storedResult,
                match_type: override.matchType,
                matched_question: override.matchedQuestion,
                explanation: override.explanation || storedResult.explanation,
                confused_questions: [],
              };
            }
          } catch (err) {
            console.error("[Plan Decision Engine] Cross-check against cached identified_category failed (non-fatal):", err);
          }
        }
        try {
          await aiMemoryRepo.touch(cached.id);
        } catch (_) {}
        return res.json({
          ...toServe,
          source:
            cached.status === "approved"
              ? "AI Memory (Approved)"
              : "AI Memory (Pending Approval)",
        });
      }
      // else: stale question reference — fall through and re-ask Gemini.
    }

    // ── LEVEL 3 ── Gemini. Reached only on an L1 + L2 miss. The answer is
    // recorded into AI Memory as 'pending' below so this costs one call, once.
    //
    // Approved architecture (2026-07-29), Rule 4/6: Gemini's role is
    // classification, not insurer-specific routing — it should only step in
    // when deterministic repository knowledge is insufficient (PED not
    // found, or found but uncategorized), never to re-decide a plan's own
    // routing for a category the repository already knows. The actual
    // question selection below is unchanged from before this review (see
    // PED_REPOSITORY_PHASE5_CUTOVER_REPORT.md-adjacent architecture review
    // for why a full rewrite of Gemini's ten tuned clinical firewalls around
    // category-only reasoning was judged too high-risk to do in this pass).
    // What's new: Gemini is ALSO asked for an "identified_category" +
    // "confidence" — a temporary, non-authoritative classification, per
    // Governance Rule 2 ("Gemini must never become a runtime source of
    // truth... must not automatically write into ped_repository / ped_aliases
    // / categories"). That classification is run through the exact same
    // Plan Decision Engine (resolvePlanDecision) a repository-resolved
    // category would use — purely to log agreement/disagreement with
    // Gemini's own directly-selected question, for future tuning and for
    // AI Mapping Review's visibility. It is never used to override or
    // replace the question actually returned to the advisor.
    const ai = getAiClient();
    const numberedQuestions = config.questions.map((q, i) => `${i + 1}. ${q}`);
    let knownCategoryKeys: string[] = [];
    try {
      knownCategoryKeys = (await repos.categories.list()).map((c) => c.categoryKey);
    } catch (err) {
      console.error("[Plan Decision Engine] Failed to load categories for Gemini's classification field (continuing without it):", err);
    }

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
      `"*${ped}* is a clinical symptom or general finding, not a definitive medical diagnosis.\\n\\nBecause this can result from minor, acute, or transient issues, it does not automatically map to a disease category. If an underlying condition has been diagnosed, please declare that specific diagnosis. Otherwise, proceed with the 'Others' section."`,
      "",
      "If you returned match_type 'ESCALATE' specifically because of the Low Confidence / Ambiguity Shield (Rule 7), your explanation MUST exactly follow this structure:",
      `"📝 *${ped}* is <Insert a 1-sentence medical definition>. \\nHowever, *it exhibits complex clinical features that could logically map to multiple different categories (or none perfectly).*\\n\\n🫸🏽If you are not confident about taking a decision independently, please connect with your Mentor/Guide before proceeding,* to avoid any incorrect declaration."`,
      "",
      "If you returned match_type 'INVALID' specifically because of the Invalid / Typo Shield (Rule 8), your explanation MUST exactly follow this structure:",
      `"🤖 Our medical dictionary has officially given up on “${ped}”. \\n\\n*Kindly confirm the spelling with the customer or check the reports before trying again.🙏🏼*"`
    ].join("\n");

    const systemInstruction = [
      `PLAN: ${planName}`,
      "QUESTIONS TO CHOOSE FROM:",
      numberedQuestions.join("\n"),
      `OTHER / FALLBACK (use question_number: 0): ${config.anyOther}`,
      `PED TO CLASSIFY: ${ped}`,
      "",
      "Response MUST be valid JSON conforming to the requested schema. Ensure 'match_type' is exactly one of 'P1', 'P2', 'FALLBACK', 'ESCALATE', or 'INVALID'.",
      "",
      // Additive per the approved Declaration Engine architecture
      // (2026-07-29): a SEPARATE classification, independent of your
      // question_number pick above. This does not change how you should
      // choose question_number — answer that exactly as instructed above.
      knownCategoryKeys.length > 0
        ? `ALSO identify the clinical category this condition belongs to, from this exact list (use "identified_category"; use null if none genuinely fit): ${knownCategoryKeys.join(", ")}. Independently, rate your confidence in this PED identification + category as "HIGH", "MEDIUM", or "LOW" (use "confidence"). This is a clinical classification only — it should reflect the condition's own medical category regardless of whether this plan happens to have a dedicated question for it.`
        : ""
    ].filter(Boolean).join("\n");

    // Perform highly resilient content generation with auto-retries & multiple model fallbacks
    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
    let response: any = null;
    let lastError: any = null;
    // Which model actually produced the answer — recorded on the AI Memory
    // entry so the queue's detail panel can show it.
    let usedModel: string = modelsToTry[0];

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
                  },
                  // Additive fields (approved architecture, 2026-07-29): a
                  // temporary, non-authoritative classification, separate
                  // from question_number above. Never used to override the
                  // question actually returned — see the comment on the
                  // Gemini call below for how this is used (Plan Decision
                  // Engine cross-check + AI Mapping Review visibility only).
                  identified_category: {
                    type: Type.STRING,
                    description: "The clinical category this condition belongs to, from the provided category list. Null/omit if none genuinely fit. Independent of question_number."
                  },
                  confidence: {
                    type: Type.STRING,
                    description: "Your confidence in the PED identification + category above: 'HIGH', 'MEDIUM', or 'LOW'."
                  }
                },
                required: ["ped_input", "match_type", "question_number", "explanation"]
              }
            }
          });
          usedModel = model;
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

    // Approved architecture (2026-07-29), Governance Rule 2 + point 7:
    // Gemini's classification is temporary and non-authoritative — used
    // only for this lookup, never persisted automatically into
    // ped_repository/ped_aliases/categories. Validated against the live
    // `categories` table (keeping Postgres the source of truth for what a
    // valid category even is) rather than trusted verbatim.
    const identifiedCategory: string | null =
      typeof result.identified_category === "string" && knownCategoryKeys.includes(result.identified_category)
        ? result.identified_category
        : null;
    const confidence: string | null =
      typeof result.confidence === "string" && ["HIGH", "MEDIUM", "LOW"].includes(result.confidence.toUpperCase())
        ? result.confidence.toUpperCase()
        : null;

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

    // Route Gemini's temporary classification through the SAME Plan
    // Decision Engine a repository-resolved category would use (point 7).
    // 2026-07-29 update (explicit user request): when Gemini's category
    // confidence is HIGH and the Plan Decision Engine has an unambiguous
    // mapping for that category, show ITS routing to the advisor in place
    // of Gemini's own question selection — mirroring exactly how a
    // repository-resolved category is handled (engine.ts's resolvePlanDecision
    // call site: "direct_question" -> P1, "explicit_catchall" -> FALLBACK).
    // This does not touch Governance Rule 2 — Gemini's classification is
    // still never persisted into ped_repository/ped_aliases/categories,
    // it's only used to pick a better answer for THIS lookup. Below HIGH
    // confidence, or when the Plan Decision Engine has no mapping for the
    // category, behavior is unchanged: Gemini's own selection stands and
    // the disagreement is only logged for review.
    let planDecisionApplied = false;
    let explanationOverride: string | null = null;
    try {
      const override = applyHighConfidenceCategoryOverride(matched_question, match_type, identifiedCategory, confidence, config, ped);
      if (override.applied) {
        console.log(
          `[Plan Decision Engine] Gemini classified "${ped}" as category "${identifiedCategory}" (confidence: HIGH). ` +
            `Applying Plan Decision Engine routing "${override.matchedQuestion}" in place of Gemini's own question selection "${matched_question}".`
        );
        matched_question = override.matchedQuestion;
        match_type = override.matchType;
        explanationOverride = override.explanation;
        planDecisionApplied = true;
      } else if (identifiedCategory) {
        // Not applied — either confidence wasn't HIGH, the Plan Decision
        // Engine has no mapping for this category, or it already agrees
        // with Gemini's own pick. Still worth a diagnostic log when there
        // WAS a real disagreement, for future tuning visibility.
        const planDecision = resolvePlanDecision(identifiedCategory, config, ped, normalizeDictionaryKey(ped));
        if (planDecision.kind !== "no_mapping" && planDecision.question !== matched_question) {
          console.log(
            `[Plan Decision Engine] Gemini classified "${ped}" as category "${identifiedCategory}" (confidence: ${confidence ?? "unknown"}), ` +
              `which this plan's Plan Decision Engine would route to "${planDecision.question}" — but Gemini's own question selection was ` +
              `"${matched_question}". Not auto-corrected (confidence below HIGH); logged for review.`
          );
        }
      }
    } catch (err) {
      console.error("[Plan Decision Engine] Cross-check against Gemini's identified_category failed (non-fatal):", err);
    }

    let parsedOutput: MatchOutput = {
      ped_input: result.ped_input || ped,
      match_type,
      matched_question,
      explanation: explanationOverride || result.explanation || "No explanation provided by AI.",
      confused_questions: planDecisionApplied ? [] : (result.confused_questions || [])
    };

    // Apply global post-processing sanitization and post-guards
    parsedOutput = sanitizeOutput(parsedOutput, ped, config);
    parsedOutput = applyPostGuards(parsedOutput, ped, planName, config);
    const finalResult = finalizeOutput(parsedOutput, ped, config, config.questions);

    // Record into AI Memory (L2) as 'pending', entering the Unknown Condition
    // Queue for manual review. `result` is what future cache hits replay to
    // the advisor; `raw` keeps Gemini's untouched JSON for the queue's detail
    // panel. Write failures are logged but never fail the lookup — worst case
    // the next identical lookup re-asks Gemini.
    try {
      await aiMemoryRepo.recordPending({
        condition: String(ped),
        normalizedCondition: normalizedPed,
        planName,
        engineVersion: ENGINE_VERSION,
        promptVersion: PROMPT_VERSION,
        geminiModel: usedModel || modelsToTry[0],
        aiResponse: { result: finalResult, raw: result },
        status: "pending",
        // Additive (2026-07-29): the schema already had these columns
        // (see schema.ts's ai_memory comment) but this call path never
        // populated them. Surfaced in AI Mapping Review; still requires
        // human approval before anything is promoted — see promotePedMappingOverride's
        // call sites, unchanged by this addition.
        confidence: confidence ?? undefined,
        suggestedCategoryKey: identifiedCategory ?? undefined,
      });
    } catch (err: any) {
      const missingTable = /relation .*ai_memory.* does not exist/i.test(err?.message || "");
      console.error(
        missingTable
          ? "[AI MEMORY] Table 'ai_memory' is missing — this Gemini answer was NOT recorded and will not appear in AI Mapping Review. Run: npm run db:migrate"
          : "[AI MEMORY] Write failed (result still returned to user):",
        missingTable ? "" : err
      );
    }

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

// Dynamic route to let an advisor record a newly-discovered PED -> category
// mapping.
//
// NOTE (audit fix, see Production_Readiness_Audit.md Finding 5): this used
// to splice the raw request body directly into src/types.ts and
// src/constants/scriptDictionary.ts via fs.writeFileSync on the live
// server. That was (a) a code-injection-shaped risk — pedLower/category
// were written into a .ts file with no character validation, so a value
// containing a `"` could corrupt or inject into source that a dev server
// re-evaluates on reload — and (b) silently useless in production, since
// the deployed server runs the pre-built dist/server.cjs bundle, which a
// runtime write to src/types.ts can never change.
//
// DB-backed as of the ped_mapping_overrides table (src/server/db/schema.ts):
// a correction made here is (a) written to Postgres so it survives a
// restart/redeploy, and (b) merged into the in-memory TOP_PED_DICTIONARY
// immediately, so it affects every /api/match call from this moment on
// without waiting for the lazy ensurePedOverridesLoaded() load to happen
// again (that only runs once per process).
const PED_INPUT_MAX_LENGTH = 200;

app.post("/api/add-ped-mapping", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    const { ped, category } = req.body;

    if (typeof ped !== "string" || typeof category !== "string" || !ped.trim() || !category.trim()) {
      return res.status(400).json({ error: "Missing required parameters: ped and category" });
    }

    const pedClean = ped.trim();
    if (pedClean.length > PED_INPUT_MAX_LENGTH) {
      return res.status(400).json({ error: `ped must be ${PED_INPUT_MAX_LENGTH} characters or fewer.` });
    }
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)) {
      return res.status(400).json({ error: `Unknown category "${category}".` });
    }

    const { users: usersRepo, pedMappingOverrides } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    // Routed through the shared helper (also used by PED Library and AI
    // Mapping Review) so this and every other live-override write path stay
    // on one tested, correctly-normalized write path — see pedMappingLive.ts.
    await promotePedMappingOverride(pedMappingOverrides, pedClean, category, `${req.user!.name} (${callerTier})`);

    console.log(`[PED mapping] "${req.user?.email}" recorded "${pedClean}" -> category "${category}" (persisted)`);

    return res.json({ success: true, ped: pedClean, category });
  } catch (err: any) {
    console.error("Error in add-ped-mapping API: ", err);
    return res.status(500).json({ error: `Internal error while recording the mapping: ${err.message}` });
  }
});

// AI Workflow for Add Plan
app.post("/api/ai-plan-workflow", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    const { planName, insurerName, questions = [], illnessSchedules = [] } = req.body;
    
    // Fallback results initialized — CATEGORY_AUTO_MAP_RULES (src/types.ts)
    // is the single source of truth for these keyword rules; it used to be
    // copy-pasted here and (twice, slightly differently) in App.tsx.
    let categoryMappings = questions.map((q: any) => {
      const text = q.text || "";
      const mappedCategory = CATEGORY_AUTO_MAP_RULES.find((r) => r.regex.test(text))?.key ?? null;

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

    // Attempt Gemini call — usedAi tells the caller (Plan Management's
    // "Refine with AI" button) whether this actually ran Gemini or silently
    // fell back to the same keyword rules "Suggest" already ran, so the UI
    // can be honest about it instead of implying a refinement happened when
    // it didn't (e.g. no GEMINI_API_KEY configured).
    let usedAi = false;
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

          Map question to one of these flat category keys: ${CATEGORY_AUTO_MAP_RULES.map((r) => `'${r.key}'`).join(", ")}.

          STRICT MAPPING RULES — a wrong mapping here silently misroutes real
          medical declarations, so err toward "null" over a guess:
          - Only assign a category to a question if that question's own text
            explicitly names the condition(s) belonging to that category, or
            unambiguously and specifically covers the whole category (e.g. a
            question literally saying "any disorder of Blood and/or
            Immunity" covers "autoimmune" generally). A category is NOT a
            match just because the question's general theme is loosely
            related, or because the question happens to name ONE narrow
            condition that could also be filed under that category — narrow
            named conditions belong to their OWN specific category, not the
            broader one. Example: a question listing "...Crohn's disease,
            Ulcerative colitis..." inside an unrelated compound list of named
            diseases (cancer, heart attack, organ failure, etc.) should map
            those two conditions to "digestive", NOT to "autoimmune" —
            "autoimmune" would only apply if the question's wording itself
            is a general immunity/autoimmune question.
          - A single compound question can and often does correctly map to
            MULTIPLE categories (once per condition group it explicitly
            names) — map each one independently based on that specific
            wording, not the question's overall theme.
          - If NO question in this plan genuinely, specifically covers a
            category, set "mappedCategory": null for it rather than forcing
            it onto the closest-sounding question — the app already defaults
            any unmapped category to this plan's own catch-all/"any other"
            question, which is the CORRECT outcome when no dedicated
            question exists. A missing mapping is always safer than a wrong
            one.
          - Set "confidence": "LOW" whenever the match relies on inference
            rather than an explicit word/phrase in the question text, and
            quote the exact phrase that justifies the mapping in
            "explanation" (or state there is none, if "mappedCategory" is
            null).

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
          usedAi = true;
        }
      }
    } catch (gErr) {
      console.warn("Gemini AI workflow fallback triggered:", gErr);
    }

    return res.json({
      success: true,
      categoryMappings,
      illnessMappings,
      usedAi,
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

// ─────────────────────────────────────────────────────────────────────────
// USER DIRECTORY — server-backed source of truth for the org's user list
// (email, name, tactId, tier, status). This is what makes an Developer's edit
// in the UI "actually reflect in the core for all users": the record lives
// in the `users` table (Postgres), not in one browser's localStorage, so
// every client that fetches GET /api/users afterward sees the same data.
//
// This used to be data/users.json on the server's local disk. That was a
// production-durability gap: most hosts (serverless/containers) have an
// ephemeral or read-only filesystem, so writes either didn't persist across
// restarts or failed outright. Moved into Postgres alongside the other four
// audit resources for the same reason those were migrated in Fix 5.
//
// Authorization here is intentionally simple and matches the rest of this
// app's trust model (see session.ts's comment about role checks being a
// "separate, deliberately-not-cached check layered on top of" identity):
// req.user (the verified Google session) tells us WHO is calling; we look
// their tier up in the directory itself to decide WHAT they can do.
// ─────────────────────────────────────────────────────────────────────────

interface DirectoryUser {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Developer";
  status: "Active" | "Disabled";
}

/** Users not yet present in the directory default to "General" — matches the
 * client's existing fallback for a first-time Google sign-in. */
async function getCallerTier(req: any, usersRepo: UsersRepository): Promise<"General" | "Admin" | "Developer"> {
  const email = (req.user?.email as string | undefined)?.toLowerCase();
  if (!email) return "General";
  const match = await usersRepo.findByEmail(email);
  return match?.tier ?? "General";
}

function isValidDirectoryUser(u: any): u is DirectoryUser {
  return (
    u &&
    typeof u.email === "string" &&
    typeof u.name === "string" &&
    typeof u.tactId === "string" &&
    (u.tier === "General" || u.tier === "Admin" || u.tier === "Developer") &&
    (u.status === "Active" || u.status === "Disabled")
  );
}

// Admin and Developer can view the directory; anyone else is refused.
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (callerTier !== "Admin" && callerTier !== "Developer") {
      return res.status(403).json({ error: "The user directory is restricted to Admin and Developer roles." });
    }
    const users = await usersRepo.list();
    return res.json({ users });
  } catch (err: any) {
    console.error("Failed to list the user directory:", err);
    return res.status(500).json({ error: `Failed to load the user directory: ${err.message}` });
  }
});

// Only Developer can edit — Admin gets a read-only view in the UI, enforced
// again here so the restriction can't be bypassed by calling the API directly.
app.put("/api/users", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can edit the user directory." });
    }

    const { users } = req.body;
    if (!Array.isArray(users) || !users.every(isValidDirectoryUser)) {
      return res.status(400).json({ error: "Invalid users payload." });
    }
    if (!users.some((u: DirectoryUser) => u.tier === "Developer")) {
      return res.status(400).json({ error: "At least one user must remain an Developer." });
    }

    // Rebuild each row from only the known directory fields before writing.
    // GET /api/users returns full DB rows (including createdAt/lastLogin,
    // JSON-serialized as strings), the client round-trips whatever it was
    // given back through edits/deletes/adds, and a stray string in a
    // timestamp column crashes Drizzle's insert (it calls .toISOString() on
    // the value, which strings don't have) — never trust the client to send
    // back exactly the columns meant to be written.
    const cleanUsers: DirectoryUser[] = users.map((u: DirectoryUser) => ({
      email: u.email,
      name: u.name,
      tactId: u.tactId,
      tier: u.tier,
      status: u.status,
    }));

    const saved = await usersRepo.replaceAll(cleanUsers);
    return res.json({ success: true, users: saved });
  } catch (err: any) {
    console.error("Failed to persist the user directory:", err);
    return res.status(500).json({ error: "Failed to persist the user directory." });
  }
});

// Admin AND Developer can add a new directory entry (mirrors "Add Plan" staying
// enabled for Admin on the Plan Management page) — unlike the PUT route
// above, this only ever inserts one new row via a single-row create(), so an
// Admin calling it can't smuggle in edits/deletes to other users the way a
// full-array PUT would allow. Editing/removing an EXISTING user is still
// Developer-only, enforced by the PUT/DELETE-via-PUT route above.
app.post("/api/users", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (callerTier !== "Admin" && callerTier !== "Developer") {
      return res.status(403).json({ error: "Only Admin and Developer roles can add users to the directory." });
    }

    const { email, name, tactId, tier, status } = req.body;
    if (!isValidDirectoryUser({ email, name, tactId, tier, status })) {
      return res.status(400).json({ error: "email, name, tactId, tier, and status are all required." });
    }
    // Admin can add users, but shouldn't be able to mint a new Developer from
    // this lightweight endpoint — that's still an Developer-only directory edit.
    if (callerTier === "Admin" && tier === "Developer") {
      return res.status(403).json({ error: "Only the Developer role can grant Developer clearance." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await usersRepo.findByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists in the directory." });
    }

    const row = await usersRepo.create({
      email: normalizedEmail,
      name: name.trim(),
      tactId: tactId.trim(),
      tier,
      status,
    });
    return res.json({ success: true, user: row });
  } catch (err: any) {
    console.error("Failed to add a new directory entry:", err);
    return res.status(500).json({ error: "Failed to add this user." });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// AUDIT FEATURES — search history, change logs, announcements, flagged
// issues. These four resources have had a complete Drizzle schema,
// repository layer, and unit test suite (src/server/db/) since Phase 4, but
// were never wired to any API route — every one of these features actually
// ran on the calling browser's own localStorage (audit fix, see
// Production_Readiness_Audit.md Finding 3). That meant an Admin publishing
// an announcement, or an Developer resolving a flagged issue, only ever updated
// their own browser; nobody else's session would see it. These routes make
// Postgres (via getDb()/createRepositories()) the actual shared source of
// truth, matching the pattern already used correctly by GET/PUT /api/users
// above: identity always comes from the verified session (req.user), never
// from the request body, and tier is always re-derived server-side from
// data/users.json rather than trusted from the client.
// ─────────────────────────────────────────────────────────────────────────

/** Requires Admin or Developer tier; sends a 403 and returns false otherwise. */
async function requireAdminOrDeveloper(req: any, res: any, action: string): Promise<boolean> {
  const { users: usersRepo } = createRepositories(getDb());
  const callerTier = await getCallerTier(req, usersRepo);
  if (callerTier !== "Admin" && callerTier !== "Developer") {
    res.status(403).json({ error: `${action} requires Admin or Developer tier.` });
    return false;
  }
  return true;
}

// --- Search History (powers the Audit tab's full list and My Activity's self-filtered view) ---

app.get("/api/search-history", requireAuth, async (req, res) => {
  try {
    const requestedEmail = typeof req.query.userEmail === "string" ? req.query.userEmail.toLowerCase() : undefined;
    const isSelf = !!requestedEmail && requestedEmail === req.user!.email.toLowerCase();

    // Anyone may view their OWN search history (My Activity); viewing
    // everyone's (Audit tab, no userEmail filter, or someone else's email)
    // requires Admin/Developer, same as the featurePermissions matrix intends.
    if (!isSelf && !(await requireAdminOrDeveloper(req, res, "Viewing other users' search history"))) return;

    const { searchHistory } = createRepositories(getDb());
    const rows = await searchHistory.list({
      userEmail: requestedEmail,
      planName: typeof req.query.planName === "string" ? req.query.planName : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list search history:", err);
    return res.status(500).json({ error: `Failed to load search history: ${err.message}` });
  }
});

app.post("/api/search-history", requireAuth, async (req, res) => {
  try {
    const { planName, pedInput, matchedQuestion, matchType, source, explanation } = req.body;
    if (![planName, pedInput, matchedQuestion, matchType, source, explanation].every((v) => typeof v === "string" && v.length > 0)) {
      return res.status(400).json({ error: "planName, pedInput, matchedQuestion, matchType, source, and explanation are all required strings." });
    }
    const { searchHistory } = createRepositories(getDb());
    const row = await searchHistory.create({
      userEmail: req.user!.email, // identity always from the verified session, never the request body
      planName,
      pedInput,
      matchedQuestion,
      matchType,
      source,
      explanation,
    });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to record search history entry:", err);
    return res.status(500).json({ error: `Failed to save this lookup to history: ${err.message}` });
  }
});

app.delete("/api/search-history", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can clear activity history." });
    }
    const { searchHistory } = createRepositories(getDb());
    await searchHistory.clearAll();
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to clear search history:", err);
    return res.status(500).json({ error: `Failed to clear search history: ${err.message}` });
  }
});

// --- Change Logs (Audit tab's "Modification History" sub-tab) ---

app.get("/api/change-logs", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing the modification history"))) return;
    const { changeLogs } = createRepositories(getDb());
    const rows = await changeLogs.list({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list change logs:", err);
    return res.status(500).json({ error: `Failed to load modification history: ${err.message}` });
  }
});

app.post("/api/change-logs", requireAuth, async (req, res) => {
  try {
    const { actionType, planName, description, snapshot } = req.body;
    if (![actionType, planName, description].every((v) => typeof v === "string" && v.length > 0)) {
      return res.status(400).json({ error: "actionType, planName, and description are required strings." });
    }
    const { users: usersRepo, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const row = await changeLogs.create({
      userName: req.user!.name,
      role: callerTier,
      actionType,
      planName,
      description,
      snapshot: snapshot ?? null,
    });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to record change log entry:", err);
    return res.status(500).json({ error: `Failed to record this action: ${err.message}` });
  }
});

// --- Announcements (QA Announcement Log tab; readable by everyone, writable by Admin/Developer) ---

app.get("/api/announcements", requireAuth, async (req, res) => {
  try {
    const { announcements } = createRepositories(getDb());
    const rows = await announcements.list({
      category: typeof req.query.category === "string" ? req.query.category : undefined,
    });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list announcements:", err);
    return res.status(500).json({ error: `Failed to load announcements: ${err.message}` });
  }
});

app.post("/api/announcements", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Creating announcements"))) return;
    const { announcement, effectiveDate, category, rating, type, validTillDate, title, fromTeam, announcementDate } = req.body;
    if (typeof announcement !== "string" || !announcement.trim() || typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "announcement and category are required." });
    }
    const { users: usersRepo, announcements } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const resolvedType = type === "General Announcement" ? "General Announcement" : "QA Announcement";
    const row = await announcements.create({
      announcement,
      category,
      addedBy: `${req.user!.name} (${callerTier})`,
      effectiveDate: effectiveDate || null,
      rating: typeof rating === "number" ? rating : null,
      type: resolvedType,
      validTillDate: validTillDate || null,
      title: title || null,
      fromTeam: fromTeam || null,
      // Distinct from effectiveDate (see schema.ts) — when this notice was
      // posted, not when the policy it describes takes effect.
      announcementDate: announcementDate || null,
    });
    // Retention: auto-delete the oldest announcements of THIS SAME type once
    // the configured limit is exceeded — QA and General are pruned entirely
    // independently (see ANNOUNCEMENT_RETENTION_LIMIT / enforceRetentionLimit
    // in announcementsRepository.ts). Never blocks the response on failure —
    // a retention hiccup should never prevent a successful publish.
    let deletedIds: number[] = [];
    try {
      deletedIds = await announcements.enforceRetentionLimit(resolvedType);
    } catch (retentionErr) {
      console.error("Announcement retention enforcement failed (non-fatal):", retentionErr);
    }
    return res.json({ entry: row, deletedIds });
  } catch (err: any) {
    console.error("Failed to create announcement:", err);
    return res.status(500).json({ error: `Failed to publish this announcement: ${err.message}` });
  }
});

app.put("/api/announcements/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing announcements"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid announcement id." });

    const { announcement, effectiveDate, category, rating, type, validTillDate, title, fromTeam, announcementDate } = req.body;
    const { announcements } = createRepositories(getDb());
    const row = await announcements.update(id, {
      ...(announcement !== undefined ? { announcement } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(effectiveDate !== undefined ? { effectiveDate } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(validTillDate !== undefined ? { validTillDate } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(fromTeam !== undefined ? { fromTeam } : {}),
      ...(announcementDate !== undefined ? { announcementDate } : {}),
    });
    if (!row) return res.status(404).json({ error: "Announcement not found." });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update announcement:", err);
    return res.status(500).json({ error: `Failed to update this announcement: ${err.message}` });
  }
});

app.delete("/api/announcements/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Deleting announcements"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid announcement id." });
    const { announcements } = createRepositories(getDb());
    await announcements.delete(id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete announcement:", err);
    return res.status(500).json({ error: `Failed to delete this announcement: ${err.message}` });
  }
});

// --- External Resources (Workspace Controls drawer; readable by everyone, writable by Admin/Developer) ---

app.get("/api/external-resources", requireAuth, async (req, res) => {
  try {
    const { externalResources } = createRepositories(getDb());
    const rows = await externalResources.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list external resources:", err);
    return res.status(500).json({ error: `Failed to load resource links: ${err.message}` });
  }
});

app.post("/api/external-resources", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Adding resource links"))) return;
    const { title, url, icon } = req.body;
    if (typeof title !== "string" || !title.trim() || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ error: "title and url are required." });
    }
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;
    const { users: usersRepo, externalResources } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const row = await externalResources.create({
      title: title.trim(),
      url: normalizedUrl,
      addedBy: `${req.user!.name} (${callerTier})`,
      // Empty string / omitted = "no explicit choice" (client guesses from
      // title); anything else is trusted as a lucide-react icon name — an
      // unrecognized name just falls back to the generic link icon
      // client-side, so no server-side allow-list is needed here.
      icon: typeof icon === "string" && icon.trim() ? icon.trim() : null,
    });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to create external resource:", err);
    return res.status(500).json({ error: `Failed to add this resource link: ${err.message}` });
  }
});

app.put("/api/external-resources/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing resource links"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid resource id." });

    const { title, url, icon } = req.body;
    let normalizedUrl: string | undefined;
    if (url !== undefined) {
      normalizedUrl = String(url).trim();
      if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;
    }
    const { externalResources } = createRepositories(getDb());
    const row = await externalResources.update(id, {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(normalizedUrl !== undefined ? { url: normalizedUrl } : {}),
      // icon is explicitly settable back to "auto" — sending "" clears a
      // previously-chosen icon, distinct from omitting the field entirely
      // (which leaves whatever was there untouched).
      ...(icon !== undefined ? { icon: typeof icon === "string" && icon.trim() ? icon.trim() : null } : {}),
    });
    if (!row) return res.status(404).json({ error: "Resource link not found." });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update external resource:", err);
    return res.status(500).json({ error: `Failed to update this resource link: ${err.message}` });
  }
});

app.delete("/api/external-resources/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Deleting resource links"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid resource id." });
    const { externalResources } = createRepositories(getDb());
    await externalResources.delete(id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete external resource:", err);
    return res.status(500).json({ error: `Failed to delete this resource link: ${err.message}` });
  }
});

// POST (not PUT) specifically so this never collides with the
// "/api/external-resources/:id" routes above — a PUT to ".../reorder"
// would otherwise be swallowed by the :id route with id="reorder".
app.post("/api/external-resources/reorder", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Reordering resource links"))) return;
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.some((id: unknown) => !Number.isInteger(id))) {
      return res.status(400).json({ error: "orderedIds must be an array of integer ids." });
    }
    const { externalResources } = createRepositories(getDb());
    await externalResources.reorder(orderedIds);
    const rows = await externalResources.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to reorder external resources:", err);
    // Drizzle's own error message is just "Failed query: ... params: ...";
    // the actual Postgres error (constraint violation, type mismatch, etc.)
    // is nested in `.cause` — surface that too so this is debuggable from
    // the UI alone, without needing the server's terminal output.
    const detail = err.cause?.message || err.message;
    return res.status(500).json({ error: `Failed to save the new order: ${detail}` });
  }
});

// --- PED Directory (Lookup page autocomplete dropdown; admin-facing name
// "PED Directory". The physical table is now `ped_directory` (renamed from
// `ped_suggestions` via migration 0010 to match the UI); the route path
// (/api/ped-suggestions) and the `pedSuggestions` repository binding were
// deliberately left as-is to avoid an app-wide rename churn) ---
// This table itself only feeds the suggestion list an advisor sees while
// typing a PED. Read by everyone; writes are gated to Admin/Developer, same
// pattern as external resources. Admin UI lives at
// PedSuggestionsManagement.tsx. The optional `category` field an admin can
// assign here IS live: POST/PUT below also call promotePedMappingOverride,
// which upserts ped_mapping_overrides and merges into TOP_PED_DICTIONARY —
// the actual matching engine — for every plan. DELETE calls
// unmapPedMappingOverride to remove that live effect, too.
app.get("/api/ped-suggestions", requireAuth, async (req, res) => {
  try {
    const { pedSuggestions } = createRepositories(getDb());
    const rows = await pedSuggestions.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list PED suggestions:", err);
    return res.status(500).json({ error: `Failed to load PED suggestions: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Page visibility — Developer-only show/hide switch.
//
// GET is open to every signed-in user because the client needs the hidden
// set to render its navigation. PUT is Developer-only: not Admin, not Editor —
// this is deliberately the narrowest gate in the app.
//
// The "never hide from the Developer" guarantee is enforced client-side in
// hasAccess() (App.tsx), which short-circuits to true for Developer before the
// hidden set is ever consulted.
// ─────────────────────────────────────────────────────────────────────────
app.get("/api/page-visibility", requireAuth, async (req, res) => {
  try {
    const { pageVisibility } = createRepositories(getDb());
    const rows = await pageVisibility.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list page visibility:", err);
    return res.status(500).json({ error: `Failed to load page visibility: ${err.message}` });
  }
});

app.put("/api/page-visibility/:featureId", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, pageVisibility, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer can change page visibility." });
    }

    const featureId = String(req.params.featureId);
    const { hidden } = req.body;
    if (typeof hidden !== "boolean") {
      return res.status(400).json({ error: "hidden must be a boolean." });
    }

    const row = await pageVisibility.setHidden(featureId, hidden, `${req.user!.name} (${callerTier})`);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Page Visibility Changed",
        planName: null,
        description: `Set page "${featureId}" to ${hidden ? "Hidden" : "Visible"} for non-Developer users.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for page visibility:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update page visibility:", err);
    return res.status(500).json({ error: `Failed to update page visibility: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// AI Mapping Review — the review surface over ai_memory (L2).
//
// GET/PATCH .../:id (edit) still govern the CACHE ONLY. PATCH .../:id/status
// additionally attempts to promote an approved entry into
// ped_mapping_overrides/TOP_PED_DICTIONARY — see the comment directly above
// that route for exactly when promotion does and doesn't happen.
// ─────────────────────────────────────────────────────────────────────────
app.get("/api/ai-memory", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing AI Mapping Review"))) return;
    const { aiMemory } = createRepositories(getDb());
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const planName = typeof req.query.planName === "string" ? req.query.planName : undefined;
    const validStatuses = ["pending", "approved", "rejected", "archived"];
    const rows = await aiMemory.list({
      status: status && validStatuses.includes(status) ? (status as any) : undefined,
      planName,
    });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list AI memory entries:", err);
    return res.status(500).json({ error: `Failed to load AI Mapping Review: ${err.message}` });
  }
});

// Approve / reject / archive.
//
// Approving now also attempts to PROMOTE the cached answer into
// ped_mapping_overrides (the same live table PED Library edits and the
// Lookup page's "teach it" flow write to) — but only when it's safe to
// generalize: the AI's answer is a single (condition, plan) pair naming one
// plan-specific question, while ped_mapping_overrides is a plan-AGNOSTIC
// categoryKey read by every plan. Promotion is skipped (status still
// changes) when:
//   - match_type isn't P1/P2 (FALLBACK/ESCALATE/INVALID had no specific
//     question chosen — nothing to generalize), or
//   - the matched_question can't be traced back to exactly one categoryKey
//     in this plan's categoryMap (ambiguous — could misroute other plans).
// Rejecting an entry that was previously approved-and-promoted un-promotes
// it, so correcting a mistake here actually fixes live classification
// instead of leaving a wrong override behind.
app.patch("/api/ai-memory/:id/status", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Reviewing AI mapping recommendations"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid entry id." });

    const { status } = req.body;
    const allowed = ["pending", "approved", "rejected", "archived"];
    if (typeof status !== "string" || !allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    }

    const { aiMemory, users: usersRepo, planConfigs: planConfigsRepo, pedMappingOverrides: pedOverridesRepo, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const reviewer = `${req.user!.name} (${callerTier})`;

    const existing = await aiMemory.get(id);
    if (!existing) return res.status(404).json({ error: "Entry not found." });

    const row = await aiMemory.setStatus(id, status as any, reviewer);

    let promotion: { promoted: boolean; categoryKey?: string; reason?: string } = { promoted: false };
    if (status === "approved") {
      try {
        const storedResult = (existing.aiResponse as { result?: MatchOutput } | null)?.result;
        const PLAN_CONFIG = getPlanConfig();
        let config = PLAN_CONFIG[existing.planName];
        try {
          const dbPlan = await planConfigsRepo.get(existing.planName);
          if (dbPlan) config = dbRowToPlanConfig(dbPlan);
        } catch (err) {
          console.error("Failed to load DB plan config for AI Mapping Review promotion:", err);
        }

        if (!storedResult || !config) {
          promotion = { promoted: false, reason: "Plan configuration or cached answer unavailable." };
        } else if (storedResult.match_type !== "P1" && storedResult.match_type !== "P2") {
          promotion = { promoted: false, reason: `Answer type "${storedResult.match_type}" has no specific question to generalize.` };
        } else if (storedResult.matched_question === config.anyOther) {
          promotion = { promoted: false, reason: "Answer routes to this plan's general fallback, not a specific category." };
        } else {
          const categoryKey = inferCategoryKeyForQuestion(config, storedResult.matched_question);
          if (categoryKey) {
            await promotePedMappingOverride(pedOverridesRepo, existing.condition, categoryKey, reviewer);
            promotion = { promoted: true, categoryKey };
          } else {
            promotion = { promoted: false, reason: "Could not confidently infer a single category from this plan's answer — assign one manually via PED Library or the Lookup page's \"teach it\" flow if this mapping should apply to every plan." };
          }
        }
      } catch (err) {
        console.error("Failed to promote approved AI Mapping Review entry into live mapping overrides:", err);
        promotion = { promoted: false, reason: "Promotion failed unexpectedly — see server logs." };
      }
    } else if (status === "rejected" && existing.status === "approved") {
      try {
        await unmapPedMappingOverride(pedOverridesRepo, existing.condition, reviewer);
      } catch (err) {
        console.error("Failed to unmap rejected AI Mapping Review entry from live mapping overrides:", err);
      }
    }

    // Audit trail — the same shared modification history every other
    // admin action writes to.
    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "AI Mapping Reviewed",
        planName: existing.planName,
        description: `Set "${existing.condition}" (${existing.planName}) to ${status} in AI Mapping Review${
          promotion.promoted
            ? ` — promoted to live category "${promotion.categoryKey}" for every plan.`
            : status === "approved" && promotion.reason
            ? ` (not promoted: ${promotion.reason})`
            : "."
        }`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for AI memory review:", logErr);
    }

    return res.json({ entry: row, promotion });
  } catch (err: any) {
    console.error("Failed to update AI memory status:", err);
    return res.status(500).json({ error: `Failed to update this entry: ${err.message}` });
  }
});

// Admin edit of the cached answer before approving (e.g. correcting the
// matched question or explanation). Only the response payload is editable —
// the cache key fields are immutable.
app.patch("/api/ai-memory/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing AI mapping recommendations"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid entry id." });

    const { aiResponse } = req.body;
    if (!aiResponse || typeof aiResponse !== "object") {
      return res.status(400).json({ error: "aiResponse object is required." });
    }

    const { aiMemory } = createRepositories(getDb());
    const row = await aiMemory.updateResponse(id, aiResponse);
    if (!row) return res.status(404).json({ error: "Entry not found." });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to edit AI memory entry:", err);
    return res.status(500).json({ error: `Failed to edit this entry: ${err.message}` });
  }
});

/**
 * Writes a PED Repository mutation to the shared change log (Modification
 * History). Previously these three routes mutated the repository silently, so
 * the one surface meant to answer "who changed what" had a blind spot over
 * the PED Repository.
 *
 * Never throws: an audit-trail failure must not roll back or fail the
 * user's actual edit, which has already been committed by the time this runs.
 * Same fire-and-forget-but-logged pattern used by the page-visibility route.
 */
async function logPedRepositoryChange(
  changeLogs: ReturnType<typeof createRepositories>["changeLogs"],
  req: any,
  callerTier: string,
  actionType: string,
  description: string
): Promise<void> {
  try {
    await changeLogs.create({
      userName: req.user!.name,
      role: callerTier,
      actionType,
      // The change log's planName is NOT NULL and this registry is
      // plan-agnostic, so it's labelled rather than left blank.
      planName: "PED Repository",
      description,
      snapshot: null,
    });
  } catch (logErr) {
    console.error(`Failed to write change log for ${actionType}:`, logErr);
  }
}

app.post("/api/ped-suggestions", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Adding PED suggestions"))) return;
    const { term, category } = req.body;
    if (typeof term !== "string" || !term.trim()) {
      return res.status(400).json({ error: "term is required." });
    }
    if (category !== undefined && category !== null && typeof category !== "string") {
      return res.status(400).json({ error: "category must be a string." });
    }
    // Validated against CATEGORY_LABELS now that a category assigned here is
    // live (see promotePedMappingOverride below) — previously this field was
    // display-only so an arbitrary string was harmless; now it would silently
    // fail to resolve for every plan if it doesn't match a real categoryKey.
    const categoryClean = category ? String(category).trim() : null;
    if (categoryClean && !Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, categoryClean)) {
      return res.status(400).json({ error: `Unknown category "${categoryClean}".` });
    }
    const { users: usersRepo, pedSuggestions, pedMappingOverrides: pedOverridesRepo, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const addedBy = `${req.user!.name} (${callerTier})`;
    const row = await pedSuggestions.create({
      term: term.trim(),
      // Empty string from a "no category" select option is stored as null,
      // not "" — keeps "no category assigned yet" unambiguous.
      category: categoryClean,
      addedBy,
    });

    // Live effect: a categorized PED Library entry now actually routes
    // through the deterministic engine for every plan, not just the
    // autocomplete dropdown.
    if (row.category) {
      try {
        await promotePedMappingOverride(pedOverridesRepo, row.term, row.category, addedBy);
      } catch (err) {
        console.error("Failed to promote new PED Library entry into live mapping overrides:", err);
      }
    }

    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Repository Entry Added",
      `Added "${row.term}" to the PED Repository${row.category ? ` under category "${row.category}" — now live in classification` : " with no category assigned"}.`);

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to create PED suggestion:", err);
    const detail = err.cause?.message || err.message;
    return res.status(500).json({ error: `Failed to add this PED suggestion: ${detail}` });
  }
});

app.put("/api/ped-suggestions/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing PED suggestions"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED suggestion id." });
    const { term, category } = req.body;
    if (term !== undefined && (typeof term !== "string" || !term.trim())) {
      return res.status(400).json({ error: "term must be a non-empty string." });
    }
    if (category !== undefined && category !== null && typeof category !== "string") {
      return res.status(400).json({ error: "category must be a string." });
    }
    const categoryClean = category !== undefined ? (category ? String(category).trim() : null) : undefined;
    if (categoryClean && !Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, categoryClean)) {
      return res.status(400).json({ error: `Unknown category "${categoryClean}".` });
    }
    const { users: usersRepo, pedSuggestions, pedMappingOverrides: pedOverridesRepo, changeLogs } = createRepositories(getDb());
    // Capture the pre-edit state so the history entry can show what changed,
    // and so a renamed term or cleared category can unmap its OLD live
    // mapping (see below) — the DB row will no longer reflect it once
    // updated.
    const before = await pedSuggestions.get(id);

    const row = await pedSuggestions.update(id, {
      ...(term !== undefined ? { term: term.trim() } : {}),
      ...(categoryClean !== undefined ? { category: categoryClean } : {}),
    });
    if (!row) return res.status(404).json({ error: "PED suggestion not found." });

    const callerTier = await getCallerTier(req, usersRepo);
    const addedBy = `${req.user!.name} (${callerTier})`;

    // Live effect: keep ped_mapping_overrides in sync with this edit.
    //  - Renaming the term or clearing its category orphans the OLD live
    //    mapping (it's keyed on pedText) — unmap it so a stale override
    //    doesn't linger under text that's no longer shown anywhere.
    //  - A term with a category (new or unchanged) is (re-)promoted so the
    //    engine reflects exactly what's shown in the table.
    try {
      const termChanged = before && before.term !== row.term;
      const categoryCleared = before && before.category && !row.category;
      if (before?.category && (termChanged || categoryCleared)) {
        await unmapPedMappingOverride(pedOverridesRepo, before.term, addedBy);
      }
      if (row.category) {
        await promotePedMappingOverride(pedOverridesRepo, row.term, row.category, addedBy);
      }
    } catch (err) {
      console.error("Failed to sync edited PED Library entry into live mapping overrides:", err);
    }

    const changes: string[] = [];
    if (before && before.term !== row.term) changes.push(`term "${before.term}" → "${row.term}"`);
    if (before && before.category !== row.category) {
      changes.push(`category "${before.category || "none"}" → "${row.category || "none"}"${row.category ? " — now live in classification" : ""}`);
    }
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Repository Entry Edited",
      changes.length > 0
        ? `Edited PED Repository entry "${row.term}": ${changes.join("; ")}.`
        : `Saved PED Repository entry "${row.term}" with no field changes.`);

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update PED suggestion:", err);
    const detail = err.cause?.message || err.message;
    return res.status(500).json({ error: `Failed to update this PED suggestion: ${detail}` });
  }
});

app.delete("/api/ped-suggestions/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Deleting PED suggestions"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED suggestion id." });
    const { users: usersRepo, pedSuggestions, pedMappingOverrides: pedOverridesRepo, changeLogs } = createRepositories(getDb());
    // Read before deleting — afterwards there is nothing left to name.
    const before = await pedSuggestions.get(id);
    await pedSuggestions.delete(id);

    const callerTier = await getCallerTier(req, usersRepo);
    const addedBy = `${req.user!.name} (${callerTier})`;

    // Live effect: a categorized entry was actually routing PEDs through the
    // engine, so deleting it here must also stop that — otherwise "delete"
    // would only remove the directory listing while the mapping kept firing.
    if (before?.category) {
      try {
        await unmapPedMappingOverride(pedOverridesRepo, before.term, addedBy);
      } catch (err) {
        console.error("Failed to unmap deleted PED Library entry from live mapping overrides:", err);
      }
    }

    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Repository Entry Deleted",
      `Deleted "${before?.term ?? `entry #${id}`}" from the PED Repository${before?.category ? ` (category "${before.category}") — no longer live in classification` : ""}.`);

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete PED suggestion:", err);
    return res.status(500).json({ error: `Failed to delete this PED suggestion: ${err.message}` });
  }
});

// --- Smoke Test page — Admin/Developer-added custom PED entries, additional to
// the hardcoded 50+ baseline list (COMMON_SMOKE_TEST_PEDS, client-side
// constant, never touches the DB). Readable by everyone (the page itself is
// visible to every tier), writes gated to Admin/Developer — same pattern as
// PED Directory above. ---

app.get("/api/smoke-test-peds", requireAuth, async (req, res) => {
  try {
    const { smokeTestPeds } = createRepositories(getDb());
    const rows = await smokeTestPeds.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list custom smoke-test PEDs:", err);
    return res.status(500).json({ error: `Failed to load custom smoke-test PEDs: ${err.message}` });
  }
});

app.post("/api/smoke-test-peds", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Adding custom smoke-test PEDs"))) return;
    const { term } = req.body;
    if (typeof term !== "string" || !term.trim()) {
      return res.status(400).json({ error: "term is required." });
    }
    const { users: usersRepo, smokeTestPeds } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const row = await smokeTestPeds.create({
      term: term.trim(),
      addedBy: `${req.user!.name} (${callerTier})`,
    });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to add custom smoke-test PED:", err);
    return res.status(500).json({ error: `Failed to add this PED: ${err.message}` });
  }
});

app.delete("/api/smoke-test-peds/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Deleting custom smoke-test PEDs"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid smoke-test PED id." });
    const { smokeTestPeds } = createRepositories(getDb());
    await smokeTestPeds.delete(id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete custom smoke-test PED:", err);
    return res.status(500).json({ error: `Failed to delete this PED: ${err.message}` });
  }
});

// Bulk-classifies a list of PEDs against one plan in a single request —
// deliberately its own endpoint rather than looping the client over
// /api/match, for two reasons: /api/match is rate-limited to 30 requests
// per 15 minutes (expensiveActionLimiter), which a 50+ PED smoke test would
// blow through instantly: and this is a deterministic-engine health check,
// not a real user lookup, so it intentionally does NOT fall through to the
// Gemini AI fallback the way /api/match does — an unresolved PED is
// reported as `resolved: false` (the same signal
// src/__tests__/engine.baseline.test.ts records for its snapshot), which is
// itself the useful finding: it means this PED would silently go to AI in
// production. Still resolves the plan config exactly like /api/match (DB
// overrides included), so results reflect live plan-editing changes.
app.post("/api/smoke-test", requireAuth, async (req, res) => {
  try {
    const { planName, peds } = req.body;
    if (!planName || typeof planName !== "string") {
      return res.status(400).json({ error: "planName is required." });
    }
    if (!Array.isArray(peds) || peds.length === 0) {
      return res.status(400).json({ error: "peds must be a non-empty array." });
    }

    const smokeTestRepos = createRepositories(getDb());
    const { planConfigs: planConfigsRepo, pedMappingOverrides: pedOverridesRepo } = smokeTestRepos;
    await ensurePedOverridesLoaded(pedOverridesRepo);
    const dbSource = await getDbSource(smokeTestRepos);

    const PLAN_CONFIG = getPlanConfig();
    let config = PLAN_CONFIG[planName];
    try {
      const dbPlan = await planConfigsRepo.get(planName);
      if (dbPlan) config = dbRowToPlanConfig(dbPlan);
    } catch (err) {
      console.error("Failed to load DB plan config for smoke test (falling back to hardcoded defaults if any exist):", err);
    }

    if (!config) {
      return res.status(400).json({ error: `Insurance plan '${planName}' not supported.` });
    }

    const results = peds.map((ped: string) => {
      let output = classifyDeterministic(ped, planName, config, dbSource);
      if (!output) {
        return { ped, resolved: false as const };
      }
      output = sanitizeOutput(output, ped, config);
      output = applyPostGuards(output, ped, planName, config);
      const finalResult = finalizeOutput(output, ped, config, config.questions);
      return {
        ped,
        resolved: true as const,
        match_type: finalResult.match_type,
        matched_question: finalResult.matched_question,
        question_number: finalResult.question_number,
        explanation: finalResult.explanation,
      };
    });

    return res.json({ results });
  } catch (err: any) {
    console.error("Smoke test run failed:", err);
    return res.status(500).json({ error: `Smoke test run failed: ${err.message}` });
  }
});

// --- Flagged Issues (Flagged Responses tab) ---

// --- Plan Configs (declaration questionnaires; readable by everyone so the
// plan picker + matching work for every tier, writable by Admin/Developer) ---
// This is the *live* source of truth for /api/match — see the merge in the
// match route above. Adding a plan here means it goes live for matching
// immediately, no code change/redeploy required.

function validatePlanQuestions(questions: any): questions is Array<{ text: string; tag: string }> {
  return (
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every(
      (q) =>
        q &&
        typeof q.text === "string" &&
        q.text.trim() &&
        ["Specific", "Umbrella", "Catch-all"].includes(q.tag)
    )
  );
}

/** Unlike questions, an empty Specific Illness List is valid (most plans
 * won't have one entered yet) — this only rejects malformed entries, not
 * an empty array. `category` is optional, matching the hardcoded
 * SPECIFIC_ILLNESSES dictionary's `{ category?: string; illness: string }`
 * shape it's designed to be interchangeable with. */
function validateSpecificIllnesses(list: any): list is Array<{ category?: string; illness: string }> {
  return (
    Array.isArray(list) &&
    list.every(
      (item) =>
        item &&
        typeof item.illness === "string" &&
        item.illness.trim() &&
        (item.category === undefined || item.category === null || typeof item.category === "string")
    )
  );
}

/** Derives anyOther / hasUmbrella / umbrellaQuestions from a single tagged
 * questions array, rather than trusting separately-supplied fields that
 * could drift out of sync with the tags (single source of truth, matching
 * the tag-based model App.tsx's planQuestionsState already used). */
function deriveQuestionFields(questions: Array<{ text: string; tag: string }>) {
  const umbrellaQuestions = questions.filter((q) => q.tag === "Umbrella").map((q) => q.text);
  const anyOther = questions.find((q) => q.tag === "Catch-all")?.text || "Any other disease / condition not mentioned above?";
  return {
    umbrellaQuestions,
    hasUmbrella: umbrellaQuestions.length > 0,
    anyOther,
  };
}

app.get("/api/plan-configs", requireAuth, async (req, res) => {
  try {
    const { planConfigs } = createRepositories(getDb());
    const rows = await planConfigs.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list plan configs:", err);
    return res.status(500).json({ error: `Failed to load plans: ${err.message}` });
  }
});

app.post("/api/plan-configs", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Adding a plan"))) return;

    const { planName, insurerName, questions, categoryMap, overrides, specificIllnesses } = req.body;

    if (typeof planName !== "string" || !planName.trim()) {
      return res.status(400).json({ error: "planName is required." });
    }
    if (typeof insurerName !== "string" || !insurerName.trim()) {
      return res.status(400).json({ error: "insurerName is required." });
    }
    if (!validatePlanQuestions(questions)) {
      return res.status(400).json({ error: "questions must be a non-empty array of { text, tag } entries, and must include at least one." });
    }
    if (!categoryMap || typeof categoryMap !== "object" || Array.isArray(categoryMap)) {
      return res.status(400).json({ error: "categoryMap must be an object of { categoryKey: questionText }." });
    }
    if (specificIllnesses !== undefined && !validateSpecificIllnesses(specificIllnesses)) {
      return res.status(400).json({ error: "specificIllnesses must be an array of { category?, illness } entries with a non-empty illness." });
    }

    const { umbrellaQuestions, hasUmbrella, anyOther } = deriveQuestionFields(questions);

    const { users: usersRepo, planConfigs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const row = await planConfigs.upsert({
      planName: planName.trim(),
      insurerName: insurerName.trim(),
      questions,
      categoryMap,
      anyOther,
      hasUmbrella,
      umbrellaQuestions,
      specificIllnesses: Array.isArray(specificIllnesses) ? specificIllnesses : [],
      overrides: overrides && typeof overrides === "object" ? overrides : null,
      addedBy: `${req.user!.name} (${callerTier})`,
    });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to create plan config:", err);
    return res.status(500).json({ error: `Failed to save this plan: ${err.message}` });
  }
});

app.put("/api/plan-configs/:planName", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing a plan"))) return;
    const planName = decodeURIComponent(req.params.planName);

    const { insurerName, questions, categoryMap, overrides, specificIllnesses } = req.body;
    const update: Record<string, unknown> = {};

    if (insurerName !== undefined) {
      if (typeof insurerName !== "string" || !insurerName.trim()) {
        return res.status(400).json({ error: "insurerName cannot be empty." });
      }
      update.insurerName = insurerName.trim();
    }
    if (questions !== undefined) {
      if (!validatePlanQuestions(questions)) {
        return res.status(400).json({ error: "questions must be a non-empty array of { text, tag } entries." });
      }
      update.questions = questions;
      Object.assign(update, deriveQuestionFields(questions));
    }
    if (categoryMap !== undefined) {
      if (!categoryMap || typeof categoryMap !== "object" || Array.isArray(categoryMap)) {
        return res.status(400).json({ error: "categoryMap must be an object of { categoryKey: questionText }." });
      }
      update.categoryMap = categoryMap;
    }
    if (specificIllnesses !== undefined) {
      if (!validateSpecificIllnesses(specificIllnesses)) {
        return res.status(400).json({ error: "specificIllnesses must be an array of { category?, illness } entries with a non-empty illness." });
      }
      update.specificIllnesses = specificIllnesses;
    }
    if (overrides !== undefined) {
      update.overrides = overrides && typeof overrides === "object" ? overrides : null;
    }

    const { planConfigs } = createRepositories(getDb());
    const row = await planConfigs.update(planName, update);
    if (!row) return res.status(404).json({ error: "Plan not found." });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update plan config:", err);
    return res.status(500).json({ error: `Failed to update this plan: ${err.message}` });
  }
});

app.delete("/api/plan-configs/:planName", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Deleting a plan"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const { planConfigs } = createRepositories(getDb());
    await planConfigs.delete(planName);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete plan config:", err);
    return res.status(500).json({ error: `Failed to delete this plan: ${err.message}` });
  }
});

app.get("/api/flagged-issues", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing flagged responses"))) return;
    const validStatuses = ["Pending", "Urgent", "Resolved", "Ignored"];
    const status = typeof req.query.status === "string" && validStatuses.includes(req.query.status)
      ? (req.query.status as "Pending" | "Urgent" | "Resolved" | "Ignored")
      : undefined;
    const { flaggedIssues } = createRepositories(getDb());
    const rows = await flaggedIssues.list({
      status,
      planName: typeof req.query.planName === "string" ? req.query.planName : undefined,
    });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list flagged issues:", err);
    return res.status(500).json({ error: `Failed to load flagged responses: ${err.message}` });
  }
});

app.post("/api/flagged-issues", requireAuth, async (req, res) => {
  try {
    const { planName, pedInput, matchedQuestion, matchType, source, explanation, issueNotes } = req.body;
    if (![planName, pedInput, matchedQuestion, matchType, source, explanation, issueNotes].every((v) => typeof v === "string" && v.length > 0)) {
      return res.status(400).json({ error: "planName, pedInput, matchedQuestion, matchType, source, explanation, and issueNotes are all required strings." });
    }
    const { users: usersRepo, flaggedIssues } = createRepositories(getDb());
    const directoryEntry = await usersRepo.findByEmail(req.user!.email);
    const row = await flaggedIssues.create({
      userEmail: req.user!.email,
      userName: req.user!.name,
      userTactId: directoryEntry?.tactId || "UNKNOWN",
      planName,
      pedInput,
      matchedQuestion,
      matchType,
      source,
      explanation,
      issueNotes,
    });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to report flagged issue:", err);
    return res.status(500).json({ error: `Failed to submit this report: ${err.message}` });
  }
});

app.put("/api/flagged-issues/:id", requireAuth, async (req, res) => {
  try {
    // Resolve/Ignore + notes are Admin+Developer actions in the UI (only
    // permanent delete is Developer-only — see the DELETE route below).
    if (!(await requireAdminOrDeveloper(req, res, "Resolving flagged responses"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid flagged issue id." });

    const { status, ownerNotes } = req.body;
    const validStatuses = ["Pending", "Urgent", "Resolved", "Ignored"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${validStatuses.join(", ")}.` });
    }

    const { flaggedIssues } = createRepositories(getDb());
    const row = await flaggedIssues.update(id, {
      ...(status !== undefined ? { status } : {}),
      ...(ownerNotes !== undefined ? { ownerNotes } : {}),
      resolvedAt: status === "Resolved" ? new Date().toISOString() : undefined,
    });
    if (!row) return res.status(404).json({ error: "Flagged issue not found." });
    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update flagged issue:", err);
    return res.status(500).json({ error: `Failed to update this report: ${err.message}` });
  }
});

app.delete("/api/flagged-issues/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can permanently delete flagged reports." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid flagged issue id." });
    const { flaggedIssues } = createRepositories(getDb());
    await flaggedIssues.delete(id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete flagged issue:", err);
    return res.status(500).json({ error: `Failed to delete this report: ${err.message}` });
  }
});

// Returns the CALLER's OWN directory record only — unlike GET /api/users,
// this is intentionally not restricted to Admin/Developer, because a user is
// always allowed to know their own role. This is what the client's login
// bootstrap uses to resolve tier server-side (audit fix, see
// Production_Readiness_Audit.md Findings 1 & 9): resolving "am I an
// Admin?" against the full directory would otherwise require already being
// an Admin to read it — a General-tier user's first request would 403.
// `user: null` here means "authenticated via Google, but not yet
// provisioned in the directory" — the client routes that into the
// first-time-setup flow.
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const match = await usersRepo.findByEmail(req.user!.email);
    return res.json({ user: match ?? null });
  } catch (err: any) {
    console.error("Failed to look up the caller's directory record:", err);
    return res.status(500).json({ error: `Failed to load your profile: ${err.message}` });
  }
});

// Self-service "complete my profile" for a brand-new @joinditto.in sign-in
// that GET /api/me didn't find in the directory yet. Deliberately narrow:
// callers can only ever create THEIR OWN record (email comes from the
// verified session, never the request body), always at "General" tier —
// an Developer promotes people afterward via PUT /api/users. This is what makes
// first-time setup actually provision the user server-side instead of only
// ever touching the completing browser's own localStorage (audit fix, see
// Production_Readiness_Audit.md Finding 9): before this, a new hire's
// profile-completion never reached data/users.json, so they'd be asked to
// "complete setup" again on every new device, and no Developer/Admin would ever
// see them in the User Management directory.
app.post("/api/me/first-time-setup", requireAuth, async (req, res) => {
  try {
    const { name, tactId } = req.body;
    if (typeof name !== "string" || !name.trim() || typeof tactId !== "string" || !tactId.trim()) {
      return res.status(400).json({ error: "name and tactId are required." });
    }

    const { users: usersRepo } = createRepositories(getDb());
    const email = req.user!.email.toLowerCase();
    const existing = await usersRepo.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "This account is already set up. Please refresh and sign in again." });
    }

    const newUser = await usersRepo.create({
      email,
      name: name.trim(),
      tactId: tactId.trim(),
      tier: "General",
      status: "Active",
    });
    return res.json({ user: newUser });
  } catch (err: any) {
    // Surface the underlying cause instead of a generic string. Every other
    // route in this file already returns err.message, and masking it here
    // made a first-time-setup failure undiagnosable from the UI — the only
    // clue was this server-side log line.
    console.error("Failed to save first-time profile setup:", err);
    return res.status(500).json({ error: `Failed to save your profile: ${err.message}` });
  }
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
  // PED Repository DB migration — Phase 5 cutover (2026-07-28): log which
  // classification source is active on every boot, and — when PED_SOURCE=db
  // — eagerly warm the DB-backed runtime cache here rather than waiting for
  // the first inbound /api/match request. This makes a broken DB connection
  // or an empty/unseeded cache visible in the boot log immediately, instead
  // of being discovered silently by the first advisor's failed lookup (which
  // would otherwise look like a normal "no match" and fall through to AI
  // Memory/Gemini without anyone noticing the cache never loaded).
  console.log(
    `[PED Repository] Runtime source: ${
      PED_SOURCE === "db"
        ? "PostgreSQL (ped_repository / ped_aliases / plan_overrides — governed PED Repository)"
        : "legacy (TOP_PED_DICTIONARY + hardcoded regex blocks in engine.ts)"
    }`
  );
  if (PED_SOURCE === "db") {
    try {
      const repos = createRepositories(getDb());
      await ensurePedRuntimeCacheLoaded(repos);
      const aliasCount = getDbAliasLookup().size;
      console.log(`[PED Repository] DB-backed runtime cache initialized: ${aliasCount} aliases loaded and ready.`);
      if (aliasCount === 0) {
        console.warn(
          "[PED Repository] WARNING: DB-backed cache loaded with 0 aliases — classifyDeterministic will resolve nothing deterministically and every lookup will fall through to AI Memory/Gemini. Check DATABASE_URL and confirm scripts/seedPedRepository.ts --apply has been run against this database."
        );
      }
    } catch (err) {
      console.error(
        "[PED Repository] Failed to warm the DB-backed runtime cache at startup (per-request calls will retry lazily; classifyDeterministic falls back to the legacy dictionary on any DB-source error, so this does not block matching, but should be investigated):",
        err
      );
    }
  }

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

  // Global error-handling middleware (audit fix, see
  // Production_Readiness_Audit.md Finding 8). Must be registered last —
  // Express only routes an error to handlers registered after the point
  // where it occurred. Every route above already wraps its own logic in
  // try/catch, but this is the backstop for anything that isn't (a thrown
  // error in middleware, an unexpected synchronous throw, etc.): it always
  // returns a generic message instead of falling through to Express's
  // default handler, which can leak stack traces to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "An unexpected server error occurred. Please try again." });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
