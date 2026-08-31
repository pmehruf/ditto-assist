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
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Import types & engine logic
import { getPlanConfig, MatchOutput, CATEGORY_LABELS, CATEGORY_AUTO_MAP_RULES } from "./src/types.js";
import { classifyDeterministic, sanitizeOutput, applyPostGuards, finalizeOutput, resolvePlanDecision, normalizeDictionaryKey, applyHighConfidenceCategoryOverride, type DbDictionarySource } from "./src/engine.js";
import { MASTER_ILLNESSES } from "./src/specificIllnessEngine.js";
import { ensurePedOverridesLoaded, promotePedMappingOverride, unmapPedMappingOverride, inferCategoryKeyForQuestion } from "./src/server/pedMappingLive.js";
import { ensurePedRuntimeCacheLoaded, getDbAliasLookup, planOverrideLookup as dbPlanOverrideLookup } from "./src/server/pedRuntimeCache.js";
import {
  createPedWithPrimaryAlias,
  updatePedRow,
  deletePedRow,
  addAliasToPed,
  updateAliasRow,
  deleteAliasRow,
} from "./src/server/pedRepositoryLive.js";
import type { Repositories } from "./src/server/db/repositories/index.js";
import { dbRowToPlanConfig, toPlanRestrictions } from "./src/server/planConfigUtils.js";
import {
  getGoogleAuthUrl,
  exchangeCodeForIdentity,
  getQaDashboardSheetsAuthUrl,
  exchangeCodeForQaDashboardSheetsGrant,
  getKbPlaybookSheetsAuthUrl,
  exchangeCodeForKbPlaybookSheetsGrant,
  getKbFaqSheetsAuthUrl,
  exchangeCodeForKbFaqSheetsGrant,
  getProductAssistLogExportSheetsAuthUrl,
  exchangeCodeForProductAssistLogExportGrant,
} from "./src/server/auth/googleOAuth.js";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./src/server/auth/session.js";
import { attachUser, requireAuth } from "./src/server/auth/middleware.js";
import { getDb } from "./src/server/db/client.js";
import { createRepositories, normalizeCondition } from "./src/server/db/repositories/index.js";
import type { UsersRepository } from "./src/server/db/repositories/index.js";
import { parseListQuery, pickEnumValue } from "./src/server/pagination.js";
import { normalizeTactId } from "./src/utils/tactId.js";
import {
  getDashboardData as getQaDashboardData,
  listAdvisorsForCaller as listQaAdvisorsForCaller,
  getFeedbackRowsFor as getQaFeedbackRowsFor,
  getReviewRowsFor as getQaReviewRowsFor,
  getAdvisorsDashboardListFor as getQaAdvisorsDashboardListFor,
  getCompanyWideQaAggregateFor as getQaCompanyWideAggregateFor,
} from "./src/server/qaDashboard/qaDashboardService.js";
import type { DateFilters as QaDateFilters } from "./src/server/qaDashboard/qaDataEngine.js";
import { encryptQaRefreshToken } from "./src/server/qaDashboard/tokenCrypto.js";
import { invalidateQaSheetsAuthCache, QA_MASTER_SPREADSHEET_ID } from "./src/server/qaDashboard/sheetsClient.js";
import { getLastExecutionTime } from "./src/server/qaDashboard/appsScriptClient.js";
import { syncAdvisorDirectory } from "./src/server/qaDashboard/advisorDirectorySync.js";
import { ingestPdfResource } from "./src/server/knowledgeBase/pdfIngest.js";
import { ingestUrlResource } from "./src/server/knowledgeBase/webIngest.js";
import { kbDocumentTypeEnum, specialInstructionTypeEnum, faqCategoryEnum } from "./src/server/db/schema.js";
import { PLAYBOOK_RESOURCE_TITLE } from "./src/server/knowledgeBase/playbookIngest.js";
import { realPlanNames } from "./src/utils/kbPlanNames.js";

// Valid kb_resources.document_type values, for request-body validation on
// the upload/add-url/PATCH routes below — kept as a plain string[] (not the
// Drizzle enum object itself) so it's cheap to .includes() against.
const KB_DOCUMENT_TYPES: string[] = [...kbDocumentTypeEnum.enumValues];
const SPECIAL_INSTRUCTION_TYPES: string[] = [...specialInstructionTypeEnum.enumValues];
const FAQ_CATEGORIES: string[] = [...faqCategoryEnum.enumValues];
import { answerQuery } from "./src/server/knowledgeBase/productAssist.js";
import { encryptPlaybookRefreshToken } from "./src/server/knowledgeBase/playbookTokenCrypto.js";
import { invalidatePlaybookSheetsAuthCache, PLAYBOOK_SPREADSHEET_ID } from "./src/server/knowledgeBase/playbookSheetsClient.js";
import { encryptFaqRefreshToken } from "./src/server/knowledgeBase/faqTokenCrypto.js";
import { invalidateFaqSheetsAuthCache, FAQ_SPREADSHEET_ID } from "./src/server/knowledgeBase/faqSheetsClient.js";
import { syncPlaybook, maybeRefreshPlaybookIfStale } from "./src/server/knowledgeBase/playbookIngest.js";
import { syncFaq, maybeRefreshFaqIfStale } from "./src/server/knowledgeBase/faqIngest.js";
import { encryptProductAssistLogRefreshToken } from "./src/server/knowledgeBase/productAssistLogTokenCrypto.js";
import { invalidateProductAssistLogSheetsAuthCache } from "./src/server/knowledgeBase/productAssistLogSheetsClient.js";
import { runProductAssistLogExport } from "./src/server/knowledgeBase/productAssistLogExport.js";
import { embedDocumentChunks } from "./src/server/knowledgeBase/embeddings.js";
import {
  checkQuota,
  getQuotaStatus,
  recordUsage,
  listAllUserQuotaStatuses,
  estimateCost,
  startOfDayIST,
  startOfMonthIST,
} from "./src/server/knowledgeBase/productAssistQuota.js";
import { DEFAULT_FEATURE_PERMISSIONS, DEVELOPER_ONLY_FEATURES } from "./src/constants/featurePermissions.js";

dotenv.config();

const app = express();

// Cloud Run (and most PaaS hosts) always sit behind a reverse proxy that
// terminates TLS and forwards the real client IP via X-Forwarded-For.
// Without this, express-rate-limit v7 either throws a validation error on
// every request or buckets all traffic under the proxy's single IP instead
// of the real caller's — silently defeating the rate limiter. `1` trusts
// exactly one hop (the platform's own proxy), which matches Cloud Run.
app.set("trust proxy", 1);

// ─────────────────────────────────────────────────────────────────────────
// LEGACY HOST REDIRECT — two independent reasons a visitor can land on a
// stale hostname for this same app/environment, both handled by the one
// map below:
//   1. Rebrand (2026-08-07): "Declaration Assistant" -> "Ditto Assist".
//      Cloud Run has no built-in way to rename a service in place, so the
//      old service (declaration-assistant-...) keeps running as its own
//      separate resource, with its own URL, unless someone deletes it.
//   2. Cloud Run default-URL format change (discovered 2026-08-25): Cloud
//      Run's own default URL format for this project changed at some point
//      from `<service>-<project-number>.<region>.run.app` to
//      `<service>-<hash>-<region-code>.a.run.app` — but BOTH forms keep
//      resolving to the same live service, so a bookmark/link/old OAuth
//      client config using the old-format URL still works for normal
//      browsing, EXCEPT for the Google OAuth round-trip: the redirect_uri
//      sent to Google is always the canonical `APP_URL` (new-format), so a
//      sign-in *started* on an old-format URL sets its CSRF state cookie
//      on that host, then Google redirects back to a DIFFERENT host — the
//      cookie is host-scoped and never arrives, so the callback always
//      fails with "Invalid or expired sign-in attempt" (see
//      /api/auth/google/callback below). This surfaced as a real user
//      report 2026-08-25: DevTools showed the login request's Initiator as
//      `ditto-assist-93120856554.asia-south1.run.app`, the old-format URL.
//
// This same code/image must be deployed to every service/hostname listed
// below (production, staging, and the standalone old declaration-assistant
// service) — on the CANONICAL host for that environment the hostname
// simply won't match any map entry and every request passes straight
// through unaffected; on any legacy hostname it 301-redirects the visitor
// straight to the equivalent path on that environment's canonical domain,
// before any other route/middleware runs (in particular, before the OAuth
// login route, so a sign-in attempt can never start on the wrong host).
const PROD_ORIGIN = "https://ditto-assist-y5biuzxgda-el.a.run.app";
const STAGING_ORIGIN = "https://ditto-assist-staging-y5biuzxgda-el.a.run.app";
const LEGACY_HOST_TO_ORIGIN: Record<string, string> = {
  // Old-format default URL for this app's own current service name.
  "ditto-assist-93120856554.asia-south1.run.app": PROD_ORIGIN,
  "ditto-assist-staging-93120856554.asia-south1.run.app": STAGING_ORIGIN,
  // Pre-rebrand service name, both URL formats.
  "declaration-assistant-y5biuzxgda-el.a.run.app": PROD_ORIGIN,
  "declaration-assistant-93120856554.asia-south1.run.app": PROD_ORIGIN,
};
app.use((req, res, next) => {
  const target = LEGACY_HOST_TO_ORIGIN[req.hostname];
  if (target) {
    return res.redirect(301, `${target}${req.originalUrl}`);
  }
  next();
});

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
      planRestrictions: planRestrictionsRepo,
    } = repos;
    await ensurePedOverridesLoaded(pedOverridesRepo);
    const dbSource = await getDbSource(repos);

    const PLAN_CONFIG = getPlanConfig();
    let config = PLAN_CONFIG[planName];

    // DB-authored plans (added or edited via the Add/Edit Plan wizard) are
    // the live source of truth and take precedence over the hardcoded
    // bootstrap defaults — this is what lets a newly-added plan be matched
    // against immediately, with no code change or redeploy.
    let dbPlan: Awaited<ReturnType<typeof planConfigsRepo.get>>;
    try {
      dbPlan = await planConfigsRepo.get(planName);
      if (dbPlan) config = dbRowToPlanConfig(dbPlan);
    } catch (err) {
      console.error("Failed to load DB plan config (falling back to hardcoded defaults if any exist):", err);
    }

    // Plan-Specific Restrictions (2026-08) — DB-driven, applies uniformly
    // whether `config` above resolved from a DB row or the hardcoded seed.
    // Attached before any classifyDeterministic/applyPostGuards call below
    // (both the L1 deterministic path and the L3 Gemini fallback path
    // further down reuse this same `config`) so isCategoryRestrictedForPed/
    // hasActiveRestriction see live restriction data either way.
    if (config) {
      try {
        config.restrictions = toPlanRestrictions(await planRestrictionsRepo.listActiveForPlan(planName));
      } catch (err) {
        console.error("Failed to load plan restrictions (continuing with none active):", err);
      }
    }

    // Server-side enforcement of the Declaration Assistant Control page's
    // disable toggle — the declaration dropdown (LookupPage.tsx) already
    // blocks this client-side, but that's cosmetic on its own; a stale tab
    // left open from before a plan was disabled, or a direct API call,
    // would otherwise still run a lookup against a plan whose questions/
    // mapping logic the disable was specifically meant to take out of
    // service. Mirrors the note shown client-side.
    if (dbPlan?.disabled) {
      return res.status(403).json({
        error: dbPlan.disabledNote?.trim()
          ? `This plan is temporarily disabled: ${dbPlan.disabledNote.trim()}`
          : "This plan is temporarily disabled. Please check back later.",
      });
    }

    // A removed plan (Plan Management's Delete action — see schema.ts's
    // plan_configs.removed comment) must be rejected outright, even though
    // `config` above may still resolve from the hardcoded getPlanConfig()
    // bootstrap seed for a built-in plan that was never customized before
    // being removed. Without this check a "deleted" built-in plan would
    // keep matching successfully off that hardcoded fallback forever.
    if (dbPlan?.removed) {
      return res.status(400).json({ error: `Insurance plan '${planName}' not supported.` });
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
// Distinctly-named cookie for the QA Dashboard's "Connect Google Sheets"
// grant (see below) — both flows share the exact same registered redirect
// URI (/api/auth/google/callback), so the callback route below tells them
// apart by which of these two cookies is present, not by the URI itself.
const QA_SHEETS_OAUTH_STATE_COOKIE = "ditto_qa_sheets_oauth_state";
// Same idea, for the Product Playbook Sheet's own independent "Connect
// Google Sheets" grant (Knowledge Base Management, not Developer
// Controls) — see src/server/auth/googleOAuth.ts's Playbook section.
const KB_PLAYBOOK_OAUTH_STATE_COOKIE = "ditto_kb_playbook_oauth_state";
// Same idea, for the Ditto FAQ Sheet's own independent "Connect Google
// Sheets" grant (Knowledge Base Management) — see
// src/server/auth/googleOAuth.ts's Ditto FAQ Sheet section.
const KB_FAQ_OAUTH_STATE_COOKIE = "ditto_kb_faq_oauth_state";
// Same idea, for the Product Assist Log Export's own independent "Connect
// Google Sheets" grant (Connections page) — see src/server/auth/googleOAuth.ts's
// Product Assist Log Export section. This is the only one of the three
// "Connect Google Sheets" grants that requests a WRITE scope.
const PRODUCT_ASSIST_LOG_OAUTH_STATE_COOKIE = "ditto_product_assist_log_oauth_state";
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
  // Both the normal login flow and the QA Dashboard's "Connect Google
  // Sheets" flow share this exact redirect URI (see getQaDashboardSheetsAuthUrl's
  // comment for why) — tell them apart by which distinctly-named state
  // cookie is present, checking the QA Dashboard one first since it's the
  // less common case.
  const qaSheetsExpectedState = req.cookies?.[QA_SHEETS_OAUTH_STATE_COOKIE];
  if (qaSheetsExpectedState) {
    res.clearCookie(QA_SHEETS_OAUTH_STATE_COOKIE);
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string" || !state || state !== qaSheetsExpectedState) {
        res.status(400).send("Invalid or expired connection attempt. Please try connecting again from Developer Controls.");
        return;
      }
      const grant = await exchangeCodeForQaDashboardSheetsGrant(code);
      const { qaDashboardConnection } = createRepositories(getDb());
      await qaDashboardConnection.upsert({
        connectedEmail: grant.email,
        encryptedRefreshToken: encryptQaRefreshToken(grant.refreshToken),
        connectedBy: req.user?.email || grant.email,
      });
      invalidateQaSheetsAuthCache();
      res.redirect("/?qa_dashboard_connected=1");
    } catch (err: any) {
      console.error("QA Dashboard Google Sheets connection failed:", err);
      res.status(401).send(`Connecting Google Sheets failed: ${err.message || "unknown error"}. Please try again from Developer Controls.`);
    }
    return;
  }

  const playbookExpectedState = req.cookies?.[KB_PLAYBOOK_OAUTH_STATE_COOKIE];
  if (playbookExpectedState) {
    res.clearCookie(KB_PLAYBOOK_OAUTH_STATE_COOKIE);
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string" || !state || state !== playbookExpectedState) {
        res.status(400).send("Invalid or expired connection attempt. Please try connecting again from Knowledge Base Management.");
        return;
      }
      const grant = await exchangeCodeForKbPlaybookSheetsGrant(code);
      const { kbPlaybookConnection } = createRepositories(getDb());
      await kbPlaybookConnection.upsert({
        connectedEmail: grant.email,
        encryptedRefreshToken: encryptPlaybookRefreshToken(grant.refreshToken),
        connectedBy: req.user?.email || grant.email,
      });
      invalidatePlaybookSheetsAuthCache();
      res.redirect("/?kb_playbook_connected=1");
    } catch (err: any) {
      console.error("Product Playbook Google Sheets connection failed:", err);
      res.status(401).send(`Connecting Google Sheets failed: ${err.message || "unknown error"}. Please try again from Knowledge Base Management.`);
    }
    return;
  }

  const faqExpectedState = req.cookies?.[KB_FAQ_OAUTH_STATE_COOKIE];
  if (faqExpectedState) {
    res.clearCookie(KB_FAQ_OAUTH_STATE_COOKIE);
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string" || !state || state !== faqExpectedState) {
        res.status(400).send("Invalid or expired connection attempt. Please try connecting again from Knowledge Base Management.");
        return;
      }
      const grant = await exchangeCodeForKbFaqSheetsGrant(code);
      const { kbFaqConnection } = createRepositories(getDb());
      await kbFaqConnection.upsert({
        connectedEmail: grant.email,
        encryptedRefreshToken: encryptFaqRefreshToken(grant.refreshToken),
        connectedBy: req.user?.email || grant.email,
      });
      invalidateFaqSheetsAuthCache();
      res.redirect("/?kb_faq_connected=1");
    } catch (err: any) {
      console.error("Ditto FAQ Google Sheets connection failed:", err);
      res.status(401).send(`Connecting Google Sheets failed: ${err.message || "unknown error"}. Please try again from Knowledge Base Management.`);
    }
    return;
  }

  const productAssistLogExpectedState = req.cookies?.[PRODUCT_ASSIST_LOG_OAUTH_STATE_COOKIE];
  if (productAssistLogExpectedState) {
    res.clearCookie(PRODUCT_ASSIST_LOG_OAUTH_STATE_COOKIE);
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string" || !state || state !== productAssistLogExpectedState) {
        res.status(400).send("Invalid or expired connection attempt. Please try connecting again from Connections.");
        return;
      }
      const grant = await exchangeCodeForProductAssistLogExportGrant(code);
      const { productAssistLogExportConnection } = createRepositories(getDb());
      await productAssistLogExportConnection.upsert({
        connectedEmail: grant.email,
        encryptedRefreshToken: encryptProductAssistLogRefreshToken(grant.refreshToken),
        connectedBy: req.user?.email || grant.email,
      });
      invalidateProductAssistLogSheetsAuthCache();
      res.redirect("/?product_assist_log_connected=1");
    } catch (err: any) {
      console.error("Product Assist Log Export Google Sheets connection failed:", err);
      res.status(401).send(`Connecting Google Sheets failed: ${err.message || "unknown error"}. Please try again from Connections.`);
    }
    return;
  }

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
  tier: "General" | "Admin" | "Platform Admin" | "Developer";
  status: "Active" | "Disabled";
}

// The only 2 skill-domain tags a user may hold (users.tags — see
// drizzle/0026_advisor_tags.sql). A user can hold either, both, or neither
// (unassigned) — chosen via a real multi-select at first-time setup ("Skill
// Domain") and editable afterward by an Admin/Developer in User Management.
const ADVISOR_TAG_VALUES = ["Health", "Term"] as const;
type AdvisorTagValue = (typeof ADVISOR_TAG_VALUES)[number];
/** Validates a `tags` payload: must be an array of only "Health"/"Term",
 * with no duplicates. An empty array (unassigned) is valid. */
function isValidAdvisorTags(v: unknown): v is AdvisorTagValue[] {
  if (!Array.isArray(v)) return false;
  if (!v.every((t) => (ADVISOR_TAG_VALUES as readonly string[]).includes(t))) return false;
  return new Set(v).size === v.length;
}

/** Which announcement `team` a caller's tags restrict them to seeing —
 * undefined means "no restriction" (both), used for unassigned users and for
 * users tagged with BOTH Health and Term, per the "Dedicated Announcements"
 * spec (this also covers what used to be "Both advisor"/"Manager", which are
 * now just users holding both tags). */
function teamForTags(tags: string[] | null | undefined): "Health" | "Term" | undefined {
  const set = new Set(tags ?? []);
  const hasHealth = set.has("Health");
  const hasTerm = set.has("Term");
  if (hasHealth && !hasTerm) return "Health";
  if (hasTerm && !hasHealth) return "Term";
  return undefined;
}

function isValidAnnouncementTeam(v: unknown): v is "Health" | "Term" {
  return v === "Health" || v === "Term";
}

type CallerTier = "General" | "Admin" | "Platform Admin" | "Developer";

/** Users not yet present in the directory default to "General" — matches the
 * client's existing fallback for a first-time Google sign-in. */
async function getCallerTier(req: any, usersRepo: UsersRepository): Promise<CallerTier> {
  const email = (req.user?.email as string | undefined)?.toLowerCase();
  if (!email) return "General";
  const match = await usersRepo.findByEmail(email);
  return match?.tier ?? "General";
}

/**
 * True for both real Developer and Platform Admin — the two tiers meant to
 * have "every Developer capability" per the Access Control system's Phase 2
 * spec. Used for every route that used to be a flat `callerTier !==
 * "Developer"` check (Feature Visibility, Permissions tab, Departments/
 * Teams/Roles/Relationship-Types catalogs, Connections-adjacent settings,
 * clearing logs, etc.).
 *
 * Deliberately NOT used for the 4 actions that stay real-Developer-only
 * regardless of Platform Admin status — see the dedicated
 * `requireDeveloperTierUnchanged`-style inline checks in PATCH/DELETE/POST
 * /api/users below, which check `callerTier === "Developer"` directly, never
 * through this helper.
 */
function isDeveloperPower(tier: CallerTier): boolean {
  return tier === "Developer" || tier === "Platform Admin";
}

/** True for Admin, Platform Admin, or Developer — every tier at or above
 * "Admin". Platform Admin is a superset of Admin in every existing
 * Admin+Developer-gated route (directory viewing, QA Dashboard access
 * management, PED Repository, Connections, Smoke Test, etc.). */
function isAdminPower(tier: CallerTier): boolean {
  return tier === "Admin" || tier === "Platform Admin" || tier === "Developer";
}

function isValidDirectoryUser(u: any): u is DirectoryUser {
  return (
    u &&
    typeof u.email === "string" &&
    typeof u.name === "string" &&
    typeof u.tactId === "string" &&
    (u.tier === "General" || u.tier === "Admin" || u.tier === "Platform Admin" || u.tier === "Developer") &&
    (u.status === "Active" || u.status === "Disabled")
  );
}

// Admin and Developer can view the directory; anyone else is refused.
// tags (Health/Term skill-domain tags) is a real column on `users` now (see
// drizzle/0026_advisor_tags.sql) — it used to be live-joined from the QA
// Google Sheet on every request, but that only worked while it was
// read-only; once it needed to be directly editable, it had to become real,
// persisted state. usersRepo's plain `select()` already returns it on every
// row, so no extra wiring is needed here.
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isAdminPower(callerTier)) {
      return res.status(403).json({ error: "The user directory is restricted to Admin and Developer roles." });
    }

    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 25, "desc");
      const tier = pickEnumValue(req.query.tier, ["General", "Admin", "Platform Admin", "Developer"] as const);
      const status = pickEnumValue(req.query.status, ["Active", "Disabled"] as const);
      const tag = pickEnumValue(req.query.tag, [...ADVISOR_TAG_VALUES, "Unassigned"] as const);
      // Numeric id as a string, or the "unassigned" sentinel — see
      // usersRepository.ts's UserListOptions doc comment.
      const departmentId = typeof req.query.departmentId === "string" && req.query.departmentId.trim() ? req.query.departmentId.trim() : undefined;
      const orgTeamId = typeof req.query.orgTeamId === "string" && req.query.orgTeamId.trim() ? req.query.orgTeamId.trim() : undefined;
      const roleId = typeof req.query.roleId === "string" && req.query.roleId.trim() ? req.query.roleId.trim() : undefined;
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom.trim() ? req.query.dateFrom.trim() : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo.trim() ? req.query.dateTo.trim() : undefined;
      const listOptions = { page, pageSize, search, tier, status, tag, departmentId, orgTeamId, roleId, dateFrom, dateTo, sortBy, sortDir };
      if (req.query.export) {
        const rows = await usersRepo.listMatching(listOptions);
        return res.json({ entries: rows });
      }
      const result = await usersRepo.listPaginated(listOptions);
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
    }

    const users = await usersRepo.list();
    return res.json({ users });
  } catch (err: any) {
    console.error("Failed to list the user directory:", err);
    return res.status(500).json({ error: `Failed to load the user directory: ${err.message}` });
  }
});

// Bulk edit — applies the SAME partial field change to every user in a
// selection: either an explicit `emails` array (the rows a Developer/Admin
// checked on the Directory's current page) or a `filter` object mirroring
// GET /api/users?paginated=1's own search/tag/tier/status/date filters (the
// Directory's "select all N matching this search" option) — resolved
// server-side via listMatching so the client never has to hold more than
// one page of rows in memory to act on a filtered set that spans thousands.
// MUST be registered before PATCH /api/users/:email below, or Express would
// match "bulk" as an :email param and this route would never be reached.
//
// Looser than the single-row PATCH below: Admin may also use this route
// (per product decision), not just Developer/Platform Admin. The same three
// safety invariants that route enforces per-row still apply here, just
// re-checked across a whole batch instead of one row:
//   1. Developer-record protection — a non-Developer caller's batch silently
//      drops any row currently at Developer tier (never touched, not even
//      its other fields).
//   2. Tier-grant ceiling — a caller may only set `changes.tier` to a tier
//      they're allowed to assign (mirrors POST/PATCH /api/users's existing
//      ADMIN_ADDABLE_TIERS / PLATFORM_ADMIN_ADDABLE_TIERS ceiling).
//   3. At least one Developer must remain, checked across the WHOLE batch
//      before anything is written — not per-row, since a batch could
//      otherwise downgrade every remaining Developer at once.
app.patch("/api/users/bulk", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, departments, orgTeams, roles } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isAdminPower(callerTier)) {
      return res.status(403).json({ error: "Admin, Platform Admin, or Developer clearance is required to bulk-edit the user directory." });
    }

    const { emails, filter, changes } = req.body ?? {};
    if (emails !== undefined && !Array.isArray(emails)) {
      return res.status(400).json({ error: "emails, if present, must be an array of email strings." });
    }
    const hasEmails = Array.isArray(emails) && emails.length > 0;
    if (!hasEmails && (!filter || typeof filter !== "object" || Array.isArray(filter))) {
      return res.status(400).json({ error: "Provide either a non-empty emails array or a filter object to select which users to update." });
    }
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      return res.status(400).json({ error: "changes must be an object with at least one field to update." });
    }

    // Build the validated patch — same per-field rules as the single-row
    // PATCH route, but every field here is OPTIONAL: a bulk edit usually
    // touches only one or two fields (e.g. just Tier), never a forced
    // full-row overwrite the way the single-row edit form always sends.
    const patch: Record<string, any> = {};
    if ("tier" in changes) {
      if (changes.tier !== "General" && changes.tier !== "Admin" && changes.tier !== "Platform Admin" && changes.tier !== "Developer") {
        return res.status(400).json({ error: "changes.tier must be one of General, Admin, Platform Admin, Developer." });
      }
      const assignableTiers: readonly string[] =
        callerTier === "Developer"
          ? ["General", "Admin", "Platform Admin", "Developer"]
          : callerTier === "Platform Admin"
            ? ["General", "Admin", "Platform Admin"]
            : ["General", "Admin"]; // Admin
      if (!assignableTiers.includes(changes.tier)) {
        return res.status(403).json({ error: `Your role can't bulk-assign the ${changes.tier} tier.` });
      }
      patch.tier = changes.tier;
    }
    if ("status" in changes) {
      if (changes.status !== "Active" && changes.status !== "Disabled") {
        return res.status(400).json({ error: "changes.status must be Active or Disabled." });
      }
      patch.status = changes.status;
    }
    if ("tags" in changes) {
      if (!isValidAdvisorTags(changes.tags)) {
        return res.status(400).json({ error: `changes.tags must be an array containing only: ${ADVISOR_TAG_VALUES.join(", ")}.` });
      }
      patch.tags = changes.tags;
    }
    if ("departmentId" in changes) {
      if (changes.departmentId !== null) {
        if (typeof changes.departmentId !== "number" || !Number.isInteger(changes.departmentId)) {
          return res.status(400).json({ error: "changes.departmentId must be a number or null." });
        }
        if (!(await departments.get(changes.departmentId))) {
          return res.status(400).json({ error: "That department doesn't exist." });
        }
      }
      patch.departmentId = changes.departmentId;
    }
    if ("orgTeamId" in changes) {
      if (changes.orgTeamId !== null) {
        if (typeof changes.orgTeamId !== "number" || !Number.isInteger(changes.orgTeamId)) {
          return res.status(400).json({ error: "changes.orgTeamId must be a number or null." });
        }
        if (!(await orgTeams.get(changes.orgTeamId))) {
          return res.status(400).json({ error: "That team doesn't exist." });
        }
      }
      patch.orgTeamId = changes.orgTeamId;
    }
    if ("roleId" in changes) {
      if (changes.roleId !== null) {
        if (typeof changes.roleId !== "number" || !Number.isInteger(changes.roleId)) {
          return res.status(400).json({ error: "changes.roleId must be a number or null." });
        }
        if (!(await roles.get(changes.roleId))) {
          return res.status(400).json({ error: "That role doesn't exist." });
        }
      }
      patch.roleId = changes.roleId;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "changes must include at least one recognized field: tier, status, tags, departmentId, orgTeamId, roleId." });
    }

    // Resolve the target set. An explicit `emails` array (checked rows on
    // the current page) always wins over `filter` when both are present.
    const targetRows = hasEmails
      ? await usersRepo.listByEmails(emails)
      : await usersRepo.listMatching({
          tier: pickEnumValue(filter.tier, ["General", "Admin", "Platform Admin", "Developer"] as const),
          status: pickEnumValue(filter.status, ["Active", "Disabled"] as const),
          tag: pickEnumValue(filter.tag, [...ADVISOR_TAG_VALUES, "Unassigned"] as const),
          departmentId: typeof filter.departmentId === "string" && filter.departmentId.trim() ? filter.departmentId.trim() : undefined,
          orgTeamId: typeof filter.orgTeamId === "string" && filter.orgTeamId.trim() ? filter.orgTeamId.trim() : undefined,
          roleId: typeof filter.roleId === "string" && filter.roleId.trim() ? filter.roleId.trim() : undefined,
          dateFrom: typeof filter.dateFrom === "string" && filter.dateFrom.trim() ? filter.dateFrom.trim() : undefined,
          dateTo: typeof filter.dateTo === "string" && filter.dateTo.trim() ? filter.dateTo.trim() : undefined,
          search: typeof filter.search === "string" && filter.search.trim() ? filter.search.trim() : undefined,
        });

    // Developer-record protection — a non-Developer caller's batch silently
    // drops any row currently at Developer tier, mirroring the single-row
    // PATCH route's blanket `existing.tier === "Developer" && callerTier !==
    // "Developer"` check, just applied per-row across a batch instead of to
    // one row.
    const eligible = callerTier === "Developer" ? targetRows : targetRows.filter((u) => u.tier !== "Developer");
    const skippedForDeveloperProtection = targetRows.length - eligible.length;

    // At least one Developer must remain, checked across the WHOLE batch —
    // only reachable when callerTier === "Developer" (the branch above
    // already drops every Developer-tier row for anyone else, so a downgrade
    // can only happen when a real Developer is bulk-editing Developer rows).
    if (patch.tier && patch.tier !== "Developer") {
      const beingDowngraded = eligible.filter((u) => u.tier === "Developer").length;
      if (beingDowngraded > 0) {
        const totalDevelopers = await usersRepo.countDevelopers();
        if (totalDevelopers - beingDowngraded < 1) {
          return res.status(400).json({ error: "At least one user must remain a Developer — this bulk change would remove the last one." });
        }
      }
    }

    const finalEmails = eligible.map((u) => u.email);
    const updated = finalEmails.length > 0 ? await usersRepo.bulkUpdate(finalEmails, patch) : [];

    return res.json({
      success: true,
      totalMatched: targetRows.length,
      updatedCount: updated.length,
      skippedCount: skippedForDeveloperProtection,
      users: updated,
    });
  } catch (err: any) {
    console.error("Failed to bulk-update the user directory:", err);
    return res.status(500).json({ error: "Failed to bulk-update the selected users." });
  }
});

// Single-row edit — added alongside pagination (see usersRepository.ts's
// updateUser doc comment for why the old full-array PUT below becomes
// unsafe once the admin UI only ever holds one page in memory). Developer
// AND Platform Admin can edit — EXCEPT a Developer-tier target account (any
// field), and EXCEPT granting Developer clearance to anyone: both of those
// stay real-Developer-only, checked explicitly below (never through
// isDeveloperPower, which would incorrectly let Platform Admin through).
app.patch("/api/users/:email", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, departments, orgTeams, roles } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can edit the user directory." });
    }

    const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
    const { name, tactId, tier, status, tags, departmentId, orgTeamId, roleId } = req.body;
    const resolvedTags = tags === undefined ? [] : tags;
    // Normalized regardless of how it was typed/pasted — see
    // normalizeTactId (utils/tactId.ts). TactIdInput already constrains
    // entry to digits-only client-side; this is the server-side backstop
    // for any other caller of this route.
    const normalizedTactId = typeof tactId === "string" ? normalizeTactId(tactId) : "";
    if (
      typeof name !== "string" || !name.trim() ||
      typeof tactId !== "string" || !normalizedTactId ||
      (tier !== "General" && tier !== "Admin" && tier !== "Platform Admin" && tier !== "Developer") ||
      (status !== "Active" && status !== "Disabled") ||
      !isValidAdvisorTags(resolvedTags)
    ) {
      return res.status(400).json({ error: `name, tactId, tier, and status are all required. tags, if present, must be an array containing only: ${ADVISOR_TAG_VALUES.join(", ")}.` });
    }
    // departmentId/orgTeamId/roleId are pure organizational metadata (see
    // schema.ts's doc comments) — each optional, and either null
    // (unassigned) or a real row's id. Never treated as a permission input
    // anywhere below.
    if (departmentId !== undefined && departmentId !== null) {
      if (typeof departmentId !== "number" || !Number.isInteger(departmentId)) {
        return res.status(400).json({ error: "departmentId must be a number or null." });
      }
      const dept = await departments.get(departmentId);
      if (!dept) {
        return res.status(400).json({ error: "That department doesn't exist." });
      }
    }
    if (orgTeamId !== undefined && orgTeamId !== null) {
      if (typeof orgTeamId !== "number" || !Number.isInteger(orgTeamId)) {
        return res.status(400).json({ error: "orgTeamId must be a number or null." });
      }
      const team = await orgTeams.get(orgTeamId);
      if (!team) {
        return res.status(400).json({ error: "That team doesn't exist." });
      }
    }
    if (roleId !== undefined && roleId !== null) {
      if (typeof roleId !== "number" || !Number.isInteger(roleId)) {
        return res.status(400).json({ error: "roleId must be a number or null." });
      }
      const role = await roles.get(roleId);
      if (!role) {
        return res.status(400).json({ error: "That role doesn't exist." });
      }
    }

    const existing = await usersRepo.findByEmail(targetEmail);
    if (!existing) {
      return res.status(404).json({ error: "No directory entry found for that email." });
    }
    // Developer-record protection (Access Control system Phase 2): a
    // Platform Admin has every other capability a Developer has, but can
    // never touch an EXISTING Developer's account in any way — not the
    // tier, not the status, not the name/team/department. Only a real
    // Developer may edit another Developer's record. This single check
    // covers "changing access tier for developer" and "deactivating the
    // profile" from the original spec in one place, rather than separate
    // per-field checks that could develop a gap.
    if (existing.tier === "Developer" && callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can modify another Developer's account." });
    }
    // Promoting someone TO Developer is also real-Developer-only — a
    // Platform Admin editing a non-Developer user must not be able to grant
    // Developer clearance via this route either.
    if (tier === "Developer" && callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can grant Developer clearance." });
    }
    // Same "at least one Developer must remain" guard the old full-array PUT
    // enforced across the whole submitted array — here it's scoped to just
    // this one row's tier change. (Only reachable by a real Developer caller
    // now, per the blanket check above, since existing.tier === "Developer"
    // would already have been refused for anyone else.)
    if (existing.tier === "Developer" && tier !== "Developer") {
      const remaining = await usersRepo.countOtherDevelopers(targetEmail);
      if (remaining === 0) {
        return res.status(400).json({ error: "At least one user must remain a Developer." });
      }
    }

    const row = await usersRepo.updateUser(targetEmail, {
      name: name.trim(),
      tactId: normalizedTactId,
      tier,
      status,
      tags: resolvedTags,
      ...(departmentId !== undefined ? { departmentId } : {}),
      ...(orgTeamId !== undefined ? { orgTeamId } : {}),
      ...(roleId !== undefined ? { roleId } : {}),
    });
    return res.json({ success: true, user: row });
  } catch (err: any) {
    console.error("Failed to update directory entry:", err);
    return res.status(500).json({ error: "Failed to update this user." });
  }
});

// Single-row delete — the safe counterpart to the PATCH route above, for the
// same reason (removing pagination's "current page only" client state made
// the old filter-then-PUT-the-whole-array delete flow unsafe).
app.delete("/api/users/:email", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can remove users from the directory." });
    }

    const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
    const existing = await usersRepo.findByEmail(targetEmail);
    if (!existing) {
      return res.status(404).json({ error: "No directory entry found for that email." });
    }
    // Developer-record protection (see PATCH /api/users/:email's comment) —
    // only a real Developer may remove another Developer's account.
    if (existing.tier === "Developer" && callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can remove another Developer's account." });
    }
    if (existing.tier === "Developer") {
      const remaining = await usersRepo.countOtherDevelopers(targetEmail);
      if (remaining === 0) {
        return res.status(400).json({ error: "At least one user must remain a Developer." });
      }
    }

    await usersRepo.deleteUser(targetEmail);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to remove directory entry:", err);
    return res.status(500).json({ error: "Failed to remove this user." });
  }
});

// LEGACY — kept for backward compatibility but no longer called by the
// admin UI (ProfileAccessManagement.tsx now uses the single-row PATCH/DELETE
// routes above). A full-array replace is unsafe now that the UI only holds
// one page of the directory at a time: saving from any page but the first
// would silently wipe out every user not on that page. Only Developer can
// edit — Admin gets a read-only view in the UI, enforced again here so the
// restriction can't be bypassed by calling the API directly.
//
// Deliberately NOT extended to Platform Admin (unlike the single-row PATCH/
// DELETE above): this route replaces the ENTIRE directory in one write, so
// safely enforcing "never touch a Developer's row" here would mean
// diffing the incoming array against the existing one row-by-row. Since
// nothing in the shipped UI calls this route anymore, keeping it strictly
// Developer-only is the simpler, safer choice rather than reimplementing
// that diff for genuinely dead code.
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
    const { users: usersRepo, departments, orgTeams, roles } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isAdminPower(callerTier)) {
      return res.status(403).json({ error: "Only Admin and Developer roles can add users to the directory." });
    }

    const { email, name, tactId, tier, status, tags, departmentId, orgTeamId, roleId } = req.body;
    const resolvedTags = tags === undefined ? [] : tags;
    const normalizedTactId = typeof tactId === "string" ? normalizeTactId(tactId) : "";
    if (!isValidDirectoryUser({ email, name, tactId, tier, status }) || !normalizedTactId || !isValidAdvisorTags(resolvedTags)) {
      return res.status(400).json({ error: `email, name, tactId, tier, and status are all required. tags, if present, must be an array containing only: ${ADVISOR_TAG_VALUES.join(", ")}.` });
    }
    // Admin (and Platform Admin) can add users, but shouldn't be able to
    // mint a new Developer from this lightweight endpoint — granting
    // Developer clearance stays real-Developer-only everywhere, not just
    // the PATCH edit route.
    if (tier === "Developer" && callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can grant Developer clearance." });
    }
    // Platform Admin clearance is one step narrower than Developer's own:
    // Developer or an existing Platform Admin can grant it, but a plain
    // Admin cannot mint a peer/superior tier from this endpoint.
    if (tier === "Platform Admin" && callerTier === "Admin") {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can grant Platform Admin clearance." });
    }
    // Same organizational-metadata validation as the PATCH route above.
    if (departmentId !== undefined && departmentId !== null) {
      if (typeof departmentId !== "number" || !Number.isInteger(departmentId)) {
        return res.status(400).json({ error: "departmentId must be a number or null." });
      }
      const dept = await departments.get(departmentId);
      if (!dept) {
        return res.status(400).json({ error: "That department doesn't exist." });
      }
    }
    if (orgTeamId !== undefined && orgTeamId !== null) {
      if (typeof orgTeamId !== "number" || !Number.isInteger(orgTeamId)) {
        return res.status(400).json({ error: "orgTeamId must be a number or null." });
      }
      const team = await orgTeams.get(orgTeamId);
      if (!team) {
        return res.status(400).json({ error: "That team doesn't exist." });
      }
    }
    if (roleId !== undefined && roleId !== null) {
      if (typeof roleId !== "number" || !Number.isInteger(roleId)) {
        return res.status(400).json({ error: "roleId must be a number or null." });
      }
      const role = await roles.get(roleId);
      if (!role) {
        return res.status(400).json({ error: "That role doesn't exist." });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await usersRepo.findByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists in the directory." });
    }

    const row = await usersRepo.create({
      email: normalizedEmail,
      name: name.trim(),
      tactId: normalizedTactId,
      tier,
      status,
      tags: resolvedTags,
      ...(departmentId !== undefined ? { departmentId } : {}),
      ...(orgTeamId !== undefined ? { orgTeamId } : {}),
      ...(roleId !== undefined ? { roleId } : {}),
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

/** Requires Admin, Platform Admin, or Developer tier; sends a 403 and returns false otherwise. */
async function requireAdminOrDeveloper(req: any, res: any, action: string): Promise<boolean> {
  const { users: usersRepo } = createRepositories(getDb());
  const callerTier = await getCallerTier(req, usersRepo);
  if (!isAdminPower(callerTier)) {
    res.status(403).json({ error: `${action} requires Admin or Developer tier.` });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// requireFeatureAccess — the server-side mirror of App.tsx's hasAccess().
// Closes the gap identified 2026-08-25 ("Wire the Access Control Center to
// the Real Authorization System"): the Permissions tab's feature_access_
// overrides and Custom Access Grants (grantType "feature_access") were
// previously consulted ONLY by the client's hasAccess() — every server
// route was gated purely by hardcoded tier checks (isAdminPower/
// isDeveloperPower), so an admin's Permissions-tab edit or a Developer's
// Custom Grant was cosmetic everywhere except which tabs rendered. This
// function makes that configuration real for the content-management
// routes it's applied to below (plan_scope, qa_announcement_log,
// flagged_responses, ped_suggestions, knowledge_base, resources). "audit"
// (Activity Log) has no write route at all — AuditPage.tsx is read-only
// (search-history/change-logs) — so its "Editor" registry label has nothing
// to enforce; not wired here for that reason.
//
// Deliberately mirrors hasAccess()'s exact precedence — same DEVELOPER_ONLY_
// FEATURES hard gate, same real-Developer bypass, same Platform Admin
// registry/override resolution, same registry-then-default resolution for
// General/Admin, same max-of/grant-only Custom Grant rule — so a feature
// behaves identically whether a person is looking at the UI or hitting the
// API directly.
//
// NOT applied to the Access Control Center's own routes (users,
// departments, org-teams, roles, relationship-types, user-relationships,
// custom-access-grants, feature-access, page-visibility) or the Product
// Assist quota settings routes — those stay on their existing hardcoded
// Developer/Platform-Admin-only gates, exactly like DEVELOPER_ONLY_FEATURES
// already treats owner_controls/connections/smoke_test/product_assist_quota.
// Reasoning: those routes configure the authorization system itself, so
// letting a Custom Grant or Permissions-tab edit ever raise access to THEM
// would be a privilege-escalation path (a careless or malicious grant on
// "profile_access" could hand a General user the ability to grant further
// access to themselves). This is a deliberate scope boundary, not an
// oversight — see the final report.
const ACCESS_LEVEL_RANK: Record<string, number> = { None: 0, Viewer: 1, Editor: 2 };

async function requireFeatureAccess(
  req: any,
  res: any,
  featureId: string,
  actionType: "Viewer" | "Editor",
  action: string
): Promise<boolean> {
  const { users: usersRepo, featureAccess, customAccessGrants } = createRepositories(getDb());
  const callerTier = await getCallerTier(req, usersRepo);

  if (DEVELOPER_ONLY_FEATURES.has(featureId)) {
    if (!isDeveloperPower(callerTier)) {
      res.status(403).json({ error: `${action} requires Developer or Platform Admin tier.` });
      return false;
    }
    return true;
  }

  // Only a real Developer bypasses everything from here on (mirrors
  // hasAccess()). Platform Admin (migration 0050) now resolves through the
  // same registry/override path as General/Admin, via its own
  // platformAdminAccess column — see below.
  if (callerTier === "Developer") return true;

  const perm = DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === featureId);
  if (!perm) return true; // unknown feature id — kept open, mirrors hasAccess()

  const overrides = await featureAccess.list();
  const override = overrides.find((o) => o.featureId === featureId);
  // Platform Admin has no shipped per-feature default in
  // DEFAULT_FEATURE_PERMISSIONS (unlike General/Admin) — defaults to
  // "Editor" when unconfigured, exactly reproducing the old unconditional
  // bypass until a Developer/Platform Admin explicitly narrows it.
  const shippedLevel =
    callerTier === "Platform Admin"
      ? override?.platformAdminAccess ?? "Editor"
      : callerTier === "Admin"
        ? override?.adminAccess ?? perm.adminAccess
        : override?.generalAccess ?? perm.generalAccess;

  const email = (req.user?.email as string | undefined)?.toLowerCase();
  let level = shippedLevel;
  if (email) {
    const grants = await customAccessGrants.listActiveForEmail(email);
    const grant = grants.find((g) => g.grantType === "feature_access" && g.targetId === featureId);
    if (grant?.level && ACCESS_LEVEL_RANK[grant.level] > ACCESS_LEVEL_RANK[shippedLevel]) {
      level = grant.level;
    }
  }

  const allowed = level === "Editor" ? true : level === "Viewer" ? actionType === "Viewer" : false;
  if (!allowed) {
    res.status(403).json({ error: `${action} requires access to this feature.` });
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
    const planName = typeof req.query.planName === "string" ? req.query.planName : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 50, "desc");
      const statusTier = typeof req.query.statusTier === "string" ? req.query.statusTier : undefined;
      const sourceType = typeof req.query.sourceType === "string" ? req.query.sourceType : undefined;
      const listOptions = { page, pageSize, search, userEmail: requestedEmail, planName, from, to, statusTier, sourceType, sortBy, sortDir };
      if (req.query.export) {
        const rows = await searchHistory.listMatching(listOptions);
        return res.json({ entries: rows });
      }
      const result = await searchHistory.listPaginated(listOptions);
      // Tier counts power the "Match Category Distribution" chart on the
      // Activity Log's User Activity sub-tab — a lightweight aggregate
      // query, not a second full-table load. Skipped for My Activity's
      // simpler view (no `includeTierCounts` flag) to avoid the extra query
      // on every page load of a page that doesn't render the chart.
      const tierCounts = req.query.includeTierCounts ? await searchHistory.getTierCounts(listOptions) : undefined;
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages, tierCounts });
    }

    const rows = await searchHistory.list({
      userEmail: requestedEmail,
      planName,
      from,
      to,
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
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can clear activity history." });
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
    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 50, "desc");
      const actionType = typeof req.query.actionType === "string" ? req.query.actionType : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const clOptions = { search, actionType, from, to, sortBy, sortDir };
      if (req.query.export) {
        const rows = await changeLogs.listMatching(clOptions);
        return res.json({ entries: rows });
      }
      const result = await changeLogs.listPaginated({ page, pageSize, ...clOptions });
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
    }
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
    const { announcements, users: usersRepo } = createRepositories(getDb());
    const category = typeof req.query.category === "string" ? req.query.category : undefined;

    // Team-based visibility (Health-tagged users see only Health, Term-tagged
    // see only Term, everyone else sees both — see teamForTags above).
    // Admin/Developer callers may pass includeAllTeams=1 to bypass this and
    // always see every announcement regardless of their OWN tags — used
    // only by the Announcement Manager's own fetch, since an admin editing
    // announcements needs to find/edit ones for either audience.
    let team: "Health" | "Term" | undefined;
    if (req.query.includeAllTeams === "1") {
      if (!(await requireAdminOrDeveloper(req, res, "Viewing announcements across all teams"))) return;
    } else {
      const caller = await usersRepo.findByEmail(req.user!.email);
      team = teamForTags(caller?.tags);
    }

    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 25, "desc");
      const type = pickEnumValue(req.query.type, ["QA Announcement", "General Announcement"] as const);
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom.trim() ? req.query.dateFrom.trim() : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo.trim() ? req.query.dateTo.trim() : undefined;
      const effectiveDateFrom = typeof req.query.effectiveDateFrom === "string" && req.query.effectiveDateFrom.trim() ? req.query.effectiveDateFrom.trim() : undefined;
      const effectiveDateTo = typeof req.query.effectiveDateTo === "string" && req.query.effectiveDateTo.trim() ? req.query.effectiveDateTo.trim() : undefined;
      const listOptions = { page, pageSize, search, category, type, sortBy, sortDir, dateFrom, dateTo, effectiveDateFrom, effectiveDateTo, team };
      if (req.query.export) {
        const rows = await announcements.listMatching(listOptions);
        return res.json({ entries: rows });
      }
      const result = await announcements.listPaginated(listOptions);
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
    }

    const rows = await announcements.list({ category, team });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list announcements:", err);
    return res.status(500).json({ error: `Failed to load announcements: ${err.message}` });
  }
});

app.post("/api/announcements", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "qa_announcement_log", "Editor", "Creating announcements"))) return;
    const { announcement, effectiveDate, category, rating, type, validTillDate, title, fromTeam, announcementDate, team } = req.body;
    if (typeof announcement !== "string" || !announcement.trim() || typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "announcement and category are required." });
    }
    if (team !== undefined && !isValidAnnouncementTeam(team)) {
      return res.status(400).json({ error: "team must be 'Health' or 'Term'." });
    }
    const { announcements } = createRepositories(getDb());
    const resolvedType = type === "General Announcement" ? "General Announcement" : "QA Announcement";
    const row = await announcements.create({
      announcement,
      category,
      addedBy: req.user!.name,
      effectiveDate: effectiveDate || null,
      rating: typeof rating === "number" ? rating : null,
      type: resolvedType,
      validTillDate: validTillDate || null,
      title: title || null,
      fromTeam: fromTeam || null,
      // Distinct from effectiveDate (see schema.ts) — when this notice was
      // posted, not when the policy it describes takes effect.
      announcementDate: announcementDate || null,
      // Which advisor audience this targets (Health-tagged / Term-tagged
      // visibility rules — see teamForTags). Defaults to "Health",
      // matching the column default and the spec's retroactive backfill.
      team: isValidAnnouncementTeam(team) ? team : "Health",
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
    if (!(await requireFeatureAccess(req, res, "qa_announcement_log", "Editor", "Editing announcements"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid announcement id." });

    const { announcement, effectiveDate, category, rating, type, validTillDate, title, fromTeam, announcementDate, team } = req.body;
    if (team !== undefined && !isValidAnnouncementTeam(team)) {
      return res.status(400).json({ error: "team must be 'Health' or 'Term'." });
    }
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
      ...(team !== undefined ? { team } : {}),
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
    if (!(await requireFeatureAccess(req, res, "qa_announcement_log", "Editor", "Deleting announcements"))) return;
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

// --- Mandatory read-and-acknowledge (all tiers, both announcement types) ---
// Which announcements a user must ack is decided server-side (see
// AnnouncementAcksRepository.listUnackedForUser): requires_ack rows only
// (pre-feature history was grandfathered), created after the user joined,
// still valid, and not yet acked by them.

app.get("/api/announcements/unacknowledged", requireAuth, async (req, res) => {
  try {
    const { announcementAcks } = createRepositories(getDb());
    const rows = await announcementAcks.listUnackedForUser(req.user!.email);
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list unacknowledged announcements:", err);
    return res.status(500).json({ error: `Failed to load unacknowledged announcements: ${err.message}` });
  }
});

app.post("/api/announcements/:id/acknowledge", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid announcement id." });
    const { announcements, announcementAcks } = createRepositories(getDb());
    const row = await announcements.getById(id);
    if (!row) return res.status(404).json({ error: "Announcement not found." });
    await announcementAcks.acknowledge(id, req.user!.email);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to record announcement acknowledgement:", err);
    return res.status(500).json({ error: `Failed to record acknowledgement: ${err.message}` });
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
    // Was requireAdminOrDeveloper (a hardcoded tier check) — switched to the
    // same requireFeatureAccess("resources", ...) path every other
    // content-management route uses, so a Permissions-tab override or
    // Custom Grant on "resources" actually takes effect here instead of
    // being silently ignored. Shipped defaults are unchanged (General:
    // Viewer, Admin: Editor — see featurePermissions.ts), so this changes
    // no tier's access today; it only makes the existing configuration
    // mechanism functional for this feature.
    if (!(await requireFeatureAccess(req, res, "resources", "Editor", "Adding resource links"))) return;
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
    if (!(await requireFeatureAccess(req, res, "resources", "Editor", "Editing resource links"))) return;
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
    if (!(await requireFeatureAccess(req, res, "resources", "Editor", "Deleting resource links"))) return;
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
    if (!(await requireFeatureAccess(req, res, "resources", "Editor", "Reordering resource links"))) return;
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
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    // `paginated=1` opts into the server-side page/search/filter/sort
    // contract (PedSuggestionsManagement.tsx). Omitted entirely for the
    // Lookup page's autocomplete fetch (App.tsx's fetchPedSuggestions),
    // which still wants the full, unpaginated list — keeps this endpoint
    // backward compatible for that caller.
    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 50, "asc");
      // `export=1`: the admin UI's "Export CSV" button intentionally
      // downloads the whole matching set (search/category-filtered, but not
      // paginated) rather than just the visible page.
      if (req.query.export) {
        const rows = await pedSuggestions.listMatching({ search, category, sortBy, sortDir });
        return res.json({ entries: rows });
      }
      const result = await pedSuggestions.listPaginated({ page, pageSize, search, category, sortBy, sortDir });
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
    }
    const rows = await pedSuggestions.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list PED suggestions:", err);
    return res.status(500).json({ error: `Failed to load PED suggestions: ${err.message}` });
  }
});

// Distinct categories actually present in the PED directory, for the admin
// UI's filter dropdown — a lightweight aggregate query so it never has to
// load the full (possibly 1,000+ row) table just to populate a dropdown.
app.get("/api/ped-suggestions/categories", requireAuth, async (req, res) => {
  try {
    const { pedSuggestions } = createRepositories(getDb());
    const rows = await pedSuggestions.listCategoriesInUse();
    const categories = rows.map((r) => r.category).filter((c): c is string => Boolean(c)).sort();
    const hasUncategorized = rows.some((r) => !r.category);
    return res.json({ categories, hasUncategorized });
  } catch (err: any) {
    console.error("Failed to list PED directory categories:", err);
    return res.status(500).json({ error: `Failed to load categories: ${err.message}` });
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
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can change page visibility." });
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
// Access Control — feature_access_overrides (Developer-editable override of
// DEFAULT_FEATURE_PERMISSIONS, see schema.ts's doc comment) and departments
// (pure organizational metadata, zero effect on access). Both live on the
// "Access Control Center" page (formerly "User Directory & Management").
//
// GET is requireAuth-only for feature access, same reasoning as
// page-visibility above: every signed-in user's own hasAccess() resolution
// needs the full override set, not just Admin/Developer. Writes are
// Developer-only — this reshapes who can do what app-wide, same bar as
// page visibility and directory tier edits.
// ─────────────────────────────────────────────────────────────────────────
const FEATURE_ACCESS_LEVELS = ["None", "Viewer", "Editor"] as const;
function isValidFeatureAccessLevel(v: unknown): v is (typeof FEATURE_ACCESS_LEVELS)[number] | null {
  return v === null || (typeof v === "string" && (FEATURE_ACCESS_LEVELS as readonly string[]).includes(v));
}

app.get("/api/feature-access", requireAuth, async (req, res) => {
  try {
    const { featureAccess } = createRepositories(getDb());
    const rows = await featureAccess.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list feature access overrides:", err);
    return res.status(500).json({ error: `Failed to load feature access: ${err.message}` });
  }
});

app.put("/api/feature-access/:featureId", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, featureAccess, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can change feature access." });
    }

    const featureId = String(req.params.featureId);
    // These 3 stay a hardcoded hard-gate in App.tsx's DEVELOPER_ONLY_FEATURES
    // (checked before this table is ever consulted, specifically so they
    // can never leak via a stale/incomplete permission list) — refusing the
    // write here too means the UI can't show an override that would have no
    // actual effect.
    if (["owner_controls", "connections", "smoke_test"].includes(featureId)) {
      return res.status(400).json({ error: `"${featureId}" is always Developer-only and can't be overridden.` });
    }

    const { generalAccess, adminAccess, platformAdminAccess } = req.body;
    if (!isValidFeatureAccessLevel(generalAccess) || !isValidFeatureAccessLevel(adminAccess) || !isValidFeatureAccessLevel(platformAdminAccess)) {
      return res.status(400).json({ error: `generalAccess, adminAccess, and platformAdminAccess must each be one of: ${FEATURE_ACCESS_LEVELS.join(", ")}, or null to clear.` });
    }

    const row = await featureAccess.set({
      featureId,
      generalAccess,
      adminAccess,
      platformAdminAccess,
      updatedBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Feature Access Changed",
        planName: null,
        description: `Set "${featureId}" access to General: ${generalAccess ?? "default"}, Admin: ${adminAccess ?? "default"}, Platform Admin: ${platformAdminAccess ?? "default"}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for feature access:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update feature access:", err);
    return res.status(500).json({ error: `Failed to update feature access: ${err.message}` });
  }
});

app.delete("/api/feature-access/:featureId", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, featureAccess, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can change feature access." });
    }
    const featureId = String(req.params.featureId);
    await featureAccess.clear(featureId);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Feature Access Changed",
        planName: null,
        description: `Reset "${featureId}" access to its shipped default.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for feature access reset:", logErr);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to reset feature access:", err);
    return res.status(500).json({ error: `Failed to reset feature access: ${err.message}` });
  }
});

// Departments — read open to any signed-in user (2026-08-25 revision: was
// Admin+Developer-only, on the assumption "General never needs the list").
// That assumption broke once first-time-setup and the profile card started
// resolving/selecting a Department by name: a brand-new sign-in isn't in the
// directory yet (always resolves to "General" — see getCallerTier) and a
// General-tier user still needs to read their OWN Department's name. Same
// rationale GET /api/me already documents for itself ("a user is always
// allowed to know their own role") extended to the catalog they picked it
// from — this is read-only, non-sensitive organizational metadata, not an
// access-control decision. Writes (POST/PATCH below) remain Developer-only,
// unchanged.
app.get("/api/departments", requireAuth, async (req, res) => {
  try {
    const { departments } = createRepositories(getDb());
    const rows = await departments.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list departments:", err);
    return res.status(500).json({ error: `Failed to load departments: ${err.message}` });
  }
});

app.post("/api/departments", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, departments, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create departments." });
    }
    const { name, description } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    const row = await departments.create({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Department Created",
        planName: null,
        description: `Created department "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for department creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    // Unique constraint on name — surface a clean message instead of the raw
    // Postgres error text.
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A department with that name already exists." });
    }
    console.error("Failed to create department:", err);
    return res.status(500).json({ error: `Failed to create this department: ${err.message}` });
  }
});

app.patch("/api/departments/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, departments, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can edit departments." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid department id." });
    }
    const existing = await departments.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Department not found." });
    }

    const { name, description, active } = req.body;
    const patch: { name?: string; description?: string | null; active?: boolean } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty." });
      }
      patch.name = name.trim();
    }
    if (description !== undefined) {
      patch.description = typeof description === "string" ? description.trim() || null : null;
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active must be a boolean." });
      }
      patch.active = active;
    }

    const row = await departments.update(id, patch);

    try {
      const changeSummary = [
        patch.name !== undefined && patch.name !== existing.name ? `renamed to "${patch.name}"` : null,
        patch.active !== undefined && patch.active !== existing.active ? (patch.active ? "reactivated" : "deactivated") : null,
        patch.description !== undefined ? "description updated" : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Department Edited",
        planName: null,
        description: `Department "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for department edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A department with that name already exists." });
    }
    console.error("Failed to update department:", err);
    return res.status(500).json({ error: `Failed to update this department: ${err.message}` });
  }
});

// Org Teams (Bliss / Falcon / Central) — same read/write posture as
// Departments above: read open to any signed-in user (2026-08-25, same
// rationale as GET /api/departments), writes gated Developer+Platform
// Admin. Foundation-only for now (see schema.ts's doc comment on
// `org_teams`) — assigning a user to a team has zero effect on what they
// can access until a later data-scoping enforcement phase.
app.get("/api/org-teams", requireAuth, async (req, res) => {
  try {
    const { orgTeams } = createRepositories(getDb());
    const rows = await orgTeams.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list org teams:", err);
    return res.status(500).json({ error: `Failed to load teams: ${err.message}` });
  }
});

app.post("/api/org-teams", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, orgTeams, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create teams." });
    }
    const { name, description } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    const row = await orgTeams.create({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Team Created",
        planName: null,
        description: `Created team "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for team creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A team with that name already exists." });
    }
    console.error("Failed to create team:", err);
    return res.status(500).json({ error: `Failed to create this team: ${err.message}` });
  }
});

app.patch("/api/org-teams/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, orgTeams, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can edit teams." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid team id." });
    }
    const existing = await orgTeams.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Team not found." });
    }

    const { name, description, active } = req.body;
    const patch: { name?: string; description?: string | null; active?: boolean } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty." });
      }
      patch.name = name.trim();
    }
    if (description !== undefined) {
      patch.description = typeof description === "string" ? description.trim() || null : null;
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active must be a boolean." });
      }
      patch.active = active;
    }

    const row = await orgTeams.update(id, patch);

    try {
      const changeSummary = [
        patch.name !== undefined && patch.name !== existing.name ? `renamed to "${patch.name}"` : null,
        patch.active !== undefined && patch.active !== existing.active ? (patch.active ? "reactivated" : "deactivated") : null,
        patch.description !== undefined ? "description updated" : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Team Edited",
        planName: null,
        description: `Team "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for team edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A team with that name already exists." });
    }
    console.error("Failed to update team:", err);
    return res.status(500).json({ error: `Failed to update this team: ${err.message}` });
  }
});

// Roles (Advisor / Mentor / Guide / ...) — independent of both `tier` and
// QA Dashboard's own admin/guide/mentor role (see schema.ts). Same
// read/write posture as Org Teams above: read open to any signed-in user
// (2026-08-25, same rationale as GET /api/departments).
app.get("/api/roles", requireAuth, async (req, res) => {
  try {
    const { roles } = createRepositories(getDb());
    const rows = await roles.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list roles:", err);
    return res.status(500).json({ error: `Failed to load roles: ${err.message}` });
  }
});

app.post("/api/roles", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create roles." });
    }
    const { name, description } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    const row = await roles.create({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Role Created",
        planName: null,
        description: `Created role "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for role creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A role with that name already exists." });
    }
    console.error("Failed to create role:", err);
    return res.status(500).json({ error: `Failed to create this role: ${err.message}` });
  }
});

app.patch("/api/roles/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can edit roles." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid role id." });
    }
    const existing = await roles.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Role not found." });
    }

    const { name, description, active } = req.body;
    const patch: { name?: string; description?: string | null; active?: boolean } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty." });
      }
      patch.name = name.trim();
    }
    if (description !== undefined) {
      patch.description = typeof description === "string" ? description.trim() || null : null;
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active must be a boolean." });
      }
      patch.active = active;
    }

    const row = await roles.update(id, patch);

    try {
      const changeSummary = [
        patch.name !== undefined && patch.name !== existing.name ? `renamed to "${patch.name}"` : null,
        patch.active !== undefined && patch.active !== existing.active ? (patch.active ? "reactivated" : "deactivated") : null,
        patch.description !== undefined ? "description updated" : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Role Edited",
        planName: null,
        description: `Role "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for role edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A role with that name already exists." });
    }
    console.error("Failed to update role:", err);
    return res.status(500).json({ error: `Failed to update this role: ${err.message}` });
  }
});

// Relationship Types (Mentor / Guide / ...) — the vocabulary usable in
// user_relationships below. Same read/write posture as Org Teams/Roles.
app.get("/api/relationship-types", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing relationship types"))) return;
    const { relationshipTypes } = createRepositories(getDb());
    const rows = await relationshipTypes.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list relationship types:", err);
    return res.status(500).json({ error: `Failed to load relationship types: ${err.message}` });
  }
});

app.post("/api/relationship-types", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipTypes, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create relationship types." });
    }
    const { name, description } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    const row = await relationshipTypes.create({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Relationship Type Created",
        planName: null,
        description: `Created relationship type "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for relationship type creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A relationship type with that name already exists." });
    }
    console.error("Failed to create relationship type:", err);
    return res.status(500).json({ error: `Failed to create this relationship type: ${err.message}` });
  }
});

app.patch("/api/relationship-types/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipTypes, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can edit relationship types." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid relationship type id." });
    }
    const existing = await relationshipTypes.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Relationship type not found." });
    }

    const { name, description, active } = req.body;
    const patch: { name?: string; description?: string | null; active?: boolean } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty." });
      }
      patch.name = name.trim();
    }
    if (description !== undefined) {
      patch.description = typeof description === "string" ? description.trim() || null : null;
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active must be a boolean." });
      }
      patch.active = active;
    }

    const row = await relationshipTypes.update(id, patch);

    try {
      const changeSummary = [
        patch.name !== undefined && patch.name !== existing.name ? `renamed to "${patch.name}"` : null,
        patch.active !== undefined && patch.active !== existing.active ? (patch.active ? "reactivated" : "deactivated") : null,
        patch.description !== undefined ? "description updated" : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Relationship Type Edited",
        planName: null,
        description: `Relationship type "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for relationship type edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A relationship type with that name already exists." });
    }
    console.error("Failed to update relationship type:", err);
    return res.status(500).json({ error: `Failed to update this relationship type: ${err.message}` });
  }
});

// User Relationships — explicit person-to-person mappings (e.g. a Mentor's
// mentees). Hard-deletable (see userRelationshipsRepository.ts's doc
// comment on why, unlike the catalogs above).
app.get("/api/user-relationships", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing user relationships"))) return;
    const { userRelationships } = createRepositories(getDb());
    const rows = await userRelationships.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list user relationships:", err);
    return res.status(500).json({ error: `Failed to load user relationships: ${err.message}` });
  }
});

app.post("/api/user-relationships", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipTypes, userRelationships, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create user relationships." });
    }
    const { ownerEmail, subjectEmail, relationshipTypeId } = req.body;
    if (typeof ownerEmail !== "string" || !ownerEmail.trim() || typeof subjectEmail !== "string" || !subjectEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail and subjectEmail are required." });
    }
    if (ownerEmail.trim().toLowerCase() === subjectEmail.trim().toLowerCase()) {
      return res.status(400).json({ error: "A user cannot be mapped to themselves." });
    }
    if (typeof relationshipTypeId !== "number" || !Number.isInteger(relationshipTypeId)) {
      return res.status(400).json({ error: "relationshipTypeId is required." });
    }
    const [owner, subject, relType] = await Promise.all([
      usersRepo.findByEmail(ownerEmail.trim().toLowerCase()),
      usersRepo.findByEmail(subjectEmail.trim().toLowerCase()),
      relationshipTypes.get(relationshipTypeId),
    ]);
    if (!owner) return res.status(400).json({ error: "ownerEmail does not match an existing user." });
    if (!subject) return res.status(400).json({ error: "subjectEmail does not match an existing user." });
    if (!relType || !relType.active) return res.status(400).json({ error: "relationshipTypeId does not match an active relationship type." });

    const row = await userRelationships.create({
      ownerEmail: ownerEmail.trim(),
      subjectEmail: subjectEmail.trim(),
      relationshipTypeId,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Relationship Created",
        planName: null,
        description: `Mapped ${subject.name} (${subject.email}) to ${owner.name} (${owner.email}) as "${relType.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for user relationship creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "That relationship mapping already exists." });
    }
    console.error("Failed to create user relationship:", err);
    return res.status(500).json({ error: `Failed to create this relationship: ${err.message}` });
  }
});

app.delete("/api/user-relationships/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, userRelationships, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can remove user relationships." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid relationship id." });
    }
    await userRelationships.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Relationship Removed",
        planName: null,
        description: `Removed user relationship #${id}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for user relationship removal:", logErr);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to remove user relationship:", err);
    return res.status(500).json({ error: `Failed to remove this relationship: ${err.message}` });
  }
});

// Custom Access Grants — per-individual, add-only flexibility valve for
// when Team/Department/Role structure alone doesn't fit someone (see
// schema.ts's doc comment on `custom_access_grants`). A grant can only ever
// RAISE a person's effective access above what their tier+overrides already
// give them — see App.tsx's hasAccess(), which takes the max of the two,
// never the grant alone. Only grantType "feature_access" is functional
// today; other grantType values are accepted so future grant kinds
// (team/department/relationship-scoped) don't need another migration, but
// nothing currently reads them.
app.get("/api/custom-access-grants", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing custom access grants"))) return;
    const { customAccessGrants } = createRepositories(getDb());
    const rows = await customAccessGrants.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list custom access grants:", err);
    return res.status(500).json({ error: `Failed to load custom access grants: ${err.message}` });
  }
});

// A user's own active grants — used by App.tsx to fold custom grants into
// its own hasAccess() resolution. Deliberately requireAuth-only (not
// Admin+Developer) since every signed-in user needs to be able to resolve
// their own effective access, same posture as GET /api/feature-access.
app.get("/api/my-access-grants", requireAuth, async (req, res) => {
  try {
    const { customAccessGrants } = createRepositories(getDb());
    const rows = await customAccessGrants.listActiveForEmail(req.user!.email);
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to load caller's access grants:", err);
    return res.status(500).json({ error: `Failed to load your access grants: ${err.message}` });
  }
});

app.post("/api/custom-access-grants", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, customAccessGrants, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can grant custom access." });
    }
    const { userEmail, grantType, targetId, level, note } = req.body;
    if (typeof userEmail !== "string" || !userEmail.trim()) {
      return res.status(400).json({ error: "userEmail is required." });
    }
    if (typeof grantType !== "string" || !grantType.trim()) {
      return res.status(400).json({ error: "grantType is required." });
    }
    if (typeof targetId !== "string" || !targetId.trim()) {
      return res.status(400).json({ error: "targetId is required." });
    }
    if (level !== null && level !== "None" && level !== "Viewer" && level !== "Editor") {
      return res.status(400).json({ error: 'level must be "None", "Viewer", "Editor", or null.' });
    }
    const targetUser = await usersRepo.findByEmail(userEmail.trim().toLowerCase());
    if (!targetUser) {
      return res.status(400).json({ error: "userEmail does not match an existing user." });
    }

    const row = await customAccessGrants.set({
      userEmail: userEmail.trim(),
      grantType: grantType.trim(),
      targetId: targetId.trim(),
      level: level ?? null,
      note: typeof note === "string" ? note.trim() || null : null,
      grantedBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Custom Access Granted",
        planName: null,
        description: `Granted ${targetUser.name} (${targetUser.email}) "${level ?? "None"}" access to ${grantType.trim()}:${targetId.trim()}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for custom access grant:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to create custom access grant:", err);
    return res.status(500).json({ error: `Failed to grant custom access: ${err.message}` });
  }
});

app.delete("/api/custom-access-grants/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, customAccessGrants, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can revoke custom access grants." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid grant id." });
    }
    const row = await customAccessGrants.revoke(id);
    if (!row) {
      return res.status(404).json({ error: "Grant not found." });
    }

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Custom Access Revoked",
        planName: null,
        description: `Revoked ${row.userEmail}'s custom grant for ${row.grantType}:${row.targetId}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for custom access revoke:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to revoke custom access grant:", err);
    return res.status(500).json({ error: `Failed to revoke this grant: ${err.message}` });
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
    const validStatus = status && validStatuses.includes(status) ? (status as any) : undefined;

    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 50, "desc");
      const listOptions = { page, pageSize, search, status: validStatus, planName, sortBy, sortDir };
      if (req.query.export) {
        const rows = await aiMemory.listMatching(listOptions);
        return res.json({ entries: rows });
      }
      const result = await aiMemory.listPaginated(listOptions);
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
    }

    const rows = await aiMemory.list({
      status: validStatus,
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
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Reviewing AI mapping recommendations"))) return;
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
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Editing AI mapping recommendations"))) return;
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
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Adding PED suggestions"))) return;
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
    // Postgres unique-violation (ped_directory.term is UNIQUE). The admin UI
    // used to catch this client-side by scanning its fully-loaded entry
    // list; now that the directory is server-paginated, the client only
    // holds the current page, so that check can miss a duplicate that's on
    // a different page — this server-side message keeps the error friendly
    // either way.
    if (err.cause?.code === "23505" || err.code === "23505") {
      return res.status(409).json({ error: `"${req.body?.term?.trim?.() || "This term"}" is already in the PED directory.` });
    }
    console.error("Failed to create PED suggestion:", err);
    const detail = err.cause?.message || err.message;
    return res.status(500).json({ error: `Failed to add this PED suggestion: ${detail}` });
  }
});

app.put("/api/ped-suggestions/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Editing PED suggestions"))) return;
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
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Deleting PED suggestions"))) return;
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

// ─────────────────────────────────────────────────────────────────────────
// PED Repository (NEW schema) — ped_repository / ped_aliases / categories.
//
// This is the write path onto the tables the deterministic engine actually
// reads when PED_SOURCE=db (see getDbSource above, pedRuntimeCache.ts).
// Cutover decision (2026-07-29): the "PED Repository" admin page now reads
// and writes THIS schema, not the legacy ped_directory table above — see
// pedRepositoryLive.ts's module doc for the full write-path pattern
// (DB write -> pedRuntimeCache sync -> legacy ped_mapping_overrides mirror
// for PED_SOURCE=legacy rollback safety). The legacy routes above are left
// running unchanged (nothing currently calls them from the client) rather
// than deleted, so no historical data is lost and PED_SOURCE=legacy still
// has somewhere to read from if ever needed.
// ─────────────────────────────────────────────────────────────────────────

// Flat shape (not a discriminated union) — see pagination.ts's pickEnumValue
// doc comment for why: this codebase's TS setup does not reliably narrow a
// `{ ok: true; value } | { ok: false; error }` union back down after an
// `if (!x.ok) return ...` guard, so `error`/`value` are just always-present
// (possibly null) fields instead, checked by value rather than by narrowing.
async function validateCategoryKey(categoryKey: unknown): Promise<{ ok: boolean; value: string | null; error: string | null }> {
  if (categoryKey === undefined || categoryKey === null || categoryKey === "") return { ok: true, value: null, error: null };
  if (typeof categoryKey !== "string") return { ok: false, value: null, error: "categoryKey must be a string." };
  const { categories } = createRepositories(getDb());
  const row = await categories.get(categoryKey);
  if (!row) return { ok: false, value: null, error: `Unknown category "${categoryKey}".` };
  return { ok: true, value: categoryKey, error: null };
}

const PED_STATUS_VALUES = ["draft", "approved", "deprecated"] as const;

app.get("/api/ped-repository", requireAuth, async (req, res) => {
  try {
    const { pedRepository: pedRepositoryRepo } = createRepositories(getDb());
    const categoryKey = typeof req.query.categoryKey === "string" ? req.query.categoryKey : undefined;
    const status = pickEnumValue(req.query.status, PED_STATUS_VALUES);

    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 50, "asc");
      if (req.query.export) {
        const rows = await pedRepositoryRepo.listMatching({ search, categoryKey, status, sortBy, sortDir });
        return res.json({ entries: rows });
      }
      const result = await pedRepositoryRepo.listPaginated({ page, pageSize, search, categoryKey, status, sortBy, sortDir });
      return res.json({ entries: result.data, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
    }
    const rows = await pedRepositoryRepo.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list the PED repository:", err);
    return res.status(500).json({ error: `Failed to load the PED repository: ${err.message}` });
  }
});

// Full category list (not just "in use") — an admin assigning a category to
// a brand-new PED needs every real option, not only ones already referenced.
app.get("/api/ped-repository/categories", requireAuth, async (req, res) => {
  try {
    const { categories } = createRepositories(getDb());
    const rows = await categories.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list categories:", err);
    return res.status(500).json({ error: `Failed to load categories: ${err.message}` });
  }
});

// The Lookup page's autocomplete source (App.tsx's fetchPedSuggestions) —
// deliberately filtered to `isVisible` aliases only, per
// PED_REPOSITORY_GOVERNANCE.md's 3-layer model: the normalization-only layer
// (misspellings/OCR variants) must keep matching silently but must never be
// suggested to an advisor as if it were correct terminology.
app.get("/api/ped-repository/autocomplete", requireAuth, async (req, res) => {
  try {
    const { pedAliases } = createRepositories(getDb());
    const rows = await pedAliases.listAll();
    const entries = rows.filter((a) => a.isVisible).map((a) => ({ term: a.aliasText }));
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to load PED repository autocomplete list:", err);
    return res.status(500).json({ error: `Failed to load PED suggestions: ${err.message}` });
  }
});

// Admin-only: the full alias list for one PED, INCLUDING hidden
// (isVisible=false) normalization-only entries — this route is what powers
// the alias-management panel, which is the one place hidden aliases are
// allowed to be listed (clearly separated, per governance), so an admin can
// actually manage them.
app.get("/api/ped-repository/:id/aliases", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing PED aliases"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED id." });
    const { pedAliases } = createRepositories(getDb());
    const rows = await pedAliases.listByPed(id);
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list PED aliases:", err);
    return res.status(500).json({ error: `Failed to load aliases: ${err.message}` });
  }
});

app.post("/api/ped-repository", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Adding a PED"))) return;
    const { canonicalName, categoryKey, status, notes } = req.body;
    if (typeof canonicalName !== "string" || !canonicalName.trim()) {
      return res.status(400).json({ error: "canonicalName is required." });
    }
    const categoryCheck = await validateCategoryKey(categoryKey);
    if (!categoryCheck.ok) return res.status(400).json({ error: categoryCheck.error || "Invalid category." });
    const statusValue = status !== undefined ? pickEnumValue(status, PED_STATUS_VALUES) : undefined;
    if (status !== undefined && !statusValue) {
      return res.status(400).json({ error: `status must be one of: ${PED_STATUS_VALUES.join(", ")}` });
    }

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const addedBy = `${req.user!.name} (${callerTier})`;

    const { ped, alias } = await createPedWithPrimaryAlias(
      { pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides },
      { canonicalName: canonicalName.trim(), categoryKey: categoryCheck.value, status: statusValue, notes: notes ?? null, addedBy }
    );

    try {
      await mappingHistory.record({ pedId: ped.id, entityType: "ped", action: "created", previousValue: null, newValue: ped, reason: null, performedBy: addedBy });
    } catch (err) {
      console.error("Failed to write mapping history for PED create:", err);
    }
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Repository Entry Added",
      `Added "${ped.canonicalName}" to the PED Repository${ped.categoryKey ? ` under category "${ped.categoryKey}" — now live in classification` : " with no category assigned"}.`);

    return res.json({ ped, alias });
  } catch (err: any) {
    if (err.cause?.code === "23505" || err.code === "23505") {
      return res.status(409).json({ error: `"${req.body?.canonicalName?.trim?.() || "This term"}" already exists as an alias of another PED (Alias Collision).` });
    }
    console.error("Failed to create PED:", err);
    return res.status(500).json({ error: `Failed to add this PED: ${err.cause?.message || err.message}` });
  }
});

app.patch("/api/ped-repository/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Editing a PED"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED id." });

    const { canonicalName, categoryKey, status, notes } = req.body;
    if (canonicalName !== undefined && (typeof canonicalName !== "string" || !canonicalName.trim())) {
      return res.status(400).json({ error: "canonicalName must be a non-empty string." });
    }
    let categoryValue: string | null | undefined;
    if (categoryKey !== undefined) {
      const categoryCheck = await validateCategoryKey(categoryKey);
      if (!categoryCheck.ok) return res.status(400).json({ error: categoryCheck.error || "Invalid category." });
      categoryValue = categoryCheck.value;
    }
    let statusValue: (typeof PED_STATUS_VALUES)[number] | undefined;
    if (status !== undefined) {
      statusValue = pickEnumValue(status, PED_STATUS_VALUES);
      if (!statusValue) return res.status(400).json({ error: `status must be one of: ${PED_STATUS_VALUES.join(", ")}` });
    }

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const before = await pedRepositoryRepo.get(id);
    if (!before) return res.status(404).json({ error: "PED not found." });

    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const after = await updatePedRow(
      { pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides },
      id,
      {
        ...(canonicalName !== undefined ? { canonicalName: canonicalName.trim() } : {}),
        ...(categoryKey !== undefined ? { categoryKey: categoryValue } : {}),
        ...(statusValue !== undefined ? { status: statusValue } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      performedBy
    );
    if (!after) return res.status(404).json({ error: "PED not found." });

    try {
      await mappingHistory.record({ pedId: id, entityType: "ped", action: "updated", previousValue: before, newValue: after, reason: null, performedBy });
    } catch (err) {
      console.error("Failed to write mapping history for PED update:", err);
    }

    const changes: string[] = [];
    if (before.canonicalName !== after.canonicalName) changes.push(`name "${before.canonicalName}" → "${after.canonicalName}"`);
    if (before.categoryKey !== after.categoryKey) changes.push(`category "${before.categoryKey || "none"}" → "${after.categoryKey || "none"}"`);
    if (before.status !== after.status) changes.push(`status "${before.status}" → "${after.status}"`);
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Repository Entry Edited",
      changes.length > 0 ? `Edited PED "${after.canonicalName}": ${changes.join("; ")}.` : `Saved PED "${after.canonicalName}" with no field changes.`);

    return res.json({ ped: after });
  } catch (err: any) {
    if (err.cause?.code === "23505" || err.code === "23505") {
      return res.status(409).json({ error: `That name collides with an existing alias of another PED (Alias Collision).` });
    }
    console.error("Failed to update PED:", err);
    return res.status(500).json({ error: `Failed to update this PED: ${err.cause?.message || err.message}` });
  }
});

app.delete("/api/ped-repository/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Deleting a PED"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED id." });

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const deleted = await deletePedRow({ pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides }, id, performedBy);
    if (!deleted) return res.status(404).json({ error: "PED not found." });

    try {
      await mappingHistory.record({ pedId: id, entityType: "ped", action: "deleted", previousValue: deleted, newValue: null, reason: null, performedBy });
    } catch (err) {
      console.error("Failed to write mapping history for PED delete:", err);
    }
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Repository Entry Deleted",
      `Deleted "${deleted.canonicalName}" from the PED Repository${deleted.categoryKey ? ` (category "${deleted.categoryKey}") — no longer live in classification` : ""}, including all of its aliases.`);

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete PED:", err);
    return res.status(500).json({ error: `Failed to delete this PED: ${err.message}` });
  }
});

app.post("/api/ped-repository/:id/aliases", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Adding a PED alias"))) return;
    const pedId = Number(req.params.id);
    if (!Number.isInteger(pedId)) return res.status(400).json({ error: "Invalid PED id." });
    const { aliasText, isVisible } = req.body;
    if (typeof aliasText !== "string" || !aliasText.trim()) {
      return res.status(400).json({ error: "aliasText is required." });
    }
    if (isVisible !== undefined && typeof isVisible !== "boolean") {
      return res.status(400).json({ error: "isVisible must be a boolean." });
    }

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const ped = await pedRepositoryRepo.get(pedId);
    if (!ped) return res.status(404).json({ error: "PED not found." });

    const callerTier = await getCallerTier(req, usersRepo);
    const addedBy = `${req.user!.name} (${callerTier})`;

    const alias = await addAliasToPed(
      { pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides },
      { pedId, aliasText: aliasText.trim(), isVisible, addedBy }
    );

    try {
      await mappingHistory.record({ pedId, entityType: "alias", action: "alias_added", previousValue: null, newValue: alias, reason: null, performedBy: addedBy });
    } catch (err) {
      console.error("Failed to write mapping history for alias add:", err);
    }
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Alias Added",
      `Added alias "${alias.aliasText}" to "${ped.canonicalName}"${alias.isVisible ? "" : " (hidden — normalization only)"}.`);

    return res.json({ entry: alias });
  } catch (err: any) {
    if (err.cause?.code === "23505" || err.code === "23505") {
      try {
        const { pedAliases: pedAliasesForCollision, collisions, users: usersRepoForCollision } = createRepositories(getDb());
        const existing = await pedAliasesForCollision.getByNormalizedAlias(normalizeDictionaryKey(String(req.body?.aliasText || "")));
        const callerTier = await getCallerTier(req, usersRepoForCollision);
        await collisions.record({
          collisionType: "alias",
          pedId: existing?.pedId ?? Number(req.params.id),
          rejectedCategoryKey: null,
          approvedCategoryKey: null,
          relatedPlanName: null,
          relatedAiMemoryId: null,
          severity: "advisory",
          active: true,
          addedBy: `${req.user!.name} (${callerTier})`,
          description: `Attempted to add alias "${req.body?.aliasText}" to PED #${req.params.id}, but it already belongs to PED #${existing?.pedId}.`,
        });
      } catch (logErr) {
        console.error("Failed to record alias collision:", logErr);
      }
      return res.status(409).json({ error: `"${req.body?.aliasText?.trim?.() || "This term"}" already exists as an alias of another PED (Alias Collision).` });
    }
    console.error("Failed to add PED alias:", err);
    return res.status(500).json({ error: `Failed to add this alias: ${err.cause?.message || err.message}` });
  }
});

app.patch("/api/ped-repository/aliases/:aliasId", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Editing a PED alias"))) return;
    const aliasId = Number(req.params.aliasId);
    if (!Number.isInteger(aliasId)) return res.status(400).json({ error: "Invalid alias id." });
    const { aliasText, isVisible, isPrimary } = req.body;
    if (aliasText !== undefined && (typeof aliasText !== "string" || !aliasText.trim())) {
      return res.status(400).json({ error: "aliasText must be a non-empty string." });
    }
    if (isVisible !== undefined && typeof isVisible !== "boolean") {
      return res.status(400).json({ error: "isVisible must be a boolean." });
    }
    if (isPrimary !== undefined && isPrimary !== true) {
      return res.status(400).json({ error: "isPrimary can only be set to true here — set a different alias primary to demote this one." });
    }

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const before = await pedAliases.get(aliasId);
    if (!before) return res.status(404).json({ error: "Alias not found." });

    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const after = await updateAliasRow(
      { pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides },
      aliasId,
      { ...(aliasText !== undefined ? { aliasText: aliasText.trim() } : {}), isVisible, isPrimary },
      performedBy
    );
    if (!after) return res.status(404).json({ error: "Alias not found." });

    try {
      await mappingHistory.record({ pedId: before.pedId, entityType: "alias", action: "updated", previousValue: before, newValue: after, reason: null, performedBy });
    } catch (err) {
      console.error("Failed to write mapping history for alias update:", err);
    }
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Alias Edited", `Edited alias "${before.aliasText}" (now "${after.aliasText}").`);

    return res.json({ entry: after });
  } catch (err: any) {
    if (err.cause?.code === "23505" || err.code === "23505") {
      return res.status(409).json({ error: `"${req.body?.aliasText?.trim?.() || "This term"}" already exists as an alias of another PED (Alias Collision).` });
    }
    console.error("Failed to update PED alias:", err);
    return res.status(500).json({ error: `Failed to update this alias: ${err.cause?.message || err.message}` });
  }
});

app.delete("/api/ped-repository/aliases/:aliasId", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Deleting a PED alias"))) return;
    const aliasId = Number(req.params.aliasId);
    if (!Number.isInteger(aliasId)) return res.status(400).json({ error: "Invalid alias id." });

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const before = await pedAliases.get(aliasId);
    if (!before) return res.status(404).json({ error: "Alias not found." });

    const siblings = await pedAliases.listByPed(before.pedId);
    if (siblings.length <= 1) {
      return res.status(400).json({ error: "A PED must have at least one alias — delete the PED itself instead of its last alias." });
    }

    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const deleted = await deleteAliasRow({ pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides }, aliasId, performedBy);
    if (!deleted) return res.status(404).json({ error: "Alias not found." });

    try {
      await mappingHistory.record({ pedId: deleted.pedId, entityType: "alias", action: "alias_removed", previousValue: deleted, newValue: null, reason: null, performedBy });
    } catch (err) {
      console.error("Failed to write mapping history for alias delete:", err);
    }
    await logPedRepositoryChange(changeLogs, req, callerTier, "PED Alias Deleted", `Deleted alias "${deleted.aliasText}".`);

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete PED alias:", err);
    return res.status(500).json({ error: `Failed to delete this alias: ${err.message}` });
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
    if (!(await requireFeatureAccess(req, res, "smoke_test", "Editor", "Adding custom smoke-test PEDs"))) return;
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
    if (!(await requireFeatureAccess(req, res, "smoke_test", "Editor", "Deleting custom smoke-test PEDs"))) return;
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
    const { planConfigs: planConfigsRepo, pedMappingOverrides: pedOverridesRepo, planRestrictions: planRestrictionsRepo } = smokeTestRepos;
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

    // Plan-Specific Restrictions — see /api/match's identical attachment for
    // why this must be applied uniformly regardless of `config`'s source.
    try {
      config.restrictions = toPlanRestrictions(await planRestrictionsRepo.listActiveForPlan(planName));
    } catch (err) {
      console.error("Failed to load plan restrictions for smoke test (continuing with none active):", err);
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
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Adding a plan"))) return;

    const { planName, insurerName, questions, categoryMap, overrides, specificIllnesses, disabled, disabledNote, removed } = req.body;

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
    if (disabled !== undefined && typeof disabled !== "boolean") {
      return res.status(400).json({ error: "disabled must be a boolean." });
    }
    if (disabledNote !== undefined && disabledNote !== null && typeof disabledNote !== "string") {
      return res.status(400).json({ error: "disabledNote must be a string or null." });
    }
    if (removed !== undefined && typeof removed !== "boolean") {
      return res.status(400).json({ error: "removed must be a boolean." });
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
      disabled: typeof disabled === "boolean" ? disabled : false,
      disabledNote: typeof disabledNote === "string" ? disabledNote.trim() || null : null,
      removed: typeof removed === "boolean" ? removed : false,
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
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Editing a plan"))) return;
    const planName = decodeURIComponent(req.params.planName);

    const { planName: newPlanNameRaw, insurerName, questions, categoryMap, overrides, specificIllnesses, disabled, disabledNote, removed } = req.body;

    // A rename: the body's planName differs from the URL's current name.
    // Renames the canonical DB record in place (an actual PK update) rather
    // than requiring the client to POST a new row and DELETE the old one —
    // see PlanConfigsRepository.rename for why that two-step was unsafe.
    let newPlanName: string | undefined;
    if (newPlanNameRaw !== undefined) {
      if (typeof newPlanNameRaw !== "string" || !newPlanNameRaw.trim()) {
        return res.status(400).json({ error: "planName cannot be empty." });
      }
      const trimmed = newPlanNameRaw.trim();
      if (trimmed !== planName) newPlanName = trimmed;
    }

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
    if (disabled !== undefined) {
      if (typeof disabled !== "boolean") {
        return res.status(400).json({ error: "disabled must be a boolean." });
      }
      update.disabled = disabled;
    }
    if (disabledNote !== undefined) {
      if (disabledNote !== null && typeof disabledNote !== "string") {
        return res.status(400).json({ error: "disabledNote must be a string or null." });
      }
      update.disabledNote = typeof disabledNote === "string" ? disabledNote.trim() || null : null;
    }
    if (removed !== undefined) {
      if (typeof removed !== "boolean") {
        return res.status(400).json({ error: "removed must be a boolean." });
      }
      update.removed = removed;
    }

    const { planConfigs, planRestrictions } = createRepositories(getDb());
    const row = newPlanName
      ? await planConfigs.rename(planName, newPlanName, update)
      : await planConfigs.update(planName, update);
    if (!row) return res.status(404).json({ error: "Plan not found." });
    if (newPlanName) {
      try {
        await planRestrictions.renamePlan(planName, newPlanName);
      } catch (err) {
        console.error("Failed to carry plan restrictions over to the renamed plan:", err);
      }
    }
    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      return res.status(409).json({ error: "A plan with that name already exists." });
    }
    console.error("Failed to update plan config:", err);
    return res.status(500).json({ error: `Failed to update this plan: ${err.message}` });
  }
});

app.delete("/api/plan-configs/:planName", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Deleting a plan"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const { planConfigs } = createRepositories(getDb());
    await planConfigs.delete(planName);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete plan config:", err);
    return res.status(500).json({ error: `Failed to delete this plan: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Plan-Specific Restrictions (2026-08) — the deterministic, admin-authored
// replacement for the old hardcoded plan_configs.overrides booleans
// (requiresInsulinForDiabetes / excludePrediabetes / bypassBenignTumors).
// See schema.ts's doc comment on `plan_restrictions` and engine.ts's
// isCategoryRestrictedForPed for how these are evaluated at match time — no
// AI is ever involved, purely a plain-text keyword check. Same permission
// model as the rest of Plan Management: Admin or Developer can view/manage
// (not gated to Developer-only, since this is an ordinary part of
// configuring a plan, same as its questions/categoryMap above).
// ─────────────────────────────────────────────────────────────────────────

// Every active restriction, across every plan — readable by every signed-in
// user (requireAuth only, no admin gate), unlike the per-plan editor route
// below. Needed so App.tsx's client-side deterministic path
// (executeLookupAll's classifyDeterministic call) sees the same live
// restriction data /api/match applies server-side for EVERY plan, including
// one that's still 100% on the hardcoded getPlanConfig() seed and has no
// plan_configs row at all — GET /api/plan-configs only lists rows from that
// table, so it can't be relied on alone to surface restrictions for such a
// plan. Mirrors why /api/plan-configs itself is requireAuth-only: matching
// must work identically for General tier, not just Admin/Developer.
app.get("/api/plan-restrictions", requireAuth, async (req, res) => {
  try {
    const { planRestrictions } = createRepositories(getDb());
    const rows = await planRestrictions.listAllActive();
    const byPlan: Record<string, ReturnType<typeof toPlanRestrictions>> = {};
    for (const row of rows) {
      byPlan[row.planName] = byPlan[row.planName] || [];
      byPlan[row.planName].push(...toPlanRestrictions([row]));
    }
    return res.json({ restrictionsByPlan: byPlan });
  } catch (err: any) {
    console.error("Failed to list all plan restrictions:", err);
    return res.status(500).json({ error: `Failed to load plan restrictions: ${err.message}` });
  }
});

app.get("/api/plan-restrictions/:planName", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing Plan-Specific Restrictions"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const { planRestrictions } = createRepositories(getDb());
    const entries = await planRestrictions.listForPlan(planName);
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list plan restrictions:", err);
    return res.status(500).json({ error: `Failed to load restrictions for this plan: ${err.message}` });
  }
});

function validatePlanRestrictionBody(body: any): { categoryKey: string; mode: "require_keywords" | "exclude_keywords" | "block_category"; keywords: string[]; explanation: string } | null {
  if (!body || typeof body.categoryKey !== "string" || !body.categoryKey.trim()) return null;
  if (!["require_keywords", "exclude_keywords", "block_category"].includes(body.mode)) return null;
  if (typeof body.explanation !== "string" || !body.explanation.trim()) return null;
  const keywords = Array.isArray(body.keywords) ? body.keywords.filter((k: unknown) => typeof k === "string" && k.trim()).map((k: string) => k.trim()) : [];
  if (body.mode !== "block_category" && keywords.length === 0) return null;
  return { categoryKey: body.categoryKey.trim(), mode: body.mode, keywords, explanation: body.explanation.trim() };
}

app.post("/api/plan-restrictions/:planName", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Adding a Plan-Specific Restriction"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const parsed = validatePlanRestrictionBody(req.body);
    if (!parsed) {
      return res.status(400).json({ error: "categoryKey, mode (require_keywords/exclude_keywords/block_category), and explanation are required; keywords is required unless mode is block_category." });
    }
    const { users: usersRepo, planRestrictions, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const entry = await planRestrictions.create({
      planName,
      categoryKey: parsed.categoryKey,
      mode: parsed.mode,
      keywords: parsed.keywords,
      explanation: parsed.explanation,
      isActive: true,
      createdBy: `${req.user!.name} (${callerTier})`,
      updatedBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Plan Restriction Created",
        planName,
        description: `Added a "${parsed.mode}" restriction on the "${parsed.categoryKey}" category for ${planName}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for plan restriction creation:", logErr);
    }

    return res.json({ entry });
  } catch (err: any) {
    console.error("Failed to create plan restriction:", err);
    return res.status(500).json({ error: `Failed to add this restriction: ${err.message}` });
  }
});

app.patch("/api/plan-restrictions/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Editing a Plan-Specific Restriction"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid restriction id." });
    const { users: usersRepo, planRestrictions, changeLogs } = createRepositories(getDb());
    const existing = await planRestrictions.get(id);
    if (!existing) return res.status(404).json({ error: "Restriction not found." });

    const { categoryKey, mode, keywords, explanation, isActive } = req.body;
    const validModes = ["require_keywords", "exclude_keywords", "block_category"] as const;
    if (mode !== undefined && !validModes.includes(mode)) {
      return res.status(400).json({ error: "mode must be require_keywords, exclude_keywords, or block_category." });
    }
    const callerTier = await getCallerTier(req, usersRepo);
    const entry = await planRestrictions.update(id, {
      ...(typeof categoryKey === "string" && categoryKey.trim() ? { categoryKey: categoryKey.trim() } : {}),
      ...(typeof mode === "string" ? { mode: mode as (typeof validModes)[number] } : {}),
      ...(Array.isArray(keywords) ? { keywords: keywords.filter((k: unknown) => typeof k === "string" && k.trim()).map((k: string) => k.trim()) } : {}),
      ...(typeof explanation === "string" && explanation.trim() ? { explanation: explanation.trim() } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      updatedBy: `${req.user!.name} (${callerTier})`,
    });
    if (!entry) return res.status(404).json({ error: "Restriction not found." });

    try {
      const actionType =
        typeof isActive === "boolean" && Object.keys(req.body).length === 1
          ? isActive
            ? "Plan Restriction Enabled"
            : "Plan Restriction Disabled"
          : "Plan Restriction Edited";
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType,
        planName: entry.planName,
        description: `Updated the "${entry.categoryKey}" restriction on ${entry.planName}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for plan restriction edit:", logErr);
    }

    return res.json({ entry });
  } catch (err: any) {
    console.error("Failed to update plan restriction:", err);
    return res.status(500).json({ error: `Failed to update this restriction: ${err.message}` });
  }
});

app.delete("/api/plan-restrictions/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Deleting a Plan-Specific Restriction"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid restriction id." });
    const { users: usersRepo, planRestrictions, changeLogs } = createRepositories(getDb());
    const existing = await planRestrictions.get(id);
    if (!existing) return res.status(404).json({ error: "Restriction not found." });
    await planRestrictions.delete(id);

    try {
      const callerTier = await getCallerTier(req, usersRepo);
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Plan Restriction Deleted",
        planName: existing.planName,
        description: `Deleted the "${existing.categoryKey}" restriction on ${existing.planName}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for plan restriction deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete plan restriction:", err);
    return res.status(500).json({ error: `Failed to delete this restriction: ${err.message}` });
  }
});

// --- Specific Illness Check — AI fallback (last-resort layer) ---
//
// The deterministic matchSpecificIllness() engine (src/specificIllnessEngine.ts)
// checks a declared condition against each plan's own already-listed
// Specific Illness schedule (hardcoded MASTER_ILLNESSES catalog + each
// plan's live DB-backed list). This endpoint is ONLY reached when that
// engine finds no_match for every plan — an advisor must explicitly click
// "Check with AI" (never fired automatically) — and Gemini is asked to
// double-check the SAME already-listed items, never to invent new ones or
// decide plan policy itself. Same "advisory, not authoritative" posture as
// the main Declaration Assistant engine's own Gemini fallback (see
// MASTER_CONSTITUTION.md's AI Usage section): the response is always framed
// as a suggestion for the advisor to verify against the plan's actual
// policy wording, never as a confirmed match.
function validateSpecificIllnessAiCheckBody(body: any): body is { condition: string } {
  return body && typeof body.condition === "string" && body.condition.trim().length > 0;
}

app.post("/api/specific-illness/ai-check", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!validateSpecificIllnessAiCheckBody(req.body)) {
      return res.status(400).json({ error: "condition is required." });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "AI check is not configured on this server (missing GEMINI_API_KEY)." });
    }
    const condition = req.body.condition.trim();

    // Build the same "every plan's already-listed Specific Illness items"
    // picture the Declaration Assistant results page shows (App.tsx's
    // effectiveSpecificIllnessesDict): a DB-backed list (Plan Management's
    // Plan-Specific Illness Manager) where one has been saved, falling back
    // to the hardcoded MASTER_ILLNESSES catalog's per-plan schedule text
    // where it hasn't. Gemini is only ever shown these existing items — it
    // is never asked to invent a new illness or a new plan.
    let dbPlanRows: Array<{ planName: string; specificIllnesses?: Array<{ category?: string | null; illness: string }> }> = [];
    try {
      const { planConfigs } = createRepositories(getDb());
      // planConfigs.list() types its jsonb columns (specificIllnesses among
      // them) as `unknown` at the repository layer — same as every other
      // consumer of this column elsewhere in server.ts — so a narrowing cast
      // to the shape validateSpecificIllnesses() already enforces on write
      // is expected here, not a type-safety gap.
      dbPlanRows = (await planConfigs.list()) as unknown as typeof dbPlanRows;
    } catch (err) {
      console.error("[Specific Illness AI Check] Failed to load DB plan configs (continuing with hardcoded catalog only):", err);
    }

    const planIllnessLists: Record<string, string[]> = {};
    dbPlanRows.forEach((row) => {
      if (row.specificIllnesses && row.specificIllnesses.length > 0) {
        planIllnessLists[row.planName] = Array.from(new Set(row.specificIllnesses.map((si) => si.illness.trim()).filter(Boolean)));
      }
    });
    // Every plan name MASTER_ILLNESSES has a schedule for, whether or not it
    // already has a DB-backed list above — placeholder empty arrays here get
    // filled in the derivation pass below.
    MASTER_ILLNESSES.forEach((def) => {
      Object.keys(def.plan_schedules).forEach((planName) => {
        if (!planIllnessLists[planName]) planIllnessLists[planName] = [];
      });
    });
    // For plans with no DB list, derive their item set from MASTER_ILLNESSES
    // the same way the results page does — one entry per catalog condition
    // that has a schedule for that plan.
    Object.keys(planIllnessLists).forEach((planName) => {
      if (planIllnessLists[planName].length > 0) return;
      const derived = MASTER_ILLNESSES.filter((def) => Boolean(def.plan_schedules[planName])).map((def) => def.parent_illness);
      planIllnessLists[planName] = Array.from(new Set(derived));
    });

    const eligiblePlans = Object.entries(planIllnessLists).filter(([, items]) => items.length > 0);
    if (eligiblePlans.length === 0) {
      return res.json({
        condition,
        ai_matches: [],
        disclaimer: "No plan has any Specific Illness List on record to check against.",
      });
    }

    const ai = getAiClient();
    const prompt = [
      "You are assisting a health insurance advisor in India. A customer has declared this pre-existing medical condition:",
      `"${condition}"`,
      "",
      "Below is a JSON object of insurance plans, each with the EXACT list of illnesses/procedures already named in that plan's own Specific Illness waiting-period schedule (a fixed 2-year wait for the ones on the list, versus the standard longer non-specific PED wait for anything not on it).",
      "",
      JSON.stringify(planIllnessLists, null, 2),
      "",
      "TASK: For each plan, decide whether the declared condition is the SAME clinical condition as, or a direct clinical synonym/manifestation/procedure-equivalent of, one of that plan's OWN LISTED items above.",
      "",
      "STRICT RULES:",
      "1. Only ever select an item that is already listed for that plan, verbatim. Do not invent, rename, or generalize an item.",
      "2. Do not include a plan at all if none of its listed items plausibly cover the condition — do not force a weak match.",
      "3. Never guess across unrelated organ systems (e.g. do not match a skin condition to a cardiac item just because both are 'chronic').",
      "4. This is advisory only — you are not deciding underwriting policy, only flagging plausible matches for a human advisor to verify against the plan's actual policy wording.",
      "",
      "Respond with a JSON array (possibly empty) of matches, each with: planName (must be one of the plan names given above, exactly), matchedIllness (must be one of that plan's own listed items, exactly), confidence ('high'|'medium'|'low'), and reasoning (one concise sentence).",
    ].join("\n");

    const modelsToTry = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
    let response: any = null;
    let lastError: any = null;
    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  planName: { type: Type.STRING },
                  matchedIllness: { type: Type.STRING },
                  confidence: { type: Type.STRING, description: "'high', 'medium', or 'low'." },
                  reasoning: { type: Type.STRING },
                },
                required: ["planName", "matchedIllness", "confidence", "reasoning"],
              },
            },
          },
        });
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`[Specific Illness AI Check] Attempt failed with model ${model}:`, err?.message || err);
      }
    }
    if (!response) {
      throw lastError || new Error("Failed to get a response from Gemini.");
    }

    const text = response.text;
    if (!text) {
      throw new Error("No response returned from the Gemini API model.");
    }
    const parsed = JSON.parse(text);
    const rawMatches = Array.isArray(parsed) ? parsed : [];

    // Defense in depth: drop anything that isn't actually one of the plan's
    // own listed items, in case the model didn't follow instructions exactly
    // — this endpoint must never surface a fabricated illness or plan name.
    const aiMatches = rawMatches.filter((m: any) => {
      if (!m || typeof m.planName !== "string" || typeof m.matchedIllness !== "string") return false;
      const items = planIllnessLists[m.planName];
      return Array.isArray(items) && items.some((item) => item.toLowerCase() === m.matchedIllness.toLowerCase());
    }).map((m: any) => ({
      planName: m.planName,
      matchedIllness: m.matchedIllness,
      confidence: ["high", "medium", "low"].includes(String(m.confidence).toLowerCase()) ? String(m.confidence).toLowerCase() : "low",
      reasoning: typeof m.reasoning === "string" ? m.reasoning : "",
    }));

    return res.json({
      condition,
      ai_matches: aiMatches,
      disclaimer: "AI-suggested — not a confirmed match. Verify against the plan's actual policy wording before advising a customer.",
    });
  } catch (err: any) {
    console.error("Specific Illness AI check failed:", err);
    return res.status(500).json({ error: `AI check failed: ${err.message}` });
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
    if (!(await requireFeatureAccess(req, res, "flagged_responses", "Editor", "Resolving flagged responses"))) return;
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
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can permanently delete flagged reports." });
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

// Self-service "set my own Skill Domain" — powers the post-login prompt
// (SkillDomainPromptModal in App.tsx) shown to any already-provisioned user
// whose tags are still empty (unassigned), independent of tier. Deliberately
// narrow like first-time-setup above: callers can only ever set THEIR OWN
// tags (email comes from the verified session, never the request body), and
// this can ONLY change tags — nothing else about the row. The normal
// Developer-only PATCH /api/users/:email remains the route for editing
// anyone else's tags (or any other field).
app.patch("/api/me/tags", requireAuth, async (req, res) => {
  try {
    const { tags } = req.body;
    const resolvedTags = tags === undefined ? [] : tags;
    if (!isValidAdvisorTags(resolvedTags)) {
      return res.status(400).json({ error: `tags must be an array containing only: ${ADVISOR_TAG_VALUES.join(", ")}.` });
    }

    const { users: usersRepo } = createRepositories(getDb());
    const email = req.user!.email.toLowerCase();
    const existing = await usersRepo.findByEmail(email);
    if (!existing) {
      return res.status(404).json({ error: "No directory entry found for your account." });
    }

    const row = await usersRepo.updateUser(email, { tags: resolvedTags });
    return res.json({ user: row });
  } catch (err: any) {
    console.error("Failed to save the caller's Skill Domain tags:", err);
    return res.status(500).json({ error: `Failed to save your Skill Domain: ${err.message}` });
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
//
// 2026-08-25 — expanded to also collect Product tags + Department/Team/Role
// at signup (Task: "Expand User Onboarding + User Directory + Profile
// Card"), so an Admin no longer has to manually backfill these for every
// new hire. Department/Team/Role are REQUIRED (product decision, not an
// existing DB constraint — the columns stay nullable for existing/
// admin-created rows; POST /api/users' own optional-department/team/role
// validation pattern below is reused verbatim for the existence checks).
// Product tags stay OPTIONAL (2026-08-25 follow-up correction): central-
// level employees with no line-of-business training don't have a Health or
// Term domain to pick — same "may not know yet, an Admin can set it later"
// allowance PATCH /api/me/tags and POST /api/users already give this exact
// field elsewhere. Department/Team/Role are stored as the SAME
// departmentId/orgTeamId/roleId foreign keys the Directory and Product
// Assist eligibility evaluator already read — no parallel classification
// system, and this is the exact shape a Developer/Admin manually assigns
// via PUT /api/users:email today.
app.post("/api/me/first-time-setup", requireAuth, async (req, res) => {
  try {
    const { name, tactId, tags, departmentId, orgTeamId, roleId } = req.body;
    // Optional at signup — an omitted or empty selection just leaves the
    // user unassigned, same as before (and same as PATCH /api/me/tags and
    // POST /api/users allow for this field).
    const resolvedTags = tags === undefined ? [] : tags;
    // Normalized regardless of how it was typed — see normalizeTactId
    // (utils/tactId.ts). TactIdInput already constrains entry to
    // digits-only client-side; this is the server-side backstop.
    const normalizedTactId = typeof tactId === "string" ? normalizeTactId(tactId) : "";
    const hasDepartmentId = typeof departmentId === "number" && Number.isInteger(departmentId);
    const hasOrgTeamId = typeof orgTeamId === "number" && Number.isInteger(orgTeamId);
    const hasRoleId = typeof roleId === "number" && Number.isInteger(roleId);
    if (
      typeof name !== "string" || !name.trim() ||
      typeof tactId !== "string" || !normalizedTactId ||
      !isValidAdvisorTags(resolvedTags) ||
      !hasDepartmentId || !hasOrgTeamId || !hasRoleId
    ) {
      return res.status(400).json({
        error: `name, tactId, departmentId, orgTeamId, and roleId are all required. tags, if present, must be an array containing only: ${ADVISOR_TAG_VALUES.join(", ")}.`,
      });
    }

    const { users: usersRepo, departments, orgTeams, roles } = createRepositories(getDb());

    // Same existence checks as POST /api/users below — a signup can't
    // reference a Department/Team/Role that doesn't exist (or was
    // deactivated/renamed since the dropdown was fetched).
    const [dept, team, role] = await Promise.all([
      departments.get(departmentId),
      orgTeams.get(orgTeamId),
      roles.get(roleId),
    ]);
    if (!dept) return res.status(400).json({ error: "That department doesn't exist." });
    if (!team) return res.status(400).json({ error: "That team doesn't exist." });
    if (!role) return res.status(400).json({ error: "That role doesn't exist." });

    const email = req.user!.email.toLowerCase();
    const existing = await usersRepo.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "This account is already set up. Please refresh and sign in again." });
    }

    const newUser = await usersRepo.create({
      email,
      name: name.trim(),
      tactId: normalizedTactId,
      tier: "General",
      status: "Active",
      tags: resolvedTags,
      departmentId,
      orgTeamId,
      roleId,
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

// ─────────────────────────────────────────────────────────────────────────
// QA DASHBOARD — native port of the standalone Apps Script "Advisor QA
// Dashboard" (Google Sheets source of truth, read-only — see
// QA_DASHBOARD_SHEETS_SETUP.md). Identity comes from req.user (this app's
// own verified Google session), never a request body field — mirrors every
// other route in this file. Authorization (Admin/Guide/Mentor/Advisor) is
// resolved server-side per request from qaRoles.ts; the client only ever
// learns the result, never decides it.
// ─────────────────────────────────────────────────────────────────────────

function parseQaDateFilters(query: any): QaDateFilters | null {
  const { checkedFrom, checkedTo, tillDate } = query;
  if (typeof checkedFrom !== "string" || typeof checkedTo !== "string" || typeof tillDate !== "string") return null;
  const isDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDateStr(checkedFrom) || !isDateStr(checkedTo) || !isDateStr(tillDate)) return null;
  return { checkedFrom, checkedTo, tillDate };
}

app.get("/api/qa-dashboard/dashboard", requireAuth, async (req, res) => {
  try {
    const dateFilters = parseQaDateFilters(req.query);
    if (!dateFilters) return res.status(400).json({ error: "checkedFrom, checkedTo, and tillDate (yyyy-MM-dd) are required." });
    const requestedTactId = typeof req.query.tactId === "string" && req.query.tactId.trim() ? req.query.tactId.trim() : null;
    const result = await getQaDashboardData(req.user!.email, requestedTactId, dateFilters);
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to load dashboard data:", err);
    return res.status(500).json({ error: `Failed to load QA dashboard: ${err.message}` });
  }
});

// Real trigger history for processRawDump (Phase1_DataEngine.gs), via the
// Apps Script Executions API — backs the QA Performance card's "Last
// updated" label. lastRunAt is null (still HTTP 200) whenever this can't be
// answered yet (grant not (re)connected with the script.processes scope,
// or the connected account lacks access to the script project) — that's an
// expected, non-error state for an optional label, not a 500.
app.get("/api/qa-dashboard/last-processed", requireAuth, async (req, res) => {
  try {
    const lastRun = await getLastExecutionTime("processRawDump");
    return res.json({ lastRunAt: lastRun ? lastRun.toISOString() : null });
  } catch (err: any) {
    console.error("QA Dashboard: failed to load last-processed time:", err);
    return res.status(500).json({ error: `Failed to load last-processed time: ${err.message}` });
  }
});

app.get("/api/qa-dashboard/advisors", requireAuth, async (req, res) => {
  try {
    const result = await listQaAdvisorsForCaller(req.user!.email);
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to list advisors:", err);
    return res.status(500).json({ error: `Failed to load advisor list: ${err.message}` });
  }
});

app.get("/api/qa-dashboard/feedback", requireAuth, async (req, res) => {
  try {
    const requestedTactId = typeof req.query.tactId === "string" && req.query.tactId.trim() ? req.query.tactId.trim() : null;
    const checkedFrom = typeof req.query.checkedFrom === "string" && req.query.checkedFrom ? req.query.checkedFrom : null;
    const checkedTo = typeof req.query.checkedTo === "string" && req.query.checkedTo ? req.query.checkedTo : null;
    const result = await getQaFeedbackRowsFor(req.user!.email, requestedTactId, checkedFrom, checkedTo);
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to load feedback rows:", err);
    return res.status(500).json({ error: `Failed to load feedback rows: ${err.message}` });
  }
});

app.get("/api/qa-dashboard/reviews", requireAuth, async (req, res) => {
  try {
    const requestedTactId = typeof req.query.tactId === "string" && req.query.tactId.trim() ? req.query.tactId.trim() : null;
    const checkedFrom = typeof req.query.checkedFrom === "string" && req.query.checkedFrom ? req.query.checkedFrom : null;
    const checkedTo = typeof req.query.checkedTo === "string" && req.query.checkedTo ? req.query.checkedTo : null;
    const result = await getQaReviewRowsFor(req.user!.email, requestedTactId, checkedFrom, checkedTo);
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to load review rows:", err);
    return res.status(500).json({ error: `Failed to load review rows: ${err.message}` });
  }
});

// --- QA Dashboard: "Connect Google Sheets" (see googleOAuth.ts / sheetsClient.ts) ---
// Admin/Developer only to initiate or tear down; connection-status is
// readable by anyone signed in so the Developer Controls UI (and, if ever
// needed, a friendlier "not configured" message elsewhere) can reflect it.

app.get("/api/qa-dashboard/connect-google", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Connecting Google Sheets"))) return;
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(QA_SHEETS_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(getQaDashboardSheetsAuthUrl(state, req.user!.email));
  } catch (err: any) {
    console.error("Failed to start QA Dashboard Google Sheets connection:", err);
    res.status(500).send("Could not start the connection. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example.");
  }
});

app.get("/api/qa-dashboard/connection-status", requireAuth, async (req, res) => {
  try {
    const { qaDashboardConnection } = createRepositories(getDb());
    const row = await qaDashboardConnection.get();
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${QA_MASTER_SPREADSHEET_ID}/edit`;
    return res.json(row ? { connected: true, connectedEmail: row.connectedEmail, connectedAt: row.connectedAt, sheetUrl } : { connected: false, sheetUrl });
  } catch (err: any) {
    console.error("QA Dashboard: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${err.message}` });
  }
});

app.delete("/api/qa-dashboard/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Disconnecting Google Sheets"))) return;
    const { qaDashboardConnection } = createRepositories(getDb());
    await qaDashboardConnection.clear();
    invalidateQaSheetsAuthCache();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("QA Dashboard: failed to disconnect Google Sheets:", err);
    return res.status(500).json({ error: `Failed to disconnect: ${err.message}` });
  }
});

// --- Advisor Directory Sync (2026-08) — master_advisors -> users.
// department/team/role/tags, via the same QA Dashboard Sheets connection
// above. See advisorDirectorySync.ts for the full sync logic; this route is
// just the trigger + result reporting, same shape as /api/kb/faq/resync.
// Admin/Developer only (a directory-wide write action), rate-limited like
// every other expensive admin action. ---
app.post("/api/qa-dashboard/advisor-directory-sync", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Syncing the Advisor Directory"))) return;
    const repos = createRepositories(getDb());
    const callerTier = await getCallerTier(req, repos.users);
    const { changeLogs } = repos;
    const result = await syncAdvisorDirectory(repos, `${req.user!.name} (${callerTier})`);

    if (result.errors.length === 0) {
      try {
        await changeLogs.create({
          userName: req.user!.name,
          role: callerTier,
          actionType: "Advisor Directory Synced",
          planName: null,
          description:
            `Advisor Directory Sync: ${result.recordsRead} record(s) read, ${result.currentlyEmployedRecords} Currently Employed, ` +
            `${result.usersMatched} matched, ${result.usersUpdated} updated, ${result.usersUnchanged} unchanged, ` +
            `${result.usersReverted} reverted, ${result.usersSkippedNotFound} skipped (not found).`,
          snapshot: null,
        });
      } catch (logErr) {
        console.error("Failed to write change log for Advisor Directory Sync:", logErr);
      }
    }

    return res.json(result);
  } catch (err: any) {
    console.error("Advisor Directory Sync failed:", err);
    return res.status(500).json({ error: `Advisor Directory Sync failed: ${err.message}` });
  }
});

// --- Product Assist Log Export (TEMPORARY — see product_assist_logs's schema
// comment in schema.ts). Same "Connect Google Sheets" pattern as the QA
// Dashboard/Playbook connections above, but this grant is WRITE-scope and
// the export-and-clear route additionally accepts a shared-secret header so
// an external monthly scheduler (Cloud Scheduler) can trigger it without a
// human session — see .env.example's PRODUCT_ASSIST_LOG_EXPORT_SECRET. ---

/**
 * drizzle-orm's postgres-js driver wraps every failed query in a generic
 * `Error: Failed query: <sql> params: <params>` — the ACTUAL Postgres error
 * (e.g. "relation ... does not exist") lands on `err.cause`, not
 * `err.message`. Routes that only read `err.message` (as several below did)
 * surface that useless wrapper to the client instead of the real cause —
 * exactly what happened here when migration 0039 (product_assist_logs /
 * product_assist_log_export_connection) hadn't been applied yet against a
 * given database: the UI showed "Failed query: select count(*) from
 * \"product_assist_logs\" params:" with nothing after "params:", instead of
 * the actual "relation ... does not exist". Mirrors the same
 * missing-table detection server.ts's ai_memory routes already do inline,
 * generalized to any table and reusable across this block.
 */
function describeDbError(err: any): string {
  const cause = err?.cause?.message || err?.message || "Unknown error";
  if (/relation .* does not exist/i.test(cause)) {
    return `${cause} — a database migration hasn't been applied yet. Run "npm run db:migrate" against this environment's DATABASE_URL.`;
  }
  return cause;
}

app.get("/api/product-assist-logs/connect-google", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Connecting Google Sheets"))) return;
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(PRODUCT_ASSIST_LOG_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(getProductAssistLogExportSheetsAuthUrl(state, req.user!.email));
  } catch (err: any) {
    console.error("Failed to start Product Assist Log Export Google Sheets connection:", err);
    res.status(500).send("Could not start the connection. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example.");
  }
});

app.get("/api/product-assist-logs/connection-status", requireAuth, async (req, res) => {
  try {
    const { productAssistLogExportConnection, productAssistLogs } = createRepositories(getDb());
    const [row, pendingCount] = await Promise.all([productAssistLogExportConnection.get(), productAssistLogs.count()]);
    // User-provided destination sheet (not a fixed workbook this app owns —
    // see productAssistLogSheetsClient.ts's doc comment), so there's no URL
    // to offer until the env var is actually set.
    const logSheetId = process.env.PRODUCT_ASSIST_LOG_SHEET_ID;
    const sheetUrl = logSheetId ? `https://docs.google.com/spreadsheets/d/${logSheetId}/edit` : null;
    return res.json(
      row
        ? { connected: true, connectedEmail: row.connectedEmail, connectedAt: row.connectedAt, pendingCount, sheetUrl }
        : { connected: false, pendingCount, sheetUrl }
    );
  } catch (err: any) {
    console.error("Product Assist Log Export: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${describeDbError(err)}` });
  }
});

app.delete("/api/product-assist-logs/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Disconnecting Google Sheets"))) return;
    const { productAssistLogExportConnection } = createRepositories(getDb());
    await productAssistLogExportConnection.clear();
    invalidateProductAssistLogSheetsAuthCache();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Product Assist Log Export: failed to disconnect Google Sheets:", err);
    return res.status(500).json({ error: `Failed to disconnect: ${describeDbError(err)}` });
  }
});

// Dual auth: a signed-in Admin/Developer clicking "Export & Clear Now" in
// Connections, OR a matching X-Cron-Secret header (no session) for an
// external monthly scheduler — see PRODUCT_ASSIST_LOG_EXPORT_SECRET in
// .env.example. Neither path is required if the other is missing/unset;
// if PRODUCT_ASSIST_LOG_EXPORT_SECRET isn't set, only the session path works.
app.post("/api/product-assist-logs/export-and-clear", async (req, res) => {
  try {
    const cronSecret = process.env.PRODUCT_ASSIST_LOG_EXPORT_SECRET;
    const providedSecret = req.header("X-Cron-Secret");
    const viaCron = !!cronSecret && !!providedSecret && providedSecret === cronSecret;

    if (!viaCron) {
      // attachUser (mounted globally) has already populated req.user, if any,
      // by the time this handler runs.
      if (!req.user) {
        return res.status(401).json({ error: "Sign-in required (or provide a valid X-Cron-Secret header)." });
      }
      if (!(await requireAdminOrDeveloper(req, res, "Exporting Product Assist logs"))) return;
    }

    const repos = createRepositories(getDb());
    const result = await runProductAssistLogExport(repos);
    return res.json(result);
  } catch (err: any) {
    console.error("Product Assist Log Export: export-and-clear failed:", err);
    return res.status(500).json({ error: `Export failed: ${describeDbError(err)}` });
  }
});

// --- QA Dashboard Access (Admin/Guide/Mentor role management) ---
// Source of truth for src/server/qaDashboard/qaRoles.ts — see the
// qa_dashboard_roles table (schema.ts) for why this replaced the
// QA_ADMIN_EMAILS/QA_GUIDE_EMAILS/QA_MENTOR_EMAILS env vars. Viewing and
// editing are both Admin+Developer here (unlike the rest of User Directory
// & Management, where editing core WebApp tiers stays Developer-only) —
// QA role assignment is a narrower, QA-team-specific permission.

const QA_ROLE_TYPES = ["admin", "guide", "mentor"] as const;

app.get("/api/qa-dashboard/roles", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing QA Dashboard access"))) return;
    const { qaDashboardRoles } = createRepositories(getDb());
    const rows = await qaDashboardRoles.listAll();
    return res.json({ roles: rows });
  } catch (err: any) {
    console.error("QA Dashboard: failed to list role assignments:", err);
    return res.status(500).json({ error: `Failed to load QA Dashboard access: ${err.message}` });
  }
});

app.post("/api/qa-dashboard/roles", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing QA Dashboard access"))) return;
    const { email, role, displayName } = req.body;
    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "email is required." });
    }
    if (typeof role !== "string" || !(QA_ROLE_TYPES as readonly string[]).includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${QA_ROLE_TYPES.join(", ")}` });
    }
    const { qaDashboardRoles, users: usersRepo, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const row = await qaDashboardRoles.upsert({
      email: email.trim().toLowerCase(),
      role: role as "admin" | "guide" | "mentor",
      displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null,
      assignedBy: `${req.user!.name} (${callerTier})`,
    });
    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "QA Dashboard Access Changed",
        planName: null,
        description: `Granted ${row.email} QA Dashboard "${row.role}" access${row.displayName ? ` (as "${row.displayName}")` : ""}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for QA Dashboard access:", logErr);
    }
    return res.json({ role: row });
  } catch (err: any) {
    console.error("QA Dashboard: failed to assign role:", err);
    return res.status(500).json({ error: `Failed to save this assignment: ${err.message}` });
  }
});

app.delete("/api/qa-dashboard/roles/:email", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Editing QA Dashboard access"))) return;
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    const { qaDashboardRoles, users: usersRepo, changeLogs } = createRepositories(getDb());
    const existing = await qaDashboardRoles.getByEmail(email);
    await qaDashboardRoles.remove(email);
    const callerTier = await getCallerTier(req, usersRepo);
    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "QA Dashboard Access Changed",
        planName: null,
        description: `Revoked QA Dashboard access for ${email}${existing ? ` (was "${existing.role}")` : ""}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for QA Dashboard access:", logErr);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("QA Dashboard: failed to revoke role:", err);
    return res.status(500).json({ error: `Failed to revoke access: ${err.message}` });
  }
});

app.get("/api/qa-dashboard/summary", requireAuth, async (req, res) => {
  try {
    const dateFilters = parseQaDateFilters(req.query);
    if (!dateFilters) return res.status(400).json({ error: "checkedFrom, checkedTo, and tillDate (yyyy-MM-dd) are required." });
    const result = await getQaAdvisorsDashboardListFor(req.user!.email, dateFilters);
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to load advisors summary:", err);
    return res.status(500).json({ error: `Failed to load advisors summary: ${err.message}` });
  }
});

// Deliberately open to ANY signed-in user (no Admin/Guide/Mentor/Advisor
// role check) — see getCompanyWideQaAggregateFor's doc comment. Only ever
// returns 4 aggregate numbers, never the per-advisor roster the route
// above returns, so this can't be used to see the real QA Dashboard's data
// through a side door.
app.get("/api/qa-dashboard/company-summary", requireAuth, async (req, res) => {
  try {
    const dateFilters = parseQaDateFilters(req.query);
    if (!dateFilters) return res.status(400).json({ error: "checkedFrom, checkedTo, and tillDate (yyyy-MM-dd) are required." });
    const result = await getQaCompanyWideAggregateFor(dateFilters);
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to load company-wide aggregate:", err);
    return res.status(500).json({ error: `Failed to load company-wide aggregate: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Knowledge Base ("Ask the Playbook") — admin-only CRUD for categories,
// resources (PDFs today; web/sheet ingestion is a later phase), and
// announcements. Admin Zone (Admin/Developer only), same gate as PED
// Repository/Plan Management. The advisor-facing chat/query endpoint that
// actually reads this data is a separate, later phase.
// ─────────────────────────────────────────────────────────────────────────

const kbPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — generous for a policy wording PDF
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are supported."));
    }
  },
});

// --- Product Playbook: "Connect Google Sheets" + Resync (see
// src/server/knowledgeBase/playbookIngest.ts / playbookSheetsClient.ts) ---
// Admin/Developer only to initiate, disconnect, or resync; connection
// status is readable by anyone signed in, same convention as the QA
// Dashboard's equivalent routes above.

app.get("/api/kb/playbook/connect-google", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Connecting Google Sheets"))) return;
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(KB_PLAYBOOK_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(getKbPlaybookSheetsAuthUrl(state, req.user!.email));
  } catch (err: any) {
    console.error("Failed to start Product Playbook Google Sheets connection:", err);
    res.status(500).send("Could not start the connection. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example.");
  }
});

app.get("/api/kb/playbook/connection-status", requireAuth, async (req, res) => {
  try {
    const { kbPlaybookConnection, kbResources, kbPlaybookPlanFacts } = createRepositories(getDb());
    const row = await kbPlaybookConnection.get();
    const resource = (await kbResources.list({})).find(r => r.type === "sheet");
    const planFactCount = resource ? (await kbPlaybookPlanFacts.listByResource(resource.id)).length : 0;
    return res.json({
      connected: !!row,
      connectedEmail: row?.connectedEmail ?? null,
      connectedAt: row?.connectedAt ?? null,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${PLAYBOOK_SPREADSHEET_ID}/edit`,
      resource: resource
        ? {
            status: resource.status,
            lastFetchedAt: resource.lastFetchedAt,
            errorMessage: resource.errorMessage,
            planFactCount,
            narrativeChunkCount: resource.chunkCount,
          }
        : null,
    });
  } catch (err: any) {
    console.error("Product Playbook: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${err.message}` });
  }
});

app.delete("/api/kb/playbook/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Disconnecting Google Sheets"))) return;
    const { kbPlaybookConnection } = createRepositories(getDb());
    await kbPlaybookConnection.clear();
    invalidatePlaybookSheetsAuthCache();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Product Playbook: failed to disconnect Google Sheets:", err);
    return res.status(500).json({ error: `Failed to disconnect: ${err.message}` });
  }
});

app.post("/api/kb/playbook/resync", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Resyncing the Product Playbook"))) return;
    const repos = createRepositories(getDb());
    const result = await syncPlaybook(repos, req.user!.email);
    if (result.resource.status === "error") {
      return res.status(500).json({ error: result.resource.errorMessage || "Sync failed.", resource: result.resource });
    }
    return res.json({
      ok: true,
      skipped: result.skipped,
      planFactCount: result.planFactCount,
      narrativeChunkCount: result.narrativeChunkCount,
      resource: result.resource,
    });
  } catch (err: any) {
    console.error("Product Playbook: resync failed:", err);
    return res.status(500).json({ error: `Resync failed: ${err.message}` });
  }
});

// --- Ditto FAQ: "Connect Google Sheets" + Resync (see
// src/server/knowledgeBase/faqIngest.ts / faqSheetsClient.ts) — same shape
// as the Product Playbook routes above, own OAuth grant/table/resource. ---

app.get("/api/kb/faq/connect-google", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Connecting Google Sheets"))) return;
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(KB_FAQ_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(getKbFaqSheetsAuthUrl(state, req.user!.email));
  } catch (err: any) {
    console.error("Failed to start Ditto FAQ Google Sheets connection:", err);
    res.status(500).send("Could not start the connection. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example.");
  }
});

app.get("/api/kb/faq/connection-status", requireAuth, async (req, res) => {
  try {
    const { kbFaqConnection, kbResources, faqRecords } = createRepositories(getDb());
    const row = await kbFaqConnection.get();
    const resource = (await kbResources.list({})).find(r => r.type === "sheet" && r.title === "Ditto FAQ");
    const records = resource ? await faqRecords.list({ resourceId: resource.id }) : [];
    return res.json({
      connected: !!row,
      connectedEmail: row?.connectedEmail ?? null,
      connectedAt: row?.connectedAt ?? null,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${FAQ_SPREADSHEET_ID}/edit`,
      resource: resource
        ? {
            status: resource.status,
            lastFetchedAt: resource.lastFetchedAt,
            errorMessage: resource.errorMessage,
            totalRecords: records.length,
            answerableCount: records.filter(r => r.isAnswerable && !r.hasConflict).length,
            incompleteCount: records.filter(r => !r.isAnswerable && !r.hasConflict).length,
            conflictingCount: records.filter(r => r.hasConflict).length,
            healthProductCount: records.filter(r => r.category === "health_product").length,
            operationsHealthCount: records.filter(r => r.category === "operations_health").length,
          }
        : null,
    });
  } catch (err: any) {
    console.error("Ditto FAQ: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${err.message}` });
  }
});

app.delete("/api/kb/faq/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Disconnecting Google Sheets"))) return;
    const { kbFaqConnection } = createRepositories(getDb());
    await kbFaqConnection.clear();
    invalidateFaqSheetsAuthCache();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Ditto FAQ: failed to disconnect Google Sheets:", err);
    return res.status(500).json({ error: `Failed to disconnect: ${err.message}` });
  }
});

app.post("/api/kb/faq/resync", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Resyncing the Ditto FAQ"))) return;
    const repos = createRepositories(getDb());
    const result = await syncFaq(repos, req.user!.email);
    if (result.resource.status === "error") {
      return res.status(500).json({ error: result.resource.errorMessage || "Sync failed.", resource: result.resource });
    }
    return res.json({
      ok: true,
      skipped: result.skipped,
      totalRecords: result.totalRecords,
      answerableCount: result.answerableCount,
      incompleteCount: result.incompleteCount,
      conflictingCount: result.conflictingCount,
      duplicatesCollapsed: result.duplicatesCollapsed,
      resource: result.resource,
    });
  } catch (err: any) {
    console.error("Ditto FAQ: resync failed:", err);
    return res.status(500).json({ error: `Resync failed: ${err.message}` });
  }
});

// Admin review listing — every record (including incomplete/conflicting,
// per spec §17/§18: "may remain visible to authorized Knowledge Hub users
// for administrative review"), never exposed to advisors outside this
// Admin/Developer-gated route.
app.get("/api/kb/faq/records", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing the Ditto FAQ"))) return;
    const { faqRecords } = createRepositories(getDb());
    const category = typeof req.query.category === "string" && FAQ_CATEGORIES.includes(req.query.category) ? (req.query.category as any) : undefined;
    const entries = await faqRecords.list({ category });
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list Ditto FAQ records:", err);
    return res.status(500).json({ error: `Failed to load FAQ records: ${err.message}` });
  }
});

// The only write this table supports outside a full resync — retiring a
// bad/outdated record (e.g. one side of a resolved conflict) without
// waiting for the next sheet edit. Never edits question/answer text itself:
// the Sheet remains the sole authoring source (spec §19).
app.patch("/api/kb/faq/records/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Editing a Ditto FAQ record"))) return;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });
    if (typeof req.body.isActive !== "boolean") return res.status(400).json({ error: "isActive (boolean) is required." });
    const { faqRecords, changeLogs, users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const updated = await faqRecords.setActive(id, req.body.isActive);
    if (!updated) return res.status(404).json({ error: "FAQ record not found." });
    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: req.body.isActive ? "Ditto FAQ Record Activated" : "Ditto FAQ Record Deactivated",
        planName: null,
        description: `${req.body.isActive ? "Activated" : "Deactivated"} Ditto FAQ record #${id}: "${updated.question}"`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Ditto FAQ record update:", logErr);
    }
    return res.json({ record: updated });
  } catch (err: any) {
    console.error("Failed to update Ditto FAQ record:", err);
    return res.status(500).json({ error: `Failed to update: ${err.message}` });
  }
});

// --- Categories ---

app.get("/api/kb/categories", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing the Knowledge Base"))) return;
    const { kbCategories } = createRepositories(getDb());
    const entries = await kbCategories.list();
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list KB categories:", err);
    return res.status(500).json({ error: `Failed to load categories: ${err.message}` });
  }
});

app.post("/api/kb/categories", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Adding a Knowledge Base category"))) return;
    const { name, type, sortOrder } = req.body;
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required." });
    if (type !== "insurer" && type !== "general") return res.status(400).json({ error: 'type must be "insurer" or "general".' });
    const { kbCategories } = createRepositories(getDb());
    const category = await kbCategories.create({ name: name.trim(), type, sortOrder: typeof sortOrder === "number" ? sortOrder : 0 });
    return res.json({ category });
  } catch (err: any) {
    console.error("Failed to create KB category:", err);
    return res.status(500).json({ error: `Failed to add category: ${err.message}` });
  }
});

app.patch("/api/kb/categories/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Editing a Knowledge Base category"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid category id." });
    const { name, type, sortOrder, planNames, disabledPlanNames } = req.body;
    if (type !== undefined && type !== "insurer" && type !== "general") {
      return res.status(400).json({ error: 'type must be "insurer" or "general".' });
    }
    if (planNames !== undefined) {
      if (!Array.isArray(planNames) || !planNames.every((t: unknown) => typeof t === "string")) {
        return res.status(400).json({ error: "planNames must be an array of strings." });
      }
    }
    if (disabledPlanNames !== undefined) {
      if (!Array.isArray(disabledPlanNames) || !disabledPlanNames.every((t: unknown) => typeof t === "string")) {
        return res.status(400).json({ error: "disabledPlanNames must be an array of strings." });
      }
    }
    const { kbCategories } = createRepositories(getDb());
    const category = await kbCategories.update(id, {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
      ...(planNames !== undefined ? { planNames: (planNames as string[]).map(t => t.trim()).filter(Boolean) } : {}),
      ...(disabledPlanNames !== undefined
        ? { disabledPlanNames: (disabledPlanNames as string[]).map(t => t.trim()).filter(Boolean) }
        : {}),
    });
    if (!category) return res.status(404).json({ error: "Category not found." });
    return res.json({ category });
  } catch (err: any) {
    console.error("Failed to update KB category:", err);
    return res.status(500).json({ error: `Failed to update category: ${err.message}` });
  }
});

app.delete("/api/kb/categories/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Deleting a Knowledge Base category"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid category id." });
    const { kbCategories, kbResources } = createRepositories(getDb());
    const resourcesInCategory = await kbResources.list({ categoryId: id });
    if (resourcesInCategory.length > 0) {
      return res.status(409).json({
        error: `This category has ${resourcesInCategory.length} resource(s) in it. Delete or move those first.`,
      });
    }
    await kbCategories.delete(id);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete KB category:", err);
    return res.status(500).json({ error: `Failed to delete category: ${err.message}` });
  }
});

// Renames a plan-roster entry within one insurer category — atomically (as
// atomic as this app's non-transactional DAL gets, see below) updates BOTH
// kb_categories.planNames AND every kb_resources.planTags entry that
// referenced the old name, so a rename never silently strands resources
// under a name that no longer exists in the roster. A plain client-side
// "remove old name, add new name" would NOT do this — it only ever touches
// category.planNames, leaving every already-tagged resource's planTags
// pointing at the now-gone old name (exactly the kind of orphaned reference
// Workstream A's plan CRUD rules forbid).
app.post("/api/kb/categories/:id/rename-plan", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Renaming a Knowledge Base plan"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid category id." });
    const oldName = typeof req.body.oldName === "string" ? req.body.oldName.trim() : "";
    const newName = typeof req.body.newName === "string" ? req.body.newName.trim() : "";
    if (!oldName || !newName) return res.status(400).json({ error: "oldName and newName are required." });
    if (oldName.toLowerCase() === newName.toLowerCase()) {
      return res.status(400).json({ error: "New name is the same as the current name." });
    }

    const { kbCategories, kbResources } = createRepositories(getDb());
    const category = await kbCategories.get(id);
    if (!category) return res.status(404).json({ error: "Category not found." });
    if (category.planNames.some(n => n.toLowerCase() === newName.toLowerCase())) {
      return res.status(409).json({ error: `"${newName}" is already a plan on this insurer.` });
    }

    const nextPlanNames = category.planNames.map(n => (n.toLowerCase() === oldName.toLowerCase() ? newName : n));
    const nextDisabled = category.disabledPlanNames.map(n => (n.toLowerCase() === oldName.toLowerCase() ? newName : n));
    await kbCategories.update(id, { planNames: nextPlanNames, disabledPlanNames: nextDisabled });

    const resourcesInCategory = await kbResources.list({ categoryId: id });
    const affected = resourcesInCategory.filter(r => r.planTags.some(t => t.toLowerCase() === oldName.toLowerCase()));
    const failedResourceIds: number[] = [];
    for (const r of affected) {
      const nextTags = r.planTags.map(t => (t.toLowerCase() === oldName.toLowerCase() ? newName : t));
      const updated = await kbResources.update(r.id, { planTags: nextTags });
      if (!updated) failedResourceIds.push(r.id);
    }

    if (failedResourceIds.length > 0) {
      // The roster rename itself already succeeded, so this is reported as
      // a partial-failure warning rather than an error — the admin can
      // retag these specific resources by hand from the resource editor.
      return res.status(207).json({
        ok: true,
        renamedResourceCount: affected.length - failedResourceIds.length,
        failedResourceIds,
        warning: `Renamed the plan, but ${failedResourceIds.length} tagged resource(s) could not be re-tagged automatically. Re-tag them manually via the resource editor.`,
      });
    }
    return res.json({ ok: true, renamedResourceCount: affected.length });
  } catch (err: any) {
    console.error("Failed to rename KB plan:", err);
    return res.status(500).json({ error: `Failed to rename plan: ${err.message}` });
  }
});

// --- Resources ---

app.get("/api/kb/resources", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing the Knowledge Base"))) return;
    const categoryId = req.query.categoryId !== undefined ? Number(req.query.categoryId) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const { kbResources } = createRepositories(getDb());
    const entries = await kbResources.list({
      ...(categoryId !== undefined && Number.isInteger(categoryId) ? { categoryId } : {}),
      ...(status ? { status: status as any } : {}),
    });
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list KB resources:", err);
    return res.status(500).json({ error: `Failed to load resources: ${err.message}` });
  }
});

app.post("/api/kb/resources/upload", requireAuth, (req, res, next) => {
  kbPdfUpload.single("file")(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    next();
  });
}, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Uploading a Knowledge Base document"))) return;
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: "No file uploaded (expected multipart field \"file\")." });

    const categoryId = Number(req.body.categoryId);
    if (!Number.isInteger(categoryId)) return res.status(400).json({ error: "categoryId is required." });
    const title = typeof req.body.title === "string" && req.body.title.trim() ? req.body.title.trim() : file.originalname;
    if (req.body.documentType !== undefined && !KB_DOCUMENT_TYPES.includes(req.body.documentType)) {
      return res.status(400).json({ error: `documentType must be one of: ${KB_DOCUMENT_TYPES.join(", ")}.` });
    }

    const { kbCategories } = createRepositories(getDb());
    const category = await kbCategories.get(categoryId);
    if (!category) return res.status(400).json({ error: "Category not found." });

    const repos = createRepositories(getDb());
    const result = await ingestPdfResource(repos, {
      categoryId,
      title,
      sourceLabel: file.originalname,
      documentType: req.body.documentType,
      buffer: file.buffer,
      addedBy: `${req.user!.name} (${req.user!.email})`,
    });

    if (result.resource.status === "error") {
      return res.status(422).json({ error: result.resource.errorMessage || "Failed to process PDF.", resource: result.resource });
    }
    return res.json({ resource: result.resource, chunkCount: result.chunkCount });
  } catch (err: any) {
    console.error("Failed to upload/ingest KB PDF:", err);
    return res.status(500).json({ error: `Failed to upload document: ${err.message}` });
  }
});

// Add a resource by pasting a link instead of uploading a file — for a
// hosted policy-wording PDF or an ordinary web article (insurer "how to
// claim" guides, glossaries, etc.). See webIngest.ts: the URL's real
// Content-Type decides which pipeline it goes through, not the button the
// admin clicked. Same idempotency guarantee as upload — re-adding the same
// URL re-uses that resource and skips re-embedding if the content hasn't
// changed.
app.post("/api/kb/resources/add-url", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Adding a Knowledge Base document"))) return;
    const { url, categoryId: rawCategoryId, title: rawTitle, documentType } = req.body;
    if (typeof url !== "string" || !url.trim()) return res.status(400).json({ error: "url is required." });
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      return res.status(400).json({ error: "That doesn't look like a valid URL." });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return res.status(400).json({ error: "Only http(s) URLs are supported." });
    }
    if (documentType !== undefined && !KB_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ error: `documentType must be one of: ${KB_DOCUMENT_TYPES.join(", ")}.` });
    }

    const categoryId = Number(rawCategoryId);
    if (!Number.isInteger(categoryId)) return res.status(400).json({ error: "categoryId is required." });
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : parsedUrl.hostname + parsedUrl.pathname;

    const { kbCategories } = createRepositories(getDb());
    const category = await kbCategories.get(categoryId);
    if (!category) return res.status(400).json({ error: "Category not found." });

    const repos = createRepositories(getDb());
    const result = await ingestUrlResource(repos, {
      categoryId,
      title,
      url: parsedUrl.toString(),
      documentType,
      addedBy: `${req.user!.name} (${req.user!.email})`,
    });

    if (result.resource.status === "error") {
      return res.status(422).json({ error: result.resource.errorMessage || "Failed to process the URL.", resource: result.resource });
    }
    return res.json({ resource: result.resource, chunkCount: result.chunkCount, detectedType: result.detectedType });
  } catch (err: any) {
    console.error("Failed to add/ingest KB URL:", err);
    return res.status(500).json({ error: `Failed to add the document: ${err.message}` });
  }
});

app.patch("/api/kb/resources/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Editing a Knowledge Base resource"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid resource id." });
    const { title, categoryId, status, planTags, documentType, isInsurerLevel } = req.body;
    if (planTags !== undefined) {
      if (!Array.isArray(planTags) || !planTags.every((t: unknown) => typeof t === "string")) {
        return res.status(400).json({ error: "planTags must be an array of strings." });
      }
    }
    if (documentType !== undefined && !KB_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ error: `documentType must be one of: ${KB_DOCUMENT_TYPES.join(", ")}.` });
    }
    if (isInsurerLevel !== undefined && typeof isInsurerLevel !== "boolean") {
      return res.status(400).json({ error: "isInsurerLevel must be a boolean." });
    }
    const { kbResources } = createRepositories(getDb());
    const resource = await kbResources.update(id, {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(categoryId !== undefined ? { categoryId: Number(categoryId) } : {}),
      ...(status !== undefined ? { status } : {}),
      // An insurer-level resource isn't tied to a plan, so setting it also
      // clears planTags — reusing the same "not plan-specific" concept two
      // different ways at once (isInsurerLevel=true AND non-empty planTags)
      // would be an incoherent state no reader of this table should have to
      // guard against downstream.
      ...(planTags !== undefined ? { planTags: (planTags as string[]).map(t => t.trim()).filter(Boolean) } : {}),
      ...(documentType !== undefined ? { documentType } : {}),
      ...(isInsurerLevel !== undefined ? { isInsurerLevel, ...(isInsurerLevel ? { planTags: [] } : {}) } : {}),
    });
    if (!resource) return res.status(404).json({ error: "Resource not found." });
    return res.json({ resource });
  } catch (err: any) {
    console.error("Failed to update KB resource:", err);
    return res.status(500).json({ error: `Failed to update resource: ${err.message}` });
  }
});

app.delete("/api/kb/resources/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Deleting a Knowledge Base resource"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid resource id." });
    const { kbResources } = createRepositories(getDb());
    await kbResources.delete(id);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete KB resource:", err);
    return res.status(500).json({ error: `Failed to delete resource: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Special Instructions — Product Assist's controlled instruction-override
// layer (see schema.ts's doc comment on `specialInstructions` and
// src/server/knowledgeBase/specialInstructions.ts for how these are matched
// and applied at query time). Read access matches the rest of the Knowledge
// Base admin routes (Admin/Platform Admin/Developer); writes are narrower —
// per spec, ONLY Developer or Platform Admin may create/edit/activate/
// deactivate/delete an instruction (isDeveloperPower, not
// requireAdminOrDeveloper/isAdminPower) since these directly steer Product
// Assist's answers.
// ─────────────────────────────────────────────────────────────────────────

app.get("/api/kb/special-instructions", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing Special Instructions"))) return;
    const { topic, instructionType, insurerCategoryId, isActive } = req.query;
    const { specialInstructions } = createRepositories(getDb());
    const entries = await specialInstructions.list({
      ...(typeof topic === "string" && topic.trim() ? { topic: topic.trim() } : {}),
      ...(typeof instructionType === "string" && SPECIAL_INSTRUCTION_TYPES.includes(instructionType) ? { instructionType: instructionType as any } : {}),
      ...(insurerCategoryId !== undefined && Number.isInteger(Number(insurerCategoryId)) ? { insurerCategoryId: Number(insurerCategoryId) } : {}),
      ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
    });
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list Special Instructions:", err);
    return res.status(500).json({ error: `Failed to load Special Instructions: ${err.message}` });
  }
});

app.post("/api/kb/special-instructions", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, specialInstructions, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can create Special Instructions." });
    }
    const { topic, instructionText, instructionType, insurerCategoryId, productPlanName } = req.body;
    if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "topic is required." });
    if (typeof instructionText !== "string" || !instructionText.trim()) {
      return res.status(400).json({ error: "instructionText is required." });
    }
    if (typeof instructionType !== "string" || !SPECIAL_INSTRUCTION_TYPES.includes(instructionType)) {
      return res.status(400).json({ error: `instructionType must be one of: ${SPECIAL_INSTRUCTION_TYPES.join(", ")}.` });
    }
    let resolvedInsurerCategoryId: number | null = null;
    if (insurerCategoryId !== undefined && insurerCategoryId !== null && insurerCategoryId !== "") {
      const idNum = Number(insurerCategoryId);
      if (!Number.isInteger(idNum)) return res.status(400).json({ error: "Invalid insurerCategoryId." });
      const category = await createRepositories(getDb()).kbCategories.get(idNum);
      if (!category) return res.status(400).json({ error: "Insurer category not found." });
      resolvedInsurerCategoryId = idNum;
    }
    const resolvedProductPlanName =
      typeof productPlanName === "string" && productPlanName.trim() ? productPlanName.trim() : null;

    const [topicEmbedding] = await embedDocumentChunks([topic.trim()]);
    const entry = await specialInstructions.create({
      topic: topic.trim(),
      instructionText: instructionText.trim(),
      instructionType: instructionType as any,
      insurerCategoryId: resolvedInsurerCategoryId,
      productPlanName: resolvedProductPlanName,
      topicEmbedding,
      createdBy: `${req.user!.name} (${req.user!.email})`,
      updatedBy: `${req.user!.name} (${req.user!.email})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Special Instruction Created",
        planName: null,
        description: `Created "${entry.topic}" (${entry.instructionType}).`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Special Instruction creation:", logErr);
    }

    return res.json({ entry });
  } catch (err: any) {
    console.error("Failed to create Special Instruction:", err);
    return res.status(500).json({ error: `Failed to create this Special Instruction: ${err.message}` });
  }
});

app.patch("/api/kb/special-instructions/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, specialInstructions, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can edit Special Instructions." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid Special Instruction id." });
    const existing = await specialInstructions.get(id);
    if (!existing) return res.status(404).json({ error: "Special Instruction not found." });

    const { topic, instructionText, instructionType, insurerCategoryId, productPlanName, isActive } = req.body;
    if (instructionType !== undefined && !SPECIAL_INSTRUCTION_TYPES.includes(instructionType)) {
      return res.status(400).json({ error: `instructionType must be one of: ${SPECIAL_INSTRUCTION_TYPES.join(", ")}.` });
    }
    let resolvedInsurerCategoryId: number | null | undefined = undefined;
    if (insurerCategoryId !== undefined) {
      if (insurerCategoryId === null || insurerCategoryId === "") {
        resolvedInsurerCategoryId = null;
      } else {
        const idNum = Number(insurerCategoryId);
        if (!Number.isInteger(idNum)) return res.status(400).json({ error: "Invalid insurerCategoryId." });
        const category = await createRepositories(getDb()).kbCategories.get(idNum);
        if (!category) return res.status(400).json({ error: "Insurer category not found." });
        resolvedInsurerCategoryId = idNum;
      }
    }

    const trimmedTopic = typeof topic === "string" && topic.trim() ? topic.trim() : undefined;
    // Recompute the topic embedding whenever the topic text actually
    // changes — the stored embedding must always reflect the current topic
    // for query-time relevance matching to stay accurate. Skipped on every
    // other field-only edit (Activate/Deactivate, scope change, instruction
    // text edit) to avoid an unnecessary embedding call.
    const newTopicEmbedding =
      trimmedTopic !== undefined && trimmedTopic !== existing.topic ? (await embedDocumentChunks([trimmedTopic]))[0] : undefined;

    const entry = await specialInstructions.update(id, {
      ...(trimmedTopic !== undefined ? { topic: trimmedTopic } : {}),
      ...(newTopicEmbedding !== undefined ? { topicEmbedding: newTopicEmbedding } : {}),
      ...(typeof instructionText === "string" && instructionText.trim() ? { instructionText: instructionText.trim() } : {}),
      ...(instructionType !== undefined ? { instructionType: instructionType as any } : {}),
      ...(resolvedInsurerCategoryId !== undefined ? { insurerCategoryId: resolvedInsurerCategoryId } : {}),
      ...(productPlanName !== undefined
        ? { productPlanName: typeof productPlanName === "string" && productPlanName.trim() ? productPlanName.trim() : null }
        : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      updatedBy: `${req.user!.name} (${req.user!.email})`,
    });
    if (!entry) return res.status(404).json({ error: "Special Instruction not found." });

    try {
      const actionType =
        typeof isActive === "boolean" && Object.keys(req.body).length === 1
          ? isActive
            ? "Special Instruction Activated"
            : "Special Instruction Deactivated"
          : "Special Instruction Edited";
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType,
        planName: null,
        description: `Updated "${entry.topic}" (${entry.instructionType}).`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Special Instruction edit:", logErr);
    }

    return res.json({ entry });
  } catch (err: any) {
    console.error("Failed to update Special Instruction:", err);
    return res.status(500).json({ error: `Failed to update this Special Instruction: ${err.message}` });
  }
});

app.delete("/api/kb/special-instructions/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, specialInstructions, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can delete Special Instructions." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid Special Instruction id." });
    const existing = await specialInstructions.get(id);
    if (!existing) return res.status(404).json({ error: "Special Instruction not found." });
    await specialInstructions.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Special Instruction Deleted",
        planName: null,
        description: `Deleted "${existing.topic}" (${existing.instructionType}).`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Special Instruction deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete Special Instruction:", err);
    return res.status(500).json({ error: `Failed to delete this Special Instruction: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Acronym Dictionary — shorthand advisors habitually type (e.g. "OS" for
// "Optima Secure", "CBB" for "Cumulative Bonus Booster") mapped to its full
// expansion, so Product Assist can recognize it instead of retrieving
// poorly or treating the question as ambiguous. See schema.ts's doc comment
// on `kbAcronyms` and src/server/knowledgeBase/acronyms.ts for how these
// are matched and applied at query time. Same permission model as Special
// Instructions above: Admin/Platform Admin/Developer can view; only
// Developer or Platform Admin can create/edit/delete, since these directly
// steer Product Assist's retrieval and plan detection.
// ─────────────────────────────────────────────────────────────────────────

app.get("/api/kb/acronyms", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing the Acronym Dictionary"))) return;
    const { search, isActive } = req.query;
    const { kbAcronyms } = createRepositories(getDb());
    const entries = await kbAcronyms.list({
      ...(typeof search === "string" && search.trim() ? { search: search.trim() } : {}),
      ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
    });
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list Acronym Dictionary entries:", err);
    return res.status(500).json({ error: `Failed to load the Acronym Dictionary: ${err.message}` });
  }
});

app.post("/api/kb/acronyms", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, kbAcronyms, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can add Acronym Dictionary entries." });
    }
    const { acronym, expansion, notes } = req.body;
    if (typeof acronym !== "string" || !acronym.trim()) return res.status(400).json({ error: "acronym is required." });
    if (typeof expansion !== "string" || !expansion.trim()) return res.status(400).json({ error: "expansion is required." });

    const entry = await kbAcronyms.create({
      acronym: acronym.trim(),
      expansion: expansion.trim(),
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      isActive: true,
      createdBy: `${req.user!.name} (${req.user!.email})`,
      updatedBy: `${req.user!.name} (${req.user!.email})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Acronym Dictionary Entry Created",
        planName: null,
        description: `Added "${entry.acronym}" -> "${entry.expansion}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Acronym Dictionary creation:", logErr);
    }

    return res.json({ entry });
  } catch (err: any) {
    console.error("Failed to create Acronym Dictionary entry:", err);
    return res.status(500).json({ error: `Failed to add this acronym: ${err.message}` });
  }
});

app.patch("/api/kb/acronyms/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, kbAcronyms, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can edit Acronym Dictionary entries." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid Acronym Dictionary entry id." });
    const existing = await kbAcronyms.get(id);
    if (!existing) return res.status(404).json({ error: "Acronym Dictionary entry not found." });

    const { acronym, expansion, notes, isActive } = req.body;
    const entry = await kbAcronyms.update(id, {
      ...(typeof acronym === "string" && acronym.trim() ? { acronym: acronym.trim() } : {}),
      ...(typeof expansion === "string" && expansion.trim() ? { expansion: expansion.trim() } : {}),
      ...(notes !== undefined ? { notes: typeof notes === "string" && notes.trim() ? notes.trim() : null } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      updatedBy: `${req.user!.name} (${req.user!.email})`,
    });
    if (!entry) return res.status(404).json({ error: "Acronym Dictionary entry not found." });

    try {
      const actionType =
        typeof isActive === "boolean" && Object.keys(req.body).length === 1
          ? isActive
            ? "Acronym Dictionary Entry Activated"
            : "Acronym Dictionary Entry Deactivated"
          : "Acronym Dictionary Entry Edited";
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType,
        planName: null,
        description: `Updated "${entry.acronym}" -> "${entry.expansion}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Acronym Dictionary edit:", logErr);
    }

    return res.json({ entry });
  } catch (err: any) {
    console.error("Failed to update Acronym Dictionary entry:", err);
    return res.status(500).json({ error: `Failed to update this acronym: ${err.message}` });
  }
});

app.delete("/api/kb/acronyms/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, kbAcronyms, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can delete Acronym Dictionary entries." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid Acronym Dictionary entry id." });
    const existing = await kbAcronyms.get(id);
    if (!existing) return res.status(404).json({ error: "Acronym Dictionary entry not found." });
    await kbAcronyms.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Acronym Dictionary Entry Deleted",
        planName: null,
        description: `Deleted "${existing.acronym}" -> "${existing.expansion}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Acronym Dictionary deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete Acronym Dictionary entry:", err);
    return res.status(500).json({ error: `Failed to delete this acronym: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Product Assist — the advisor-facing chat over the Knowledge Base built
// above. Open to every tier (General included), unlike the Admin Zone KB
// management routes: an advisor picks an insurer (or "General") and
// optionally specific plan(s), asks a question, and gets a verified answer
// grounded only in the matching documents/announcements — see
// src/server/knowledgeBase/productAssist.ts for the retrieval + prompt logic.
// ─────────────────────────────────────────────────────────────────────────

/** True when every kb_resource actually tagged with this plan name is an
 * add-on/rider document — i.e. the roster entry is really an add-on's own
 * product name (e.g. "Limitless", "Unlimited Restore") that got typed into
 * the plan-tag box instead of the generic "Add-on" pseudo-entry, not a real
 * base plan or variant. An advisor should never be offered it as "the plan
 * you're asking about." Left alone (still treated as a real, selectable
 * plan) whenever it has zero matched resources or at least one non-addon
 * resource — this is derived purely from the same KB resource tagging
 * admins already curated, never a hardcoded name list. Mirrors
 * KnowledgeBaseResourceManagement.tsx's identical check for the admin UI's
 * Plans tab. */
function isAddOnOnlyPlanName(planName: string, resources: { planTags: string[]; documentType: string }[]): boolean {
  const key = planName.trim().toLowerCase();
  const matched = resources.filter(r => r.planTags.some(t => t.trim().toLowerCase() === key));
  return matched.length > 0 && matched.every(r => r.documentType === "addon");
}

// Read-only category list (id/name/type/planNames) for the query selector —
// deliberately NOT behind requireAdminOrDeveloper like /api/kb/categories,
// since every tier needs this to ask a question at all. No document
// content or chunk data is exposed here, only category metadata.
app.get("/api/product-assist/categories", requireAuth, async (req, res) => {
  try {
    const { kbCategories, kbResources } = createRepositories(getDb());
    const [entries, resources] = await Promise.all([kbCategories.list(), kbResources.list({ status: "active" })]);
    const resourcesByCategory = new Map<number, typeof resources>();
    for (const r of resources) {
      const list = resourcesByCategory.get(r.categoryId);
      if (list) list.push(r);
      else resourcesByCategory.set(r.categoryId, [r]);
    }
    // Selectable-plan view only — the admin-curated roster itself
    // (kb_categories.planNames) is left untouched so the KB admin's roster
    // editor can still see/fix every entry, including a mistagged one.
    const filteredEntries = entries.map(c => ({
      ...c,
      planNames: c.planNames
        .filter(name => !c.disabledPlanNames.some(d => d.toLowerCase() === name.toLowerCase()))
        .filter(name => !isAddOnOnlyPlanName(name, resourcesByCategory.get(c.id) ?? [])),
    }));
    return res.json({ entries: filteredEntries });
  } catch (err: any) {
    console.error("Product Assist: failed to list categories:", err);
    return res.status(500).json({ error: `Failed to load categories: ${err.message}` });
  }
});

/** One resource as exposed to the read-only Library nav — deliberately a
 * narrow projection (no status/errorMessage/addedBy/contentHash/etc.), same
 * spirit as ChatSource in productAssist.ts. `sourceUrl` is only ever rendered
 * as an openable link client-side when it's a real http(s) URL (a "pdf"
 * resource's sourceUrl is just its original filename, not a link — see
 * schema.ts's sourceUrl column comment); the client applies the same
 * isOpenable check already used for chat answer Sources, so no extra field
 * is needed here to signal that. */
function toLibraryResource(r: { id: number; title: string; documentType: string; sourceUrl: string | null; type: string }) {
  return { id: r.id, title: r.title, documentType: r.documentType, sourceUrl: r.sourceUrl, type: r.type };
}

// Product Assist Library — a read-only navigator over the SAME Knowledge
// Base data /api/product-assist/categories and /api/kb/* already manage, never
// a second store: Core Resources (Product Playbook, resolved to its existing
// kb_resources row; Health FAQ is intentionally NOT resolved from the DB
// here — see HEALTH_FAQ_LIBRARY_URL's comment, its Sheet must stay hidden)
// plus, per insurer, its selectable plans (identical filtering to
// /api/product-assist/categories: realPlanNames + disabled + add-on-only) each
// with their tagged resources, and its separate insurer-level resources
// (kb_resources.isInsurerLevel). Open to every tier, same reasoning as
// /api/product-assist/categories above.
app.get("/api/product-assist/library", requireAuth, async (req, res) => {
  try {
    const { kbCategories, kbResources } = createRepositories(getDb());
    const [categories, resources] = await Promise.all([kbCategories.list(), kbResources.list({ status: "active" })]);

    const resourcesByCategory = new Map<number, typeof resources>();
    for (const r of resources) {
      const list = resourcesByCategory.get(r.categoryId);
      if (list) list.push(r);
      else resourcesByCategory.set(r.categoryId, [r]);
    }

    const playbookResource = resources.find(r => r.type === "sheet" && r.title === PLAYBOOK_RESOURCE_TITLE);

    const insurers = categories
      .filter(c => c.type === "insurer")
      .map(c => {
        const catResources = resourcesByCategory.get(c.id) ?? [];
        const planNames = realPlanNames(c.planNames)
          .filter(name => !c.disabledPlanNames.some(d => d.toLowerCase() === name.toLowerCase()))
          .filter(name => !isAddOnOnlyPlanName(name, catResources));

        // Same association rule as KnowledgeBaseResourceManagement.tsx's
        // resourcesForPlanKey: tagged to this plan (case/whitespace-
        // insensitively) OR untagged (applies broadly to every plan under
        // this insurer) — Add-ons and insurer-level resources never count
        // toward a specific plan.
        const plans = planNames.map(name => {
          const key = name.trim().toLowerCase();
          const planResources = catResources.filter(
            r =>
              r.documentType !== "addon" &&
              !r.isInsurerLevel &&
              (r.planTags.length === 0 || r.planTags.some(t => t.trim().toLowerCase() === key))
          );
          return { name, resources: planResources.map(toLibraryResource) };
        });

        const insurerResources = catResources.filter(r => r.isInsurerLevel).map(toLibraryResource);

        return { id: c.id, name: c.name, plans, insurerResources };
      })
      // Nothing to browse under this insurer yet — omit rather than show an
      // empty branch. Purely a display filter; the category/plans/resources
      // themselves are untouched.
      .filter(insurer => insurer.plans.length > 0 || insurer.insurerResources.length > 0);

    return res.json({
      playbook: { sourceUrl: playbookResource?.sourceUrl ?? null },
      insurers,
    });
  } catch (err: any) {
    console.error("Product Assist: failed to load library:", err);
    return res.status(500).json({ error: `Failed to load library: ${err.message}` });
  }
});

// Daily AI-awareness warning gate (see ProductAssistDailyWarning.tsx) —
// server-persisted per user (product_assist_acks) so the state survives a
// cleared browser cache or a new device, not just localStorage. GET returns
// both facts in one call so the client can decide, before rendering
// anything, which of first-ever-warning / daily-reminder / neither to show.
app.get("/api/product-assist/warning-state", requireAuth, async (req, res) => {
  try {
    const { productAssistAcks } = createRepositories(getDb());
    const row = await productAssistAcks.get(req.user!.email);
    return res.json({
      ackedAt: row?.ackedAt ? row.ackedAt.toISOString() : null,
      lastReminderDate: row?.lastReminderDate ?? null,
    });
  } catch (err: any) {
    console.error("Failed to load Product Assist warning state:", err);
    return res.status(500).json({ error: `Failed to load warning state: ${err.message}` });
  }
});

// Records the one-time first-ever acknowledgement (10s countdown + checkbox
// + Proceed). `localDate` is the advisor's own LOCAL calendar date
// (YYYY-MM-DD — see toLocalDateKey in App.tsx), not the server's, and also
// covers today's daily reminder so it doesn't fire again later the same day.
app.post("/api/product-assist/warning-ack", requireAuth, async (req, res) => {
  try {
    const { localDate } = req.body;
    if (typeof localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return res.status(400).json({ error: "localDate must be a YYYY-MM-DD string." });
    }
    const { productAssistAcks } = createRepositories(getDb());
    await productAssistAcks.acknowledge(req.user!.email, localDate);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to record Product Assist acknowledgement:", err);
    return res.status(500).json({ error: `Failed to record acknowledgement: ${err.message}` });
  }
});

// Records that today's lightweight daily reminder was shown (see comment
// on warning-ack above re: why localDate is client-supplied).
app.post("/api/product-assist/warning-reminder-shown", requireAuth, async (req, res) => {
  try {
    const { localDate } = req.body;
    if (typeof localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return res.status(400).json({ error: "localDate must be a YYYY-MM-DD string." });
    }
    const { productAssistAcks } = createRepositories(getDb());
    await productAssistAcks.recordReminderShown(req.user!.email, localDate);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to record Product Assist reminder shown:", err);
    return res.status(500).json({ error: `Failed to record reminder shown: ${err.message}` });
  }
});

// Self-service reset for QA/demo purposes — deletes the caller's own row so
// their next Product Assist visit replays the first-ever 10s warning as a
// brand-new user would see it. Scoped to req.user!.email only (no target
// email in the request), so it can only ever reset the caller's own state.
app.post("/api/product-assist/warning-reset", requireAuth, async (req, res) => {
  try {
    const { productAssistAcks } = createRepositories(getDb());
    await productAssistAcks.reset(req.user!.email);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to reset Product Assist warning state:", err);
    return res.status(500).json({ error: `Failed to reset warning state: ${err.message}` });
  }
});

// Product Assist keeps NO server-side record of advisor conversations — per
// explicit product decision, chat history is local-memory only, held in the
// advisor's own browser (see ProductAssistPage.tsx's localStorage-backed
// session list) and never written to the database. This route is therefore
// fully stateless: each call re-sends the scope (categoryId/planTags) and
// whatever prior turns the client already has locally as `history`, and
// nothing here reads from or writes to kb_chat_sessions/kb_chat_messages.
app.post("/api/product-assist/ask", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    const { categoryId, planTags, question, history } = req.body;
    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "question is required." });
    }
    if (categoryId !== null && typeof categoryId !== "number") {
      return res.status(400).json({ error: "categoryId is required (or null for a General question)." });
    }
    if (planTags !== undefined && (!Array.isArray(planTags) || !planTags.every((t: unknown) => typeof t === "string"))) {
      return res.status(400).json({ error: "planTags must be an array of strings." });
    }
    if (
      history !== undefined &&
      (!Array.isArray(history) ||
        !history.every((m: unknown) => m && typeof m === "object" && ((m as any).role === "user" || (m as any).role === "assistant") && typeof (m as any).content === "string"))
    ) {
      return res.status(400).json({ error: "history must be an array of {role, content} messages." });
    }

    const repos = createRepositories(getDb());

    // Credit & Usage Management (2026-08) — checked BEFORE the AI call, per
    // productAssistQuota.ts's doc comment. Blocks only when a real cap is
    // already exhausted; never touches retrieval/prompt/answer logic below.
    const callerEmail = req.user!.email;
    const { allowed, status: quotaStatus } = await checkQuota(repos, callerEmail);
    if (!allowed) {
      return res.status(429).json({
        error:
          quotaStatus.dailyRemaining !== null && quotaStatus.dailyRemaining <= 0
            ? "Daily Product Assist credit limit reached. It resets at midnight (IST)."
            : "Monthly Product Assist credit limit reached. Contact a Developer/Platform Admin for extra credits.",
        quota: quotaStatus,
      });
    }

    // Fire-and-forget: refreshes the Product Playbook in the background if
    // the last sync is stale (see maybeRefreshPlaybookIfStale) — never
    // awaited, so a slow or failed refresh can never delay this answer.
    void maybeRefreshPlaybookIfStale(repos);
    // Same lazy staleness check for the Ditto FAQ (see maybeRefreshFaqIfStale) —
    // also fire-and-forget, independent of the Playbook's own refresh.
    void maybeRefreshFaqIfStale(repos);
    const scope = { categoryId: categoryId ?? null, planTags: Array.isArray(planTags) ? planTags : [] };
    const result = await answerQuery(repos, scope, question.trim(), Array.isArray(history) ? history : []);

    // Record actual consumption SYNCHRONOUSLY (awaited, unlike the
    // temporary product_assist_logs write below) — this is the quota
    // system's real source of truth. Null tokens means no AI call actually
    // happened (e.g. a deterministic Special-Instruction-conflict answer),
    // so there's nothing to charge for.
    let quotaAfter = quotaStatus;
    if (result.meta.inputTokens !== null && result.meta.outputTokens !== null) {
      await recordUsage(repos, callerEmail, result.meta.inputTokens, result.meta.outputTokens);
      quotaAfter = await getQuotaStatus(repos, callerEmail);
    }

    // TEMPORARY (see product_assist_logs's schema comment): fire-and-forget,
    // never awaited — a logging failure must never affect the advisor's
    // actual answer, which has already been computed above regardless of
    // what happens here. Gated by PRODUCT_ASSIST_LOG_ENABLED so this can be
    // turned off (set to "false") once enough real data has been collected
    // for the Product Assist optimization review's test set; unset/anything
    // else defaults to enabled.
    if (process.env.PRODUCT_ASSIST_LOG_ENABLED !== "false") {
      void (async () => {
        try {
          const categoryName =
            scope.categoryId !== null
              ? (await repos.kbCategories.list()).find(c => c.id === scope.categoryId)?.name ?? null
              : null;
          await repos.productAssistLogs.create({
            userEmail: req.user!.email,
            categoryId: scope.categoryId,
            categoryName,
            planTags: scope.planTags,
            question: question.trim(),
            answer: result.answer,
            share: result.share,
            sources: result.sources,
            hadNoMatches: result.hadNoMatches,
            retrievedChunkCount: result.meta.retrievedChunkCount,
            playbookFactCount: result.meta.playbookFactCount,
            historyTurnCount: result.meta.historyTurnCount,
            inputTokens: result.meta.inputTokens,
            outputTokens: result.meta.outputTokens,
            latencyMs: result.meta.latencyMs,
          });
        } catch (logErr) {
          console.error("Product Assist: failed to write temporary analysis log row (non-fatal):", logErr);
        }
      })();
    }

    return res.json({
      answer: result.answer,
      share: result.share,
      sources: result.sources,
      hadNoMatches: result.hadNoMatches,
      quota: quotaAfter,
    });
  } catch (err: any) {
    console.error("Product Assist: failed to answer question:", err);
    return res.status(500).json({ error: `Failed to get an answer: ${err.message}` });
  }
});

// GET /api/product-assist/quota — the caller's own current credit status,
// used by ProductAssistPage.tsx to render the utilization bar on load
// (before the first question is asked) and to refresh it independent of
// asking a question (e.g. after an admin grants extra credits).
app.get("/api/product-assist/quota", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    const status = await getQuotaStatus(repos, req.user!.email);
    return res.json({ quota: status });
  } catch (err: any) {
    console.error("Product Assist: failed to load quota status:", err);
    return res.status(500).json({ error: `Failed to load quota status: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Product Assist Credit & Usage Management — admin routes. Every route
// below is restricted to Developer + Platform Admin ONLY (isDeveloperPower)
// server-side, deliberately narrower than the typical Admin-Zone gate
// (isAdminPower) per the user's explicit access-control decision — a plain
// Admin cannot view or change anyone's quota. The "AI Usage & Limits" page
// additionally gates itself client-side via DEVELOPER_ONLY_FEATURES.
// ─────────────────────────────────────────────────────────────────────────

async function requireQuotaAdmin(req: any, res: any, usersRepo: UsersRepository): Promise<string | null> {
  const callerTier = await getCallerTier(req, usersRepo);
  if (!isDeveloperPower(callerTier)) {
    res.status(403).json({ error: "Product Assist usage & limits are restricted to the Developer or Platform Admin." });
    return null;
  }
  return callerTier;
}

// GET /api/product-assist/quota/settings — the global defaults/conversion/
// budget/pricing row (Settings tab).
app.get("/api/product-assist/quota/settings", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistQuotaSettings } = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, usersRepo))) return;
    const settings = await productAssistQuotaSettings.get();
    return res.json({ settings });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load settings:", err);
    return res.status(500).json({ error: `Failed to load settings: ${err.message}` });
  }
});

// PUT /api/product-assist/quota/settings — update the global defaults.
// Every field is optional (partial update); numeric fields are validated
// as positive numbers/integers so a typo can't silently zero out quotas.
app.put("/api/product-assist/quota/settings", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistQuotaSettings, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const b = req.body ?? {};
    const intFields = [
      "defaultDailyCredits",
      "defaultMonthlyCredits",
      "trialMonthlyCredits",
      "tokensPerCredit",
      "warningThresholdPercent",
      "budgetWarningThresholdPercent",
    ] as const;
    const numFields = ["monthlyBudget", "inputPricePerMillionTokens", "outputPricePerMillionTokens"] as const;
    const patch: Record<string, unknown> = {};
    for (const f of intFields) {
      if (b[f] === undefined) continue;
      const n = Number(b[f]);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return res.status(400).json({ error: `${f} must be a non-negative whole number.` });
      }
      patch[f] = n;
    }
    for (const f of numFields) {
      if (b[f] === undefined) continue;
      const n = Number(b[f]);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `${f} must be a non-negative number.` });
      }
      patch[f] = n.toString();
    }
    if (b.currency !== undefined) {
      if (typeof b.currency !== "string" || !b.currency.trim()) {
        return res.status(400).json({ error: "currency must be a non-empty string." });
      }
      patch.currency = b.currency.trim();
    }
    if (b.modelName !== undefined) {
      if (typeof b.modelName !== "string" || !b.modelName.trim()) {
        return res.status(400).json({ error: "modelName must be a non-empty string." });
      }
      patch.modelName = b.modelName.trim();
    }

    // Eligibility catalog IDs (migration 0049) — Department/Team/Role a
    // user must simultaneously hold (alongside the Health tag) to land in
    // the health_advisor bucket. Each is nullable (null = un-configure
    // that piece, which makes the rule un-satisfiable overall — see
    // resolveQuotaBucket()) but if provided as a number must reference a
    // real, existing catalog row so a typo can't silently no-op.
    const eligibilityIdFields = [
      { field: "eligibleDepartmentId", repo: departments, label: "eligibleDepartmentId", noun: "department" },
      { field: "eligibleOrgTeamId", repo: orgTeams, label: "eligibleOrgTeamId", noun: "team" },
      { field: "eligibleRoleId", repo: roles, label: "eligibleRoleId", noun: "role" },
    ] as const;
    for (const { field, repo, noun } of eligibilityIdFields) {
      if (b[field] === undefined) continue;
      if (b[field] === null) {
        patch[field] = null;
        continue;
      }
      const id = Number(b[field]);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: `${field} must be a whole number ID or null.` });
      }
      const row = await repo.get(id);
      if (!row) {
        return res.status(400).json({ error: `${field} does not reference an existing ${noun}.` });
      }
      patch[field] = id;
    }

    if ((patch.warningThresholdPercent as number | undefined) !== undefined && (patch.warningThresholdPercent as number) > 100) {
      return res.status(400).json({ error: "warningThresholdPercent must be between 0 and 100." });
    }
    if (
      (patch.budgetWarningThresholdPercent as number | undefined) !== undefined &&
      (patch.budgetWarningThresholdPercent as number) > 100
    ) {
      return res.status(400).json({ error: "budgetWarningThresholdPercent must be between 0 and 100." });
    }

    const before = await productAssistQuotaSettings.get();
    const updated = await productAssistQuotaSettings.update(patch as any, req.user!.email);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Product Assist Quota Settings Changed",
        planName: null,
        description: `Updated Product Assist quota settings (${Object.keys(patch).join(", ") || "no fields"}).`,
        snapshot: { before, after: updated },
      });
    } catch (logErr) {
      console.error("Failed to write change log for quota settings update:", logErr);
    }

    return res.json({ settings: updated });
  } catch (err: any) {
    console.error("Product Assist quota: failed to update settings:", err);
    return res.status(500).json({ error: `Failed to update settings: ${err.message}` });
  }
});

// GET /api/product-assist/quota/overview — company-wide totals for the
// Overview tab (this-IST-month credits/tokens used, request count, and a
// budget estimate from the configured pricing — visibility only, never an
// auto-stop, per product decision).
app.get("/api/product-assist/quota/overview", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistQuotaSettings, productAssistUsageLedger } = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, usersRepo))) return;

    const settings = await productAssistQuotaSettings.get();
    const now = new Date();
    const monthStart = startOfMonthIST(now);
    const dayStart = startOfDayIST(now);
    const [monthTotals, todayTotals] = await Promise.all([
      productAssistUsageLedger.companyTotals(monthStart),
      productAssistUsageLedger.companyTotals(dayStart),
    ]);
    const estimatedCostThisMonth = estimateCost(monthTotals.totalInputTokens, monthTotals.totalOutputTokens, {
      inputPricePerMillionTokens: Number(settings.inputPricePerMillionTokens),
      outputPricePerMillionTokens: Number(settings.outputPricePerMillionTokens),
    });
    const monthlyBudget = Number(settings.monthlyBudget);
    const budgetUtilizationPercent = monthlyBudget > 0 ? Math.round((estimatedCostThisMonth / monthlyBudget) * 100) : null;

    return res.json({
      settings,
      today: todayTotals,
      month: monthTotals,
      budget: {
        currency: settings.currency,
        monthlyBudget,
        estimatedCostThisMonth: Math.round(estimatedCostThisMonth * 100) / 100,
        budgetUtilizationPercent,
        warningThresholdPercent: settings.budgetWarningThresholdPercent,
      },
    });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load overview:", err);
    return res.status(500).json({ error: `Failed to load overview: ${err.message}` });
  }
});

// GET /api/product-assist/quota/users — every user's computed quota status
// (Users tab).
app.get("/api/product-assist/quota/users", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, repos.users))) return;
    const summaries = await listAllUserQuotaStatuses(repos);
    return res.json({ users: summaries });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load user summaries:", err);
    return res.status(500).json({ error: `Failed to load user summaries: ${err.message}` });
  }
});

// GET /api/product-assist/quota/users/:email — one user's full status plus
// their override row and extra-credit grant history (User detail panel).
app.get("/api/product-assist/quota/users/:email", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, repos.users))) return;
    const email = String(req.params.email).toLowerCase();
    const [status, override, grants] = await Promise.all([
      getQuotaStatus(repos, email),
      repos.productAssistUserQuotaOverrides.get(email),
      repos.productAssistExtraCreditGrants.listForUser(email),
    ]);
    return res.json({ status, override: override ?? null, grants });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load user detail:", err);
    return res.status(500).json({ error: `Failed to load user detail: ${err.message}` });
  }
});

// PUT /api/product-assist/quota/users/:email/override — set a custom
// daily/monthly limit, disable enforcement, or grant unlimited access for
// one user. Every field required so the admin UI always sends a complete,
// unambiguous state (no partial-update surprises on a per-user override).
app.put("/api/product-assist/quota/users/:email/override", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistUserQuotaOverrides, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const email = String(req.params.email).toLowerCase();
    const targetUser = await usersRepo.findByEmail(email);
    if (!targetUser) return res.status(404).json({ error: "No user found with that email." });

    const { customDailyCredits, customMonthlyCredits, limitsEnabled, unlimitedAccess } = req.body ?? {};
    if (customDailyCredits !== null && customDailyCredits !== undefined && !Number.isInteger(customDailyCredits)) {
      return res.status(400).json({ error: "customDailyCredits must be a whole number or null." });
    }
    if (customMonthlyCredits !== null && customMonthlyCredits !== undefined && !Number.isInteger(customMonthlyCredits)) {
      return res.status(400).json({ error: "customMonthlyCredits must be a whole number or null." });
    }
    if (typeof limitsEnabled !== "boolean" || typeof unlimitedAccess !== "boolean") {
      return res.status(400).json({ error: "limitsEnabled and unlimitedAccess must be booleans." });
    }

    const before = await productAssistUserQuotaOverrides.get(email);
    const updated = await productAssistUserQuotaOverrides.upsert(email, {
      customDailyCredits: customDailyCredits ?? null,
      customMonthlyCredits: customMonthlyCredits ?? null,
      limitsEnabled,
      unlimitedAccess,
      updatedBy: req.user!.email,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Product Assist Quota Override Changed",
        planName: null,
        description: `Set a custom Product Assist quota override for ${email}.`,
        snapshot: { before: before ?? null, after: updated },
      });
    } catch (logErr) {
      console.error("Failed to write change log for quota override:", logErr);
    }

    return res.json({ override: updated });
  } catch (err: any) {
    console.error("Product Assist quota: failed to set override:", err);
    return res.status(500).json({ error: `Failed to set override: ${err.message}` });
  }
});

// DELETE /api/product-assist/quota/users/:email/override — revert a user
// back to their computed eligibility-bucket default.
app.delete("/api/product-assist/quota/users/:email/override", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistUserQuotaOverrides, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const email = String(req.params.email).toLowerCase();
    const before = await productAssistUserQuotaOverrides.get(email);
    await productAssistUserQuotaOverrides.remove(email);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Product Assist Quota Override Removed",
        planName: null,
        description: `Reverted ${email} to their default Product Assist quota bucket.`,
        snapshot: { before: before ?? null, after: null },
      });
    } catch (logErr) {
      console.error("Failed to write change log for quota override removal:", logErr);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Product Assist quota: failed to remove override:", err);
    return res.status(500).json({ error: `Failed to remove override: ${err.message}` });
  }
});

// POST /api/product-assist/quota/users/:email/extra-credits — grant
// (positive amount) or remove/reduce (negative amount) extra credits.
// Never mutates a past grant — always inserts a new ledger row, per
// schema.ts's doc comment. Extra credits never expire UNLESS the admin
// supplies an optional expiresAt (migration 0049) — omitting it preserves
// the original never-expires default.
app.post("/api/product-assist/quota/users/:email/extra-credits", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistExtraCreditGrants, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const email = String(req.params.email).toLowerCase();
    const targetUser = await usersRepo.findByEmail(email);
    if (!targetUser) return res.status(404).json({ error: "No user found with that email." });

    const { amount, reason, expiresAt } = req.body ?? {};
    if (!Number.isInteger(amount) || amount === 0) {
      return res.status(400).json({ error: "amount must be a non-zero whole number (negative to remove/reduce credits)." });
    }
    if (reason !== undefined && reason !== null && typeof reason !== "string") {
      return res.status(400).json({ error: "reason must be a string." });
    }
    // Optional (migration 0049). Undefined/null = never expires — the
    // original, still-default behavior. When provided, must be a valid,
    // future ISO date string; a past date would create a grant that's
    // already expired on arrival, which is never a legitimate admin intent.
    let parsedExpiresAt: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "expiresAt must be a valid date." });
      }
      if (d.getTime() <= Date.now()) {
        return res.status(400).json({ error: "expiresAt must be in the future." });
      }
      parsedExpiresAt = d;
    }

    const grant = await productAssistExtraCreditGrants.create({
      userEmail: email,
      amount,
      reason: reason ?? null,
      grantedBy: req.user!.email,
      expiresAt: parsedExpiresAt,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: amount > 0 ? "Product Assist Extra Credits Granted" : "Product Assist Extra Credits Removed",
        planName: null,
        description: `${amount > 0 ? "Granted" : "Removed"} ${Math.abs(amount)} extra Product Assist credit(s) ${
          amount > 0 ? "to" : "from"
        } ${email}${reason ? ` — ${reason}` : ""}.`,
        snapshot: { grant },
      });
    } catch (logErr) {
      console.error("Failed to write change log for extra credit grant:", logErr);
    }

    return res.json({ grant });
  } catch (err: any) {
    console.error("Product Assist quota: failed to record extra credit grant:", err);
    return res.status(500).json({ error: `Failed to record extra credit grant: ${err.message}` });
  }
});

// GET /api/product-assist/quota/usage — raw usage-ledger rows for the
// Usage History tab (Today / 7-day / month / custom range — the client
// computes the from/to boundaries and sends them as ISO strings; omitting
// both returns the most recent rows across all users).
app.get("/api/product-assist/quota/usage", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, repos.users))) return;

    const { userEmail, from, to, limit, offset } = req.query;
    const filter: Parameters<typeof repos.productAssistUsageLedger.list>[0] = {};
    if (typeof userEmail === "string" && userEmail.trim()) filter.userEmail = userEmail.trim();
    if (typeof from === "string" && from.trim()) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) filter.from = d;
    }
    if (typeof to === "string" && to.trim()) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) filter.to = d;
    }
    const parsedLimit = typeof limit === "string" ? parseInt(limit, 10) : NaN;
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) filter.limit = Math.min(parsedLimit, 1000);
    const parsedOffset = typeof offset === "string" ? parseInt(offset, 10) : NaN;
    if (Number.isFinite(parsedOffset) && parsedOffset >= 0) filter.offset = parsedOffset;

    const rows = await repos.productAssistUsageLedger.list(filter);
    return res.json({ rows });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load usage history:", err);
    return res.status(500).json({ error: `Failed to load usage history: ${err.message}` });
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
          "[PED Repository] WARNING: DB-backed cache loaded with 0 aliases — classifyDeterministic will resolve nothing deterministically and every lookup will fall through to AI Memory/Gemini. Check DATABASE_URL and confirm the PED Repository has been populated (via the PED Repository admin page, which now writes ped_repository/ped_aliases directly) against this database."
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
