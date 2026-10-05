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
import { getPlanConfig, MatchOutput, CATEGORY_LABELS, CATEGORY_AUTO_MAP_RULES, type PlanConfig } from "./src/types.js";
import { classifyDeterministic, sanitizeOutput, applyPostGuards, finalizeOutput, resolvePlanDecision, normalizeDictionaryKey, applyHighConfidenceCategoryOverride, type DbDictionarySource } from "./src/engine.js";
import { MASTER_ILLNESSES } from "./src/specificIllnessEngine.js";
import { ensurePedOverridesLoaded, promotePedMappingOverride, unmapPedMappingOverride, inferCategoryKeyForQuestion } from "./src/server/pedMappingLive.js";
import { getMappingSnapshot } from "./src/server/mappingSnapshot.js";
import { applyAiApproval, revertAiApproval, undoChangeSet, type PromotionDeps } from "./src/server/aiMappingPromotion.js";
import { legacyOnlyWriteBlocked, RETIRED_ACTION_MESSAGE } from "./src/server/legacyWriteGuard.js";
import { runDeterministicPipeline } from "./src/mapping/routingEngine.js";
import { ensurePedRuntimeCacheLoaded, getDbAliasLookup, planOverrideLookup as dbPlanOverrideLookup, updateDbPlanOverrideCache, removeDbPlanOverrideCache } from "./src/server/pedRuntimeCache.js";
import {
  createPedWithPrimaryAlias,
  updatePedRow,
  deletePedRow,
  addAliasToPed,
  updateAliasRow,
  deleteAliasRow,
} from "./src/server/pedRepositoryLive.js";
import type { Repositories } from "./src/server/db/repositories/index.js";
import { dbRowToPlanConfig, toPlanRestrictions, toPlanPedOverrides } from "./src/server/planConfigUtils.js";
import {
  getGoogleAuthUrl,
  exchangeCodeForIdentity,
  getQaDashboardSheetsAuthUrl,
  exchangeCodeForQaDashboardSheetsGrant,
  getKbPlaybookSheetsAuthUrl,
  exchangeCodeForKbPlaybookSheetsGrant,
  getKbFaqSheetsAuthUrl,
  exchangeCodeForKbFaqSheetsGrant,
  getTermFaqSheetsAuthUrl,
  exchangeCodeForTermFaqSheetsGrant,
  getTermPlaybookSheetsAuthUrl,
  exchangeCodeForTermPlaybookSheetsGrant,
  getProductAssistLogExportSheetsAuthUrl,
  exchangeCodeForProductAssistLogExportGrant,
} from "./src/server/auth/googleOAuth.js";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./src/server/auth/session.js";
import { attachUser, requireAuth } from "./src/server/auth/middleware.js";
import { getDb } from "./src/server/db/client.js";
import { createRepositories, normalizeCondition } from "./src/server/db/repositories/index.js";
import { createMappingGate, undoAdminChange } from "./src/server/mappingChange.js";
import { validateCategoryChain } from "./src/server/categoryChain.js";
import { bandFor, STAGE_BANDS, isCustom } from "./src/server/mappingAdmin.js";
import { createCategory, createRule, deleteCategory, deleteRule, listCategories, moveRule, patchCategory, patchRule, ruleToJson, traceLookup, validateRuleCandidate } from "./src/server/mappingAdminOps.js";
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
import { invalidateQaSheetCache } from "./src/server/qaDashboard/qaDataEngine.js";
import {
  getTeamTrackerContext,
  getTeamTrackerTable,
  getTeamTrackerPeriodSummary,
  getCurrentMonthPeriodChange,
} from "./src/server/qaDashboard/teamTrackerService.js";
import {
  saveCoachingSession,
  getCoachingHistory,
  updateActionableStatus,
  updateCoachingSession,
  listDiscussedFeedback,
  setFeedbackDiscussed,
} from "./src/server/coaching/coachingService.js";
import { encryptQaRefreshToken } from "./src/server/qaDashboard/tokenCrypto.js";
import { invalidateQaSheetsAuthCache, getQaSheetsHealth, QA_MASTER_SPREADSHEET_ID } from "./src/server/qaDashboard/sheetsClient.js";
import { getLastExecutionTime } from "./src/server/qaDashboard/appsScriptClient.js";
import { syncAdvisorDirectory } from "./src/server/qaDashboard/advisorDirectorySync.js";
import { syncGuideMentorRelationships } from "./src/server/qaDashboard/guideMentorRelationshipsSync.js";
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
import { encryptTermFaqRefreshToken } from "./src/server/knowledgeBase/termFaqTokenCrypto.js";
import { invalidateTermFaqSheetsAuthCache, TERM_FAQ_SPREADSHEET_ID } from "./src/server/knowledgeBase/termFaqSheetsClient.js";
import { encryptTermPlaybookRefreshToken } from "./src/server/knowledgeBase/termPlaybookTokenCrypto.js";
import { invalidateTermPlaybookSheetsAuthCache, TERM_PLAYBOOK_SPREADSHEET_ID } from "./src/server/knowledgeBase/termPlaybookSheetsClient.js";
import { syncPlaybook, maybeRefreshPlaybookIfStale } from "./src/server/knowledgeBase/playbookIngest.js";
import { syncFaq, maybeRefreshFaqIfStale, FAQ_DITTO_RESOURCE_TITLE } from "./src/server/knowledgeBase/faqIngest.js";
import { syncTermFaq, maybeRefreshTermFaqIfStale, TERM_FAQ_RESOURCE_TITLE } from "./src/server/knowledgeBase/termFaqIngest.js";
import { syncTermPlaybook, maybeRefreshTermPlaybookIfStale, TERM_PLAYBOOK_RESOURCE_TITLE } from "./src/server/knowledgeBase/termPlaybookIngest.js";
import { getDidYouKnowFeed } from "./src/server/knowledgeBase/didYouKnow.js";
import { encryptProductAssistLogRefreshToken } from "./src/server/knowledgeBase/productAssistLogTokenCrypto.js";
import { invalidateProductAssistLogSheetsAuthCache, getProductAssistLogExportHealth } from "./src/server/knowledgeBase/productAssistLogSheetsClient.js";
import { exportUnresolvedQueryRows } from "./src/server/knowledgeBase/productAssistUnresolvedQueriesSheetsClient.js";
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
  istMonthKey,
  istMonthRange,
} from "./src/server/knowledgeBase/productAssistQuota.js";
import { DEFAULT_FEATURE_PERMISSIONS, DEVELOPER_ONLY_FEATURES, GROUP_CONFIGURABLE_FEATURES, isFeatureGroupGrantableForTier } from "./src/constants/featurePermissions.js";
import { ruleMatchesCaller, levelAllows, type ActionType as AccessActionType } from "./src/accessRuleEvaluator.js";
import { evaluateAccess, getGroupFeatureLevels } from "./src/server/accessControl/evaluateAccess.js";
import { countCatalogDependencies, blocksDeletion, needsConfirmation, describeDependencies } from "./src/server/accessControl/catalogDependencies.js";
import { describeUserAccessChanges } from "./src/server/accessControl/describeUserAccessChanges.js";

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

// ─────────────────────────────────────────────────────────────────────────
// Mapping-control (Phase 2) — data-driven routing engine switch. "legacy"
// (the default) is today's behaviour: the hard-coded engine in src/engine.ts.
// "db" routes every deterministic lookup through src/mapping/routingEngine.ts,
// which reads the routing_rules / alias / category tables via a per-instance
// snapshot that reloads whenever mapping_state.version changes (so an admin
// edit is live on every instance on its next lookup). The Phase 2 equality
// tests prove "db" reproduces the production day-one behaviour exactly.
// Flipping this env var back to "legacy" (no redeploy needed) is the rollback.
// ─────────────────────────────────────────────────────────────────────────
const MAPPING_ENGINE: "legacy" | "db" = process.env.MAPPING_ENGINE === "db" ? "db" : "legacy";
// Identifies this server process in lookup traces, so live propagation across Cloud Run instances can be observed.
const MAPPING_INSTANCE_ID = crypto.randomUUID().slice(0, 8);

/** Bumps the mapping version after a write that can change a routing result,
 * so every server instance reloads its snapshot on its next lookup. Never
 * fails the caller's request: if the mapping tables are not migrated yet
 * (legacy mode before 0085 is applied) this just logs. */
async function bumpMappingVersion(): Promise<void> {
  try {
    await createRepositories(getDb()).mappingState.bump();
  } catch (err) {
    console.error("Failed to bump mapping version (instances running MAPPING_ENGINE=db will not see this change until it is bumped):", err);
  }
}

// Mapping-control Phase 3B-i — impact preview, change-control fields, confirmation, change sets and
// undo for every admin route that can change a routing result (src/server/mappingChange.ts).
// MAPPING_IMPACT_GATE=on enables it (and only with MAPPING_ENGINE=db); off = Phase 3A behaviour exactly.
// With the gate off, a preview request is refused rather than executed.
const MAPPING_IMPACT_GATE_ON = () => MAPPING_ENGINE === "db" && process.env.MAPPING_IMPACT_GATE === "on";
const mappingGateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many mapping changes or previews. Please wait a few minutes and try again." },
});
const mappingGateRateLimit = (req: any, res: any, next: any) => (MAPPING_IMPACT_GATE_ON() ? mappingGateLimiter(req, res, next) : next());
const mappingGate = createMappingGate({
  enabled: MAPPING_IMPACT_GATE_ON,
  rootDb: () => getDb(),
  engineVersion: ENGINE_VERSION,
  performer: async (req) => `${(req as any).user?.name ?? "Unknown"} (${await getCallerTier(req, createRepositories(getDb()).users)})`,
});

// Phase 3B-ii: shared helpers for the routing-rule / category admin routes (defined here, ahead of every route).
const DB_ONLY = "Routing rules can only be managed while the database-backed engine is active.";
const sendOp = (res: any, op: { status: number; body: Record<string, unknown> }) => res.status(op.status).json(op.body);

/** Shared shape of every gated admin write: access check, db-engine check, the op, then the version bump on success. */
const adminWrite = (feature: string, action: string, run: (repos: ReturnType<typeof createRepositories>, req: any) => Promise<{ status: number; body: Record<string, unknown> }>, dbOnly = true) =>
  async (req: any, res: any) => {
    try {
      if (!(await requireFeatureAccess(req, res, feature, "Editor", action))) return;
      if (dbOnly && MAPPING_ENGINE !== "db") return res.status(409).json({ error: DB_ONLY });
      const op = await run(createRepositories(getDb()), req);
      if (op.status < 400) await bumpMappingVersion();
      return sendOp(res, op);
    } catch (err: any) {
      console.error(`${action} failed:`, err);
      return res.status(500).json({ error: `${action} failed: ${err.cause?.message || err.message}` });
    }
  };


/**
 * Builds the optional 4th argument for classifyDeterministic. Returns null
 * on the default "legacy" flag setting (classifyDeterministic behaves
 * exactly as it always has) or if the DB-backed cache hasn't loaded for any
 * reason — a failed/slow DB cache load must never break matching, so this
 * degrades to the legacy path rather than throwing.
 */
async function getDbSource(repos: Pick<Repositories, "pedAliases" | "pedRepository" | "categories" | "planOverrides">): Promise<DbDictionarySource | null> {
  // With MAPPING_ENGINE=db the engine reads the database snapshot only; the legacy dictionary cache is never consulted.
  if (MAPPING_ENGINE === "db" || PED_SOURCE !== "db") return null;
  try {
    await ensurePedRuntimeCacheLoaded(repos);
    return { aliasLookup: getDbAliasLookup(), planOverrideLookup: dbPlanOverrideLookup };
  } catch (err) {
    console.error("Failed to build DB-backed classifyDeterministic source (falling back to legacy dictionary):", err);
    return null;
  }
}

/**
 * Admin plan-specific PED mappings (plan_overrides) — read fresh from the DB
 * on every lookup and attached to `config.pedOverrides` (evaluated first by
 * engine.ts's applyPlanPedOverride), so an edit in Plan Management reaches
 * every user and every server instance on their very next lookup, with no
 * restart and no stale in-process cache. Also returns a `dbSource` whose
 * planOverrideLookup answers from these same fresh rows instead of the
 * boot-time pedRuntimeCache map (which another instance's edit/delete would
 * otherwise leave stale).
 */
async function attachPlanPedOverrides(
  config: PlanConfig,
  planName: string,
  repos: Pick<Repositories, "planOverrides">,
  dbSource: DbDictionarySource | null
): Promise<DbDictionarySource | null> {
  try {
    const rows = await repos.planOverrides.listDetailed(planName);
    config.pedOverrides = toPlanPedOverrides(rows);
    if (!dbSource) return dbSource;
    const byPedId = new Map(rows.map((r) => [r.pedId, { categoryKey: r.categoryKey ?? null, reason: r.reason ?? null }] as const));
    return { ...dbSource, planOverrideLookup: (p: string, pedId: number) => (p === planName ? byPedId.get(pedId) ?? null : null) };
  } catch (err) {
    console.error("Failed to load plan-specific PED mappings (continuing with none):", err);
    return dbSource;
  }
}

// 1. API Route: Match PED to Policy questionnaire
// Tells the browser which engine decides lookups. In "db" mode the browser must
// NOT classify locally (its compiled-in copy of the legacy rules is the reason
// admin edits used to not take effect) and sends every lookup to /api/match.
app.get("/api/mapping-engine", requireAuth, async (req, res) => {
  // canViewTrace: staff tiers (not General) may open "Why this result" on a lookup result.
  let canViewTrace = false;
  try {
    canViewTrace = (await getCallerTier(req, createRepositories(getDb()).users)) !== "General";
  } catch {
    canViewTrace = false;
  }
  res.json({ mode: MAPPING_ENGINE, instance: MAPPING_INSTANCE_ID, impactGate: MAPPING_IMPACT_GATE_ON(), canViewTrace });
});

/**
 * The plan config a lookup runs against, built exactly the way /api/match builds
 * it (DB plan row or bootstrap seed, active restrictions, fresh plan-specific
 * overrides). Used to verify an admin mapping change against the LIVE engine.
 */
async function loadLookupConfig(repos: ReturnType<typeof createRepositories>, planName: string): Promise<PlanConfig | undefined> {
  let config: PlanConfig | undefined = getPlanConfig()[planName];
  try {
    const dbPlan = await repos.planConfigs.get(planName);
    if (dbPlan) config = dbRowToPlanConfig(dbPlan);
  } catch (err) {
    console.error("Failed to load DB plan config for live verification:", err);
  }
  if (!config) return undefined;
  try {
    config.restrictions = toPlanRestrictions(await repos.planRestrictions.listActiveForPlan(planName));
  } catch (err) {
    console.error("Failed to load plan restrictions for live verification:", err);
  }
  await attachPlanPedOverrides(config, planName, repos, null);
  return config;
}

/** Dependencies for admin mapping actions: the authoritative repositories plus a FRESH lookup through the live engine. */
function buildMappingActionDeps(repos: ReturnType<typeof createRepositories>): PromotionDeps {
  return {
    repos,
    verify: async (term, planName) => {
      const config = await loadLookupConfig(repos, planName);
      if (!config) throw new Error(`Plan '${planName}' not found for live verification.`);
      const snapshot = await getMappingSnapshot(repos);
      const { result, trace } = runDeterministicPipeline(term, planName, config, snapshot);
      return {
        question: result?.matched_question ?? null,
        matchType: result?.match_type ?? null,
        decidedBy: trace.decidedBy,
        effectiveCategory: trace.dictionary?.effectiveCategory ?? null,
        dictionarySource: trace.dictionary?.source ?? null,
        snapshotVersion: snapshot.version,
      };
    },
  };
}

// In db mode the deterministic engine answers most lookups with no AI cost, so
// the tight AI/cost limiter is applied only when a lookup actually has to go to
// AI Memory / the model (see below); legacy mode keeps the limiter on every call.
const matchLimiter: express.RequestHandler = (req, res, next) => (MAPPING_ENGINE === "db" ? next() : expensiveActionLimiter(req, res, next));
function runLimiter(limiter: express.RequestHandler, req: express.Request, res: express.Response): Promise<boolean> {
  return new Promise((resolve) => {
    res.once("finish", () => resolve(false));
    limiter(req, res, () => resolve(true));
  });
}

app.post("/api/match", requireAuth, matchLimiter, async (req, res) => {
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
    // The legacy per-PED override table is only read by the legacy engine; with MAPPING_ENGINE=db the engine reads the
    // database snapshot alone, so a lookup never touches it.
    if (MAPPING_ENGINE !== "db") await ensurePedOverridesLoaded(pedOverridesRepo);
    let dbSource = await getDbSource(repos);

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
      dbSource = await attachPlanPedOverrides(config, planName, repos, dbSource);
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
    if (MAPPING_ENGINE === "db") {
      const snapshot = await getMappingSnapshot(repos);
      const { result, trace } = runDeterministicPipeline(ped, planName, config, snapshot);
      if (result) {
        return res.json({ ...result, decision_trace: { ...trace, instance: MAPPING_INSTANCE_ID, snapshotVersion: snapshot.version }, source: "Deterministic Engine" });
      }
      // No deterministic rule matched: this lookup may now use AI Memory / the model.
      if (!(await runLimiter(expensiveActionLimiter, req, res))) return;
    }

    let output = MAPPING_ENGINE === "db" ? null : classifyDeterministic(ped, planName, config, dbSource);

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

    // Cross-feature usage tracking (2026-09, visibility only — see
    // ai_usage_log's schema.ts comment). Only ever reached on an actual L3
    // Gemini call (L1 deterministic and L2 AI Memory cache hits both return
    // earlier in this function), so this never over-counts a cache hit as a
    // fresh AI call. Fire-and-forget — a failure here must never affect the
    // advisor's lookup, which has already succeeded above.
    void repos.aiUsageLog
      .record({
        source: "declaration_assist_match",
        userEmail: req.user!.email,
        model: usedModel || modelsToTry[0],
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        label: String(ped).slice(0, 200),
      })
      .catch(err => console.error("AI usage log: failed to record Declaration Assist match entry (non-fatal):", err));

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
    if (legacyOnlyWriteBlocked(MAPPING_ENGINE)) return res.status(410).json({ error: RETIRED_ACTION_MESSAGE, retired: true }); // LEGACY_ONLY_WRITE_GUARD
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

          // Cross-feature usage tracking (2026-09, visibility only — see
          // ai_usage_log's schema.ts comment). Fire-and-forget — a failure
          // here must never affect the workflow response, already built
          // above.
          void createRepositories(getDb())
            .aiUsageLog.record({
              source: "plan_management_ai_workflow",
              userEmail: req.user!.email,
              model: "gemini-2.5-flash",
              inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
              outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
              label: String(planName ?? "").slice(0, 200),
            })
            .catch((err: unknown) => console.error("AI usage log: failed to record Plan Management AI workflow entry (non-fatal):", err));
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
// Same idea, for the Term FAQ Sheet's own independent "Connect Google
// Sheets" grant (Connections page) — see
// src/server/auth/googleOAuth.ts's Term FAQ Sheet section.
const TERM_FAQ_OAUTH_STATE_COOKIE = "ditto_term_faq_oauth_state";
// Same idea, for the Term Playbook Sheet's own independent "Connect Google
// Sheets" grant (Connections page) — see
// src/server/auth/googleOAuth.ts's Term Playbook Sheet section.
const TERM_PLAYBOOK_OAUTH_STATE_COOKIE = "ditto_term_playbook_oauth_state";
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

  const termFaqExpectedState = req.cookies?.[TERM_FAQ_OAUTH_STATE_COOKIE];
  if (termFaqExpectedState) {
    res.clearCookie(TERM_FAQ_OAUTH_STATE_COOKIE);
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string" || !state || state !== termFaqExpectedState) {
        res.status(400).send("Invalid or expired connection attempt. Please try connecting again from Connections.");
        return;
      }
      const grant = await exchangeCodeForTermFaqSheetsGrant(code);
      const { termFaqConnection } = createRepositories(getDb());
      await termFaqConnection.upsert({
        connectedEmail: grant.email,
        encryptedRefreshToken: encryptTermFaqRefreshToken(grant.refreshToken),
        connectedBy: req.user?.email || grant.email,
      });
      invalidateTermFaqSheetsAuthCache();
      res.redirect("/?term_faq_connected=1");
    } catch (err: any) {
      console.error("Term FAQ Google Sheets connection failed:", err);
      res.status(401).send(`Connecting Google Sheets failed: ${err.message || "unknown error"}. Please try again from Connections.`);
    }
    return;
  }

  const termPlaybookExpectedState = req.cookies?.[TERM_PLAYBOOK_OAUTH_STATE_COOKIE];
  if (termPlaybookExpectedState) {
    res.clearCookie(TERM_PLAYBOOK_OAUTH_STATE_COOKIE);
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string" || !state || state !== termPlaybookExpectedState) {
        res.status(400).send("Invalid or expired connection attempt. Please try connecting again from Connections.");
        return;
      }
      const grant = await exchangeCodeForTermPlaybookSheetsGrant(code);
      const { termPlaybookConnection } = createRepositories(getDb());
      await termPlaybookConnection.upsert({
        connectedEmail: grant.email,
        encryptedRefreshToken: encryptTermPlaybookRefreshToken(grant.refreshToken),
        connectedBy: req.user?.email || grant.email,
      });
      invalidateTermPlaybookSheetsAuthCache();
      res.redirect("/?term_playbook_connected=1");
    } catch (err: any) {
      console.error("Term Playbook Google Sheets connection failed:", err);
      res.status(401).send(`Connecting Google Sheets failed: ${err.message || "unknown error"}. Please try again from Connections.`);
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
    // Best-effort — a directory-row lookup/stamp failure should never block
    // sign-in itself; the session cookie above is already good regardless.
    try {
      const { users: usersRepoForLogin } = createRepositories(getDb());
      await usersRepoForLogin.stampLogin(identity.email, identity.picture || null);
    } catch (stampErr) {
      console.error("Failed to stamp login/picture for", identity.email, stampErr);
    }
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

/** Same as isValidAnnouncementTeam but also accepts "Both" — the
 * announcements.team column's own dedicated audience enum (announcement_
 * audience) is a superset of the shared announcement_team enum the plain
 * validator above still guards (12 other call sites validate a strictly
 * binary Health/Term `domain` param and must keep using that one; only the
 * 3 announcement create/list/update routes use this one). "Both" means the
 * announcement is visible to Health AND Term advisors alike (in addition to
 * advisors with no/mixed tags, who already see everything). */
function isValidAnnouncementAudience(v: unknown): v is "Health" | "Term" | "Both" {
  return v === "Health" || v === "Term" || v === "Both";
}

/** Resolves and validates the domain (Health/Term) an advisor-facing
 * Product Assist / Knowledge Base route should serve for this caller, per
 * the confirmed tag-based access rule (mirrors teamForTags's own
 * precedent, already governing announcements/Did You Know): a caller
 * tagged with only Health may only use "Health"; a caller tagged with only
 * Term may only use "Term"; a caller with BOTH tags, or NEITHER, may use
 * either. When the request doesn't specify a domain at all, defaults to
 * whichever domain the caller's tags restrict them to, or "Health" for an
 * unrestricted caller — keeping every pre-Term client call (which never
 * sends `domain`) working unchanged. Returns `{ error }` when the
 * requested domain is invalid or the caller's tags don't permit it. */
function resolveCallerDomain(
  requested: unknown,
  callerTags: string[] | null | undefined
): { domain: "Health" | "Term" } | { error: string } {
  const restriction = teamForTags(callerTags);
  if (requested === undefined || requested === null || requested === "") {
    return { domain: restriction ?? "Health" };
  }
  if (!isValidAnnouncementTeam(requested)) {
    return { error: 'domain must be "Health" or "Term".' };
  }
  if (restriction !== undefined && requested !== restriction) {
    return { error: `You don't have access to ${requested} Insurance Product Assist.` };
  }
  return { domain: requested };
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
    const { users: usersRepo, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
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
          return res.status(400).json({ error: "That business unit doesn't exist." });
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

    if (updated.length > 0) {
      try {
        // Bulk edits apply one intended value across many users with
        // different prior values, so this describes the change that was
        // APPLIED (not a per-user before/after diff) plus how many rows it
        // landed on — matching the deploy log style already used by, e.g.,
        // Department/Team/Role edits above.
        const [deptName, teamName, roleName] = await Promise.all([
          patch.departmentId ? departments.get(patch.departmentId).then((d) => d?.name) : Promise.resolve(undefined),
          patch.orgTeamId ? orgTeams.get(patch.orgTeamId).then((t) => t?.name) : Promise.resolve(undefined),
          patch.roleId ? roles.get(patch.roleId).then((r) => r?.name) : Promise.resolve(undefined),
        ]);
        const clauses = [
          "tier" in patch ? `tier → ${patch.tier}` : null,
          "status" in patch ? `status → ${patch.status}` : null,
          "tags" in patch ? `tags → ${(patch.tags as string[]).length ? (patch.tags as string[]).join("/") : "none"}` : null,
          "orgTeamId" in patch ? `business unit → ${patch.orgTeamId ? (teamName ?? "Unknown") : "Unassigned"}` : null,
          "departmentId" in patch ? `department → ${patch.departmentId ? (deptName ?? "Unknown") : "Unassigned"}` : null,
          "roleId" in patch ? `role → ${patch.roleId ? (roleName ?? "Unknown") : "Unassigned"}` : null,
        ].filter(Boolean).join(", ");
        await changeLogs.create({
          userName: req.user!.name,
          role: callerTier,
          actionType: "User Bulk Edited",
          planName: null,
          description: `Bulk-updated ${updated.length} advisor${updated.length === 1 ? "" : "s"}: ${clauses}.${
            skippedForDeveloperProtection > 0 ? ` (${skippedForDeveloperProtection} skipped — Developer-tier protection.)` : ""
          }`,
          snapshot: null,
        });
      } catch (logErr) {
        console.error("Failed to write change log for bulk user update:", logErr);
      }
    }

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
    const { users: usersRepo, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
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
        return res.status(400).json({ error: "That business unit doesn't exist." });
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

    try {
      // Only logs when at least one access-control-relevant field actually
      // changed — an edit that touches only name/TACT ID produces no entry
      // (see describeUserAccessChanges's doc comment above).
      const clauses = await describeUserAccessChanges(
        existing,
        { tier, status, tags: resolvedTags, ...(departmentId !== undefined ? { departmentId } : {}), ...(orgTeamId !== undefined ? { orgTeamId } : {}), ...(roleId !== undefined ? { roleId } : {}) },
        { departments, orgTeams, roles }
      );
      if (clauses.length > 0) {
        await changeLogs.create({
          userName: req.user!.name,
          role: callerTier,
          actionType: "User Edited",
          planName: null,
          description: `Updated advisor "${existing.name}" (${existing.email}): ${clauses.join(", ")}.`,
          snapshot: null,
        });
      }
    } catch (logErr) {
      console.error("Failed to write change log for user edit:", logErr);
    }

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
    const { users: usersRepo, changeLogs } = createRepositories(getDb());
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

    try {
      // Removing a user always revokes whatever access they held, so this
      // is inherently access-control-relevant — always logs, unlike the
      // single-row edit above.
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Deleted",
        planName: null,
        description: `Removed advisor "${existing.name}" (${existing.email}) from the directory — was ${existing.tier} tier, ${existing.status}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for user delete:", logErr);
    }

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
    const { users: usersRepo, changeLogs } = createRepositories(getDb());
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

    try {
      // This route replaces every row (including tier/status, both
      // access-control-relevant) in one write, and nothing in the shipped
      // UI calls it anymore (see the route's own comment above) — a
      // per-user before/after diff isn't worth building for a legacy path
      // with no real caller, so this logs a single summary entry instead of
      // the field-level diff the routes below produce.
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Directory Replaced",
        planName: null,
        description: `Replaced the entire user directory via the legacy full-array update route (${saved.length} users).`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for legacy directory replace:", logErr);
    }

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
    const { users: usersRepo, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
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
        return res.status(400).json({ error: "That business unit doesn't exist." });
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

    try {
      // A new user's tier/status/tags/org attributes are all
      // access-control-relevant from the moment the row exists, so creation
      // always logs (unlike the single-row edit route, which only logs
      // when one of those fields actually changes).
      const [deptName, teamName, roleName] = await Promise.all([
        departmentId ? departments.get(departmentId).then((d) => d?.name) : Promise.resolve(undefined),
        orgTeamId ? orgTeams.get(orgTeamId).then((t) => t?.name) : Promise.resolve(undefined),
        roleId ? roles.get(roleId).then((r) => r?.name) : Promise.resolve(undefined),
      ]);
      const details = [
        `tier ${tier}`,
        `status ${status}`,
        resolvedTags.length ? `tags ${resolvedTags.join("/")}` : null,
        teamName ? `business unit ${teamName}` : null,
        deptName ? `department ${deptName}` : null,
        roleName ? `role ${roleName}` : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Added",
        planName: null,
        description: `Added advisor "${row.name}" (${row.email}) to the directory — ${details}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for user creation:", logErr);
    }

    return res.json({ success: true, user: row });
  } catch (err: any) {
    console.error("Failed to add a new directory entry:", err);
    return res.status(500).json({ error: "Failed to add this user." });
  }
});

// Bulk pre-provision — at the user's explicit request: "pre-determine a
// user's access and profile configuration before their first login...the
// only individual input required should be User Email ID," with Product
// Tag/Business Unit/Department/Role/Tier configured ONCE for the whole
// batch. Unlike POST /api/users above, `name` and `tactId` are deliberately
// left blank ("" — the `users` columns are NOT NULL, but an empty string is
// a valid value, not a schema violation): the person themselves supplies
// those two fields at first login. See POST /api/me/first-time-setup below
// for the other half of this — completing one of these rows in place
// instead of refusing "already set up".
//
// Every other row of the batch config (tier/tags/departmentId/orgTeamId/
// roleId) is validated exactly like POST /api/users' own fields, since this
// is really "POST /api/users, run once per email, with name/tactId
// omitted" — same authorization (isAdminPower), same tier-grant ceiling, so
// an Admin still can't mass-provision a batch of Developers.
app.post("/api/users/bulk-provision", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isAdminPower(callerTier)) {
      return res.status(403).json({ error: "Only Admin and Developer roles can add users to the directory." });
    }

    const { emails, tier, tags, departmentId, orgTeamId, roleId } = req.body;
    if (!Array.isArray(emails) || emails.length === 0 || !emails.every((e: any) => typeof e === "string")) {
      return res.status(400).json({ error: "emails must be a non-empty array of email addresses." });
    }
    const resolvedTags = tags === undefined ? [] : tags;
    if (!isValidAdvisorTags(resolvedTags)) {
      return res.status(400).json({ error: `tags, if present, must be an array containing only: ${ADVISOR_TAG_VALUES.join(", ")}.` });
    }
    if (tier !== "General" && tier !== "Admin" && tier !== "Platform Admin" && tier !== "Developer") {
      return res.status(400).json({ error: "tier must be one of General, Admin, Platform Admin, or Developer." });
    }
    // Same tier-grant ceiling as POST /api/users above.
    if (tier === "Developer" && callerTier !== "Developer") {
      return res.status(403).json({ error: "Only the Developer role can grant Developer clearance." });
    }
    if (tier === "Platform Admin" && callerTier === "Admin") {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can grant Platform Admin clearance." });
    }
    // Business Unit is REQUIRED for a bulk batch (unlike POST /api/users,
    // where it's optional for a single Admin-typed row) — this whole
    // feature's stated purpose is pre-determining a batch's org placement.
    // Department/Role are optional here (2026-09, at the user's explicit
    // request — a "Not in the List" option lets a batch go out with those
    // left unassigned, for when the right department/role doesn't exist yet;
    // the person completing first-time setup can still be assigned one
    // later from the Directory).
    if (typeof orgTeamId !== "number" || !Number.isInteger(orgTeamId)) {
      return res.status(400).json({ error: "orgTeamId is required." });
    }
    const hasDept = typeof departmentId === "number" && Number.isInteger(departmentId);
    const hasRole = typeof roleId === "number" && Number.isInteger(roleId);
    const [dept, team, role] = await Promise.all([
      hasDept ? departments.get(departmentId) : Promise.resolve(null),
      orgTeams.get(orgTeamId),
      hasRole ? roles.get(roleId) : Promise.resolve(null),
    ]);
    if (hasDept && !dept) return res.status(400).json({ error: "That department doesn't exist." });
    if (!team) return res.status(400).json({ error: "That business unit doesn't exist." });
    if (hasRole && !role) return res.status(400).json({ error: "That role doesn't exist." });

    // Normalize + dedupe the batch itself before touching the DB — a stray
    // blank line or repeated paste in the email textarea shouldn't surface
    // as a confusing per-row failure.
    const seen = new Set<string>();
    const normalizedEmails: string[] = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (!email || !email.includes("@")) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      normalizedEmails.push(email);
    }
    if (normalizedEmails.length === 0) {
      return res.status(400).json({ error: "No valid email addresses were provided." });
    }

    const created: Array<Awaited<ReturnType<typeof usersRepo.create>>> = [];
    const skipped: { email: string; reason: string }[] = [];
    for (const email of normalizedEmails) {
      const existing = await usersRepo.findByEmail(email);
      if (existing) {
        skipped.push({ email, reason: "Already in the directory" });
        continue;
      }
      const row = await usersRepo.create({
        email,
        name: "",
        tactId: "",
        tier,
        status: "Active",
        tags: resolvedTags,
        departmentId: hasDept ? departmentId : null,
        orgTeamId,
        roleId: hasRole ? roleId : null,
      });
      created.push(row);
    }

    if (created.length > 0) {
      try {
        await changeLogs.create({
          userName: req.user!.name,
          role: callerTier,
          actionType: "Users Bulk-Provisioned",
          planName: null,
          description: `Pre-provisioned ${created.length} ${created.length === 1 ? "user" : "users"} (${created.map((u) => u.email).join(", ")}) — tier ${tier}, business unit ${team.name}, department ${dept ? dept.name : "Not in the List"}, role ${role ? role.name : "Not in the List"}${resolvedTags.length ? `, tags ${resolvedTags.join("/")}` : ""}. Each completes their own name and TACT ID at first login.`,
          snapshot: null,
        });
      } catch (logErr) {
        console.error("Failed to write change log for bulk user provisioning:", logErr);
      }
    }

    return res.json({ success: true, created, skipped });
  } catch (err: any) {
    console.error("Failed to bulk-provision users:", err);
    return res.status(500).json({ error: `Failed to bulk-add users: ${err.message}` });
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
// NOT applied to most of the Access Control Center's own administrative
// routes (users, departments, org-teams, roles, custom-access-grants,
// access-rules) — those stay on their existing hardcoded Developer/
// Platform-Admin-only gates. Reasoning: those routes configure the
// authorization system itself, so letting a Custom Grant or Permissions-tab
// edit ever raise access to THEM would be a privilege-escalation path (a
// careless or malicious grant on "profile_access" could hand a General user
// the ability to grant further access to themselves). This is a deliberate
// scope boundary, not an oversight.
//
// relationship-groups/user-relationships/group-access ARE wired through
// requireFeatureAccess() (2026-09, Group Level Access) — but against the
// narrower "group_management" featureId, never "profile_access". That's a
// meaningfully different grant to hold: its only effect, end to end, is
// raising a member's access to GROUP_CONFIGURABLE_FEATURES (ordinary
// Advisor/Admin Zone workspace tools, excluding profile_access itself —
// see that Set's own doc comment) — there's no path from holding it to
// granting oneself or anyone else the ability to grant further access, so
// the self-escalation concern above doesn't apply to it. See
// featurePermissions.ts's "group_management" entry for the full reasoning.
//
// page-visibility's PUT route and the Product Assist quota admin routes
// (requireQuotaAdmin) WERE also on this list, alongside "feature-access"
// itself — all four gated by the (formerly non-empty) DEVELOPER_ONLY_
// FEATURES hard gate for owner_controls/connections/smoke_test/
// product_assist_quota. That Set is empty as of 2026-09 (the user's
// explicit request — those four are ordinary reassignable features now),
// so all of them ARE wired through requireFeatureAccess() below. The one
// exception is GET /api/page-visibility itself, which stays requireAuth-
// only on purpose (see its own comment) — every signed-in user's client
// needs to read the full hidden-pages set to compute their OWN visibility,
// regardless of whether they can manage Feature Visibility themselves.
//
// Access Control Center Phase 3 (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md):
// delegates to the same evaluateAccess()/resolveAccess() evaluator hasAccess()
// (App.tsx) and EffectiveAccessModal now also call, instead of re-deriving
// tier/override/grant resolution inline here a third time. Deliberately
// preserves the exact resolution order and 403 wording this function always
// had — including NOT checking Feature Visibility (hiddenPages), which
// hasAccess() does and this never has; see accessRuleEvaluator.ts's header
// comment on that asymmetry, which Phase 3 leaves as-is rather than
// silently changing real server behavior.
async function requireFeatureAccess(
  req: any,
  res: any,
  featureId: string,
  actionType: "Viewer" | "Editor",
  action: string
): Promise<boolean> {
  const { level } = await evaluateAccess(getDb(), req.user?.email, featureId);
  if (!levelAllows(level, actionType as AccessActionType)) {
    // DEVELOPER_ONLY_FEATURES is an empty Set as of 2026-09 (see
    // featurePermissions.ts), so this branch is currently always false for
    // every featureId — kept rather than removed so a future feature that
    // genuinely needs a hard, un-overridable lock gets this more specific
    // denial message for free just by being added to that Set again.
    const message = DEVELOPER_ONLY_FEATURES.has(featureId)
      ? `${action} requires Developer or Platform Admin tier.`
      : `${action} requires access to this feature.`;
    res.status(403).json({ error: message });
    return false;
  }
  return true;
}

/**
 * Ownership-aware authorization for the Groups tab's WRITE routes on a
 * SPECIFIC group (2026-09h, at the user's explicit request: "A group owner
 * must be able to view and modify their own group, including its members
 * and access configuration, through the existing Group Management access"
 * / "Group owners must not be able to modify other owners' groups unless
 * they have separately authorized access" / "Preserve the existing
 * Platform Admin/Developer privileges" / "Enforce ownership checks on both
 * frontend and backend, including direct API requests").
 *
 * Passes when EITHER:
 *   1. The caller already holds blanket group_management Editor —
 *      unchanged from before: Platform Admin/Developer always (tier
 *      default), or anyone else holding an explicit Custom Grant/Access
 *      Rule for group_management Editor. This is the "separately
 *      authorized access" the user's second bullet carves out — it can
 *      still edit EVERY group, not just ones it owns.
 *   2. The caller holds at least group_management Viewer (so they can
 *      already see the Groups tab and its group list at all — unchanged
 *      gate, see the GET routes above) AND is a mapped OWNER of THIS
 *      specific groupId (userRelationships.isOwnerOfGroup) — the new
 *      ownership carve-out. This deliberately does NOT extend to a caller
 *      with no group_management access at all (e.g. an unconfigured
 *      General-tier user who happens to have an owner row): they'd have no
 *      way to even reach the Groups tab in the first place, and this
 *      function doesn't widen that separately-gated visibility boundary —
 *      only who can WRITE once they're already looking at it.
 *
 * A caller who is an owner of some OTHER group, but not `groupId`, falls
 * through to the 403 below exactly like a non-owner would — ownership
 * never generalizes across groups.
 */
async function requireGroupAccessEditor(req: any, res: any, groupId: number, action: string): Promise<boolean> {
  const { level } = await evaluateAccess(getDb(), req.user?.email, "group_management");
  if (levelAllows(level, "Editor")) return true;
  if (levelAllows(level, "Viewer") && req.user?.email) {
    const { userRelationships } = createRepositories(getDb());
    if (await userRelationships.isOwnerOfGroup(groupId, req.user.email)) return true;
  }
  res.status(403).json({ error: `${action} requires access to this feature, or ownership of this group.` });
  return false;
}

// --- Search History (powers the Audit tab's full list and My Activity's self-filtered view) ---

app.get("/api/search-history", requireAuth, async (req, res) => {
  try {
    const requestedEmail = typeof req.query.userEmail === "string" ? req.query.userEmail.toLowerCase() : undefined;
    const isSelf = !!requestedEmail && requestedEmail === req.user!.email.toLowerCase();

    // Anyone may view their OWN search history (My Activity, its own
    // "my_activity" feature — unaffected by this check). Viewing everyone's
    // (Audit tab, no userEmail filter, or someone else's email) is gated on
    // the "audit" feature. Was requireAdminOrDeveloper (a hardcoded tier
    // check) — switched to requireFeatureAccess (2026-09 permission
    // architecture fix) so the Permissions tab's "Activity Log" row actually
    // has an effect; Viewer, not Editor, since this route only ever reads —
    // there's no admin/config action on this page to reserve Editor for.
    if (!isSelf && !(await requireFeatureAccess(req, res, "audit", "Viewer", "Viewing other users' search history"))) return;

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
    // Was isDeveloperPower (a hardcoded tier check) — switched to
    // clear_activity Editor (2026-09 permission architecture fix) to match
    // the client's own hasAccess("clear_activity", "Editor") gate on this
    // button (App.tsx). Without this, a Custom Grant/Access Rule here would
    // show the button and then 403.
    if (!(await requireFeatureAccess(req, res, "clear_activity", "Editor", "Clearing activity history"))) return;
    const { searchHistory } = createRepositories(getDb());
    await searchHistory.clearAll();
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to clear search history:", err);
    return res.status(500).json({ error: `Failed to clear search history: ${err.message}` });
  }
});

// --- Change Logs (Audit tab's "Modification History" sub-tab; also the
// Access Control Center's own "Change History" sub-tab — see
// ACCESS_CONTROL_ACTION_TYPE_PREFIXES below) ---

// The Access Control Center's own sub-tabs, mapped to the actionType
// prefix(es) each one's routes actually write to change_logs — used by GET
// /api/change-logs?scope=access-control(&category=...) (Access Control
// Center Phase 5, docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). Keys mirror
// ProfileAccessPage.tsx's SubTab ids so the UI's category filter and this
// map stay easy to keep in sync by eye. Hand-maintained (not derived) so
// it's one single, auditable list of every actionType family the
// Departments/Teams/Roles/Access Rules/Relationships/Custom Grants/
// Permissions/QA Dashboard Access/User Directory routes above actually
// write. "directory" lists each User Directory actionType by its full
// string rather than a short shared prefix like the other categories,
// because "User " alone would also match "User Relationship
// Created/Removed" (the Relationships category) — see
// describeUserAccessChanges's doc comment above for what does/doesn't
// trigger those. Deliberately excludes Product Assist's quota-eligibility
// settings ("Product Assist Quota...", a different admin page, not a
// sub-tab of the Access Control Center).
const ACCESS_CONTROL_CHANGE_LOG_CATEGORIES: Record<string, string[]> = {
  directory: ["User Added", "User Edited", "User Deleted", "User Bulk Edited", "User Directory Replaced"],
  permissions: ["Feature Access", "Page Visibility"],
  teams: ["Business Unit"],
  departments: ["Department"],
  roles: ["Role"],
  access_rules: ["Access Rule"],
  // "Relationship Type" (the old prefix here) never matched anything real —
  // the actual actionTypes are "Relationship Group ..." (the group catalog
  // itself), "User Relationship ..." (roster mappings), and "Group Tool
  // Access Updated" (the Groups tab's tool-access save) — all three now
  // listed so the Change History filter actually surfaces every Groups tab
  // change instead of silently only ever matching roster mappings.
  relationships: ["Relationship Group", "User Relationship", "Group Tool Access"],
  custom_grants: ["Custom Access"],
  qa_access: ["QA Dashboard Access"],
};
const ACCESS_CONTROL_ACTION_TYPE_PREFIXES = Object.values(ACCESS_CONTROL_CHANGE_LOG_CATEGORIES).flat();

app.get("/api/change-logs", requireAuth, async (req, res) => {
  try {
    // Dual-purpose route: the Audit tab's own "Modification History" (no
    // scope) is an ordinary governed feature — gated on "audit" Viewer
    // (2026-09 permission architecture fix; was requireAdminOrDeveloper).
    // But ?scope=access-control is the Access Control Center's OWN "Change
    // History" sub-tab (custom grants, role/department/org changes, QA
    // Dashboard Access, relationship groups — see
    // ACCESS_CONTROL_CHANGE_LOG_CATEGORIES above) and deliberately stays on
    // the hardcoded Admin/Developer-power check, same as every other
    // ACC-administrative route (users, departments, roles, custom-access-
    // grants, access-rules) — letting an "audit" grant see who was promoted
    // or what a Custom Grant changed would be a self-escalation-adjacent
    // information leak, not an ordinary feature-view gap.
    if (req.query.scope === "access-control") {
      if (!(await requireAdminOrDeveloper(req, res, "Viewing Access Control Center change history"))) return;
    } else {
      if (!(await requireFeatureAccess(req, res, "audit", "Viewer", "Viewing the modification history"))) return;
    }
    const { changeLogs } = createRepositories(getDb());
    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 50, "desc");
      const actionType = typeof req.query.actionType === "string" ? req.query.actionType : undefined;
      const accessControlCategory = typeof req.query.category === "string" ? ACCESS_CONTROL_CHANGE_LOG_CATEGORIES[req.query.category] : undefined;
      const actionTypePrefixes = req.query.scope === "access-control" ? (accessControlCategory ?? ACCESS_CONTROL_ACTION_TYPE_PREFIXES) : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const clOptions = { search, actionType, actionTypePrefixes, from, to, sortBy, sortDir };
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
      // Was requireAdminOrDeveloper (a hardcoded tier check) — switched to
      // qa_announcement_log Viewer (2026-09 permission architecture fix) so
      // this matches the POST/PUT/DELETE routes below, which already gate
      // on qa_announcement_log Editor. Without this, a Custom Grant/Access
      // Rule raising a non-Admin/Developer user to qa_announcement_log
      // Editor could create/edit/delete but never fetch the other team's
      // announcements to manage them.
      if (!(await requireFeatureAccess(req, res, "qa_announcement_log", "Viewer", "Viewing announcements across all teams"))) return;
    } else {
      const caller = await usersRepo.findByEmail(req.user!.email);
      team = teamForTags(caller?.tags);
    }

    if (req.query.paginated) {
      const { page, pageSize, search, sortBy, sortDir } = parseListQuery(req.query, 25, "desc");
      // "General Announcement" stays in this whitelist for legacy rows that
      // migration 0056 couldn't reclassify (see schema.ts's announcementTypeEnum)
      // — it's just no longer creatable via the form.
      const type = pickEnumValue(req.query.type, ["QA Announcement", "General Announcement", "Product Announcement", "Insurance Operations", "Insight"] as const);
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

    // "Insight" rows are legacy-only (the type was retired 2026-09 — the
    // Did You Know card is now a live FAQ feed, see GET /api/did-you-know)
    // but any that still exist in the table must never surface in this
    // shared unfiltered feed, which backs both the advisor-facing
    // Announcements archive AND the Home Dashboard's carousel.
    const rows = await announcements.list({ category, team, excludeTypes: ["Insight"] });
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list announcements:", err);
    return res.status(500).json({ error: `Failed to load announcements: ${err.message}` });
  }
});

app.post("/api/announcements", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "qa_announcement_log", "Editor", "Creating announcements"))) return;
    const { announcement, effectiveDate, category, rating, type, validTillDate, title, announcementDate, team } = req.body;
    // "General Announcement" is deliberately NOT reachable here — the form
    // no longer offers it (see QAAnnouncementForm.tsx's Type dropdown), so
    // any unrecognized/omitted type falls back to QA Announcement, same as
    // before. Product Announcement / Insurance Operations are the two real
    // non-QA, non-Insight types now.
    const resolvedType =
      type === "Insight" ? "Insight" :
      type === "Product Announcement" ? "Product Announcement" :
      type === "Insurance Operations" ? "Insurance Operations" :
      "QA Announcement";
    const isInsight = resolvedType === "Insight";
    // fromTeam is no longer accepted from the client (the "From" input was
    // removed from the form — see QAAnnouncementForm.tsx) — it's derived
    // straight from the resolved type instead, mirroring how QA Announcement
    // rows have always had it effectively unused/null.
    const resolvedFromTeam =
      resolvedType === "Product Announcement" ? "Product Team" :
      resolvedType === "Insurance Operations" ? "Insurance Operations" :
      null;

    if (typeof announcement !== "string" || !announcement.trim()) {
      return res.status(400).json({ error: "Insight content is required." });
    }
    // Insights are simple informational content — no category, rating, title,
    // or date fields apply to them (see requirement #6).
    if (!isInsight && (typeof category !== "string" || !category.trim())) {
      return res.status(400).json({ error: "announcement and category are required." });
    }
    if (team !== undefined && !isValidAnnouncementAudience(team)) {
      return res.status(400).json({ error: "team must be 'Health', 'Term', or 'Both'." });
    }
    const { announcements } = createRepositories(getDb());
    const row = await announcements.create({
      announcement,
      // The category column is NOT NULL; Insights don't have a concept of
      // category, so a fixed label satisfies the constraint without
      // surfacing it as a field admins fill in.
      category: isInsight ? "Insight" : category,
      addedBy: req.user!.name,
      effectiveDate: isInsight ? null : (effectiveDate || null),
      rating: isInsight ? null : (typeof rating === "number" ? rating : null),
      type: resolvedType,
      validTillDate: isInsight ? null : (validTillDate || null),
      title: isInsight ? null : (title || null),
      fromTeam: isInsight ? null : resolvedFromTeam,
      // Distinct from effectiveDate (see schema.ts) — when this notice was
      // posted, not when the policy it describes takes effect.
      announcementDate: isInsight ? null : (announcementDate || null),
      // Which advisor audience this targets (Health-tagged / Term-tagged
      // visibility rules — see teamForTags). Defaults to "Health",
      // matching the column default and the spec's retroactive backfill.
      // Insights aren't audience-restricted (see the dedicated insight
      // route, which never filters by team), so this value is unused for
      // them — kept as a harmless default rather than a nullable column.
      team: isValidAnnouncementAudience(team) ? team : "Health",
      // Insights are purely informational — never gate the app behind the
      // mandatory read-and-acknowledge modal for them (column defaults to
      // true, so this must be set explicitly).
      requiresAck: !isInsight,
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

    const { announcement, effectiveDate, category, rating, type, validTillDate, title, announcementDate, team } = req.body;
    if (team !== undefined && !isValidAnnouncementAudience(team)) {
      return res.status(400).json({ error: "team must be 'Health', 'Term', or 'Both'." });
    }
    // fromTeam is no longer accepted from the client (the "From" input was
    // removed from the form — see QAAnnouncementForm.tsx). It's derived from
    // `type` only when the edit sets type to one of the two new types —
    // otherwise it's left untouched, so e.g. editing a legacy General
    // Announcement's Title/dates doesn't wipe its historical from_team.
    const resolvedFromTeam =
      type === "Product Announcement" ? "Product Team" :
      type === "Insurance Operations" ? "Insurance Operations" :
      undefined;
    const { announcements } = createRepositories(getDb());
    const row = await announcements.update(id, {
      ...(announcement !== undefined ? { announcement } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(effectiveDate !== undefined ? { effectiveDate } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(validTillDate !== undefined ? { validTillDate } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(resolvedFromTeam !== undefined ? { fromTeam: resolvedFromTeam } : {}),
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
    // Was a hardcoded isDeveloperPower-only gate (matching "owner_controls"'s
    // old DEVELOPER_ONLY_FEATURES membership). That Set is now empty
    // (2026-09), so this is the same requireFeatureAccess() every other
    // governed feature's write routes use — a Permissions-tab / Access Rule
    // / Custom Grant on "owner_controls" now actually takes effect here.
    if (!(await requireFeatureAccess(req, res, "owner_controls", "Editor", "Changing page visibility"))) return;
    const callerTier = await getCallerTier(req, usersRepo);

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
    // owner_controls/connections/smoke_test/product_assist_quota used to be
    // rejected here unconditionally (DEVELOPER_ONLY_FEATURES was a hard,
    // un-overridable gate for them). That Set is empty as of 2026-09 — all
    // four are now ordinary governed features, writable like any other —
    // so this route no longer special-cases them.
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

// Delete — Access Control Center Phase 4
// (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). See
// src/server/accessControl/catalogDependencies.ts's header comment for why
// this needs an explicit dependency check even though every referencing FK
// is ON DELETE SET NULL. Two-step: an active Access Rule or the Product
// Assist eligibility settings referencing this department blocks deletion
// outright (409, suggest Disable instead); users or inactive rules
// referencing it require the caller to resend with `confirmed: true`
// after seeing the counts; zero dependencies deletes immediately.
app.delete("/api/departments/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, departments, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can delete departments." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid department id." });
    }
    const existing = await departments.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Department not found." });
    }

    const summary = await countCatalogDependencies(getDb(), "department", id);
    if (blocksDeletion(summary)) {
      return res.status(409).json({
        error: `Cannot delete "${existing.name}" — ${describeDependencies(summary)}. Deactivate it instead, or remove those references first.`,
        dependencies: summary,
      });
    }
    if (needsConfirmation(summary) && req.body?.confirmed !== true) {
      return res.status(409).json({
        error: `Deleting "${existing.name}" will affect: ${describeDependencies(summary)}.`,
        requiresConfirmation: true,
        dependencies: summary,
      });
    }

    await departments.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Department Deleted",
        planName: null,
        description: `Deleted department "${existing.name}"${needsConfirmation(summary) ? ` (${describeDependencies(summary)})` : ""}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for department deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete department:", err);
    return res.status(500).json({ error: `Failed to delete this department: ${err.message}` });
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
    return res.status(500).json({ error: `Failed to load business units: ${err.message}` });
  }
});

app.post("/api/org-teams", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, orgTeams, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create business units." });
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
        actionType: "Business Unit Created",
        planName: null,
        description: `Created business unit "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for team creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A business unit with that name already exists." });
    }
    console.error("Failed to create team:", err);
    return res.status(500).json({ error: `Failed to create this business unit: ${err.message}` });
  }
});

app.patch("/api/org-teams/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, orgTeams, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can edit business units." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid business unit id." });
    }
    const existing = await orgTeams.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Business unit not found." });
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
        actionType: "Business Unit Edited",
        planName: null,
        description: `Business unit "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for team edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A business unit with that name already exists." });
    }
    console.error("Failed to update team:", err);
    return res.status(500).json({ error: `Failed to update this business unit: ${err.message}` });
  }
});

// Delete — see DELETE /api/departments/:id's comment above for the full
// dependency-safety reasoning; identical two-step logic, scoped to
// org_team_id references instead.
app.delete("/api/org-teams/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, orgTeams, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can delete business units." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid business unit id." });
    }
    const existing = await orgTeams.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Business unit not found." });
    }

    const summary = await countCatalogDependencies(getDb(), "orgTeam", id);
    if (blocksDeletion(summary)) {
      return res.status(409).json({
        error: `Cannot delete "${existing.name}" — ${describeDependencies(summary)}. Deactivate it instead, or remove those references first.`,
        dependencies: summary,
      });
    }
    if (needsConfirmation(summary) && req.body?.confirmed !== true) {
      return res.status(409).json({
        error: `Deleting "${existing.name}" will affect: ${describeDependencies(summary)}.`,
        requiresConfirmation: true,
        dependencies: summary,
      });
    }

    await orgTeams.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Business Unit Deleted",
        planName: null,
        description: `Deleted business unit "${existing.name}"${needsConfirmation(summary) ? ` (${describeDependencies(summary)})` : ""}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for team deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete team:", err);
    return res.status(500).json({ error: `Failed to delete this business unit: ${err.message}` });
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

// Delete — see DELETE /api/departments/:id's comment above for the full
// dependency-safety reasoning; identical two-step logic, scoped to role_id
// references instead.
app.delete("/api/roles/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can delete roles." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid role id." });
    }
    const existing = await roles.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Role not found." });
    }

    const summary = await countCatalogDependencies(getDb(), "role", id);
    if (blocksDeletion(summary)) {
      return res.status(409).json({
        error: `Cannot delete "${existing.name}" — ${describeDependencies(summary)}. Deactivate it instead, or remove those references first.`,
        dependencies: summary,
      });
    }
    if (needsConfirmation(summary) && req.body?.confirmed !== true) {
      return res.status(409).json({
        error: `Deleting "${existing.name}" will affect: ${describeDependencies(summary)}.`,
        requiresConfirmation: true,
        dependencies: summary,
      });
    }

    await roles.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Role Deleted",
        planName: null,
        description: `Deleted role "${existing.name}"${needsConfirmation(summary) ? ` (${describeDependencies(summary)})` : ""}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for role deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete role:", err);
    return res.status(500).json({ error: `Failed to delete this role: ${err.message}` });
  }
});

// Access Rules — Access Control Center Phase 2
// (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). CRUD only: nothing on this
// page reads access_rules yet (that's Phase 3, evaluateAccess.ts), so
// creating/editing a rule here has zero runtime effect today — see
// schema.ts's doc comment on `accessRules`. Same read/write posture as
// Custom Access Grants above (more sensitive than the plain Team/
// Department/Role catalogs, since a rule actually grants access once wired
// up): read open to Admin+Platform Admin+Developer, writes gated to
// Developer+Platform Admin only.
app.get("/api/access-rules", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing access rules"))) return;
    const { accessRules } = createRepositories(getDb());
    const rows = await accessRules.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list access rules:", err);
    return res.status(500).json({ error: `Failed to load access rules: ${err.message}` });
  }
});

const ACCESS_RULE_LEVELS = ["None", "Viewer", "Editor"] as const;

app.post("/api/access-rules", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, accessRules, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can create access rules." });
    }
    const { resourceKey, name, orgTeamId, departmentId, roleId, productTag, grantedLevel } = req.body;
    if (typeof resourceKey !== "string" || !resourceKey.trim()) {
      return res.status(400).json({ error: "resourceKey is required." });
    }
    if (!DEFAULT_FEATURE_PERMISSIONS.some((p) => p.id === resourceKey)) {
      return res.status(400).json({ error: "resourceKey must be a known feature id." });
    }
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    if (!ACCESS_RULE_LEVELS.includes(grantedLevel)) {
      return res.status(400).json({ error: `grantedLevel must be one of: ${ACCESS_RULE_LEVELS.join(", ")}.` });
    }
    const toId = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const row = await accessRules.create({
      resourceKey: resourceKey.trim(),
      name: name.trim(),
      orgTeamId: toId(orgTeamId),
      departmentId: toId(departmentId),
      roleId: toId(roleId),
      productTag: typeof productTag === "string" && productTag.trim() ? productTag.trim() : null,
      grantedLevel,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      const featureName = DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === row.resourceKey)?.name || row.resourceKey;
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Access Rule Created",
        planName: null,
        description: `Created access rule "${row.name}" — grants ${row.grantedLevel} on "${featureName}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for access rule creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to create access rule:", err);
    return res.status(500).json({ error: `Failed to create this access rule: ${err.message}` });
  }
});

app.patch("/api/access-rules/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, accessRules, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin can edit access rules." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid access rule id." });
    }
    const existing = await accessRules.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Access rule not found." });
    }

    const { name, resourceKey, active, orgTeamId, departmentId, roleId, productTag, grantedLevel } = req.body;
    const patch: {
      name?: string;
      resourceKey?: string;
      active?: boolean;
      orgTeamId?: number | null;
      departmentId?: number | null;
      roleId?: number | null;
      productTag?: string | null;
      grantedLevel?: (typeof ACCESS_RULE_LEVELS)[number];
    } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty." });
      }
      patch.name = name.trim();
    }
    // Was silently dropped before this fix — the edit UI lets an admin
    // change which feature a rule applies to (see AccessRulesManagement.tsx's
    // edit-row Resource picker), but this route never read resourceKey out
    // of req.body, so the save appeared to succeed while the rule quietly
    // kept its original resource after reload.
    if (resourceKey !== undefined) {
      if (typeof resourceKey !== "string" || !resourceKey.trim()) {
        return res.status(400).json({ error: "resourceKey cannot be empty." });
      }
      if (!DEFAULT_FEATURE_PERMISSIONS.some((p) => p.id === resourceKey)) {
        return res.status(400).json({ error: "resourceKey must be a known feature id." });
      }
      patch.resourceKey = resourceKey.trim();
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active must be a boolean." });
      }
      patch.active = active;
    }
    const toId = (v: unknown) => (v === null || v === "" ? null : Number(v));
    if (orgTeamId !== undefined) patch.orgTeamId = toId(orgTeamId);
    if (departmentId !== undefined) patch.departmentId = toId(departmentId);
    if (roleId !== undefined) patch.roleId = toId(roleId);
    if (productTag !== undefined) patch.productTag = typeof productTag === "string" && productTag.trim() ? productTag.trim() : null;
    if (grantedLevel !== undefined) {
      if (!ACCESS_RULE_LEVELS.includes(grantedLevel)) {
        return res.status(400).json({ error: `grantedLevel must be one of: ${ACCESS_RULE_LEVELS.join(", ")}.` });
      }
      patch.grantedLevel = grantedLevel;
    }

    const row = await accessRules.update(id, patch);

    try {
      const changeSummary = [
        patch.name !== undefined && patch.name !== existing.name ? `renamed to "${patch.name}"` : null,
        patch.resourceKey !== undefined && patch.resourceKey !== existing.resourceKey
          ? `resource changed to "${DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === patch.resourceKey)?.name || patch.resourceKey}"`
          : null,
        patch.active !== undefined && patch.active !== existing.active ? (patch.active ? "reactivated" : "deactivated") : null,
        patch.grantedLevel !== undefined && patch.grantedLevel !== existing.grantedLevel ? `level changed to ${patch.grantedLevel}` : null,
        (patch.orgTeamId !== undefined || patch.departmentId !== undefined || patch.roleId !== undefined || patch.productTag !== undefined) ? "conditions updated" : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Access Rule Edited",
        planName: null,
        description: `Access rule "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for access rule edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update access rule:", err);
    return res.status(500).json({ error: `Failed to update this access rule: ${err.message}` });
  }
});

// Relationship Groups (Mentor / Guide / ...) — the vocabulary usable in
// user_relationships below. Same read/write posture as Org Teams/Roles.
// Renamed from Relationship Types (2026-09) — same table/behavior, "group"
// instead of "type" throughout.
app.get("/api/relationship-groups", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "group_management", "Viewer", "Viewing relationship groups"))) return;
    const { relationshipGroups } = createRepositories(getDb());
    const rows = await relationshipGroups.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list relationship groups:", err);
    return res.status(500).json({ error: `Failed to load relationship groups: ${err.message}` });
  }
});

app.post("/api/relationship-groups", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipGroups, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    if (!(await requireFeatureAccess(req, res, "group_management", "Editor", "Creating relationship groups"))) return;
    const { name, description, departmentId } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    if (departmentId !== undefined && departmentId !== null && !Number.isInteger(departmentId)) {
      return res.status(400).json({ error: "departmentId must be an integer or null." });
    }
    const row = await relationshipGroups.create({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      departmentId: departmentId ?? null,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Relationship Group Created",
        planName: null,
        description: `Created relationship group "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for relationship group creation:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A relationship group with that name already exists." });
    }
    console.error("Failed to create relationship group:", err);
    return res.status(500).json({ error: `Failed to create this relationship group: ${err.message}` });
  }
});

app.patch("/api/relationship-groups/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipGroups, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid relationship group id." });
    }
    // Ownership-aware (2026-09h) — a group's own owner can edit it (rename,
    // toggle active, change its Group Access grants' department scope)
    // without needing blanket group_management Editor. See
    // requireGroupAccessEditor's own doc comment.
    if (!(await requireGroupAccessEditor(req, res, id, "Editing relationship groups"))) return;
    const existing = await relationshipGroups.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Relationship group not found." });
    }

    const { name, description, active, departmentId, usedForGroupAccess } = req.body;
    const patch: {
      name?: string;
      description?: string | null;
      active?: boolean;
      departmentId?: number | null;
      usedForGroupAccess?: boolean;
    } = {};
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
    if (departmentId !== undefined) {
      if (departmentId !== null && !Number.isInteger(departmentId)) {
        return res.status(400).json({ error: "departmentId must be an integer or null." });
      }
      patch.departmentId = departmentId;
    }
    // Group Access tab's "which relationship group(s) count toward group
    // access restriction" toggle — see schema.ts's usedForGroupAccess
    // comment for why this is admin-flagged per group rather than name-
    // matched.
    if (usedForGroupAccess !== undefined) {
      if (typeof usedForGroupAccess !== "boolean") {
        return res.status(400).json({ error: "usedForGroupAccess must be a boolean." });
      }
      patch.usedForGroupAccess = usedForGroupAccess;
    }

    const row = await relationshipGroups.update(id, patch);

    try {
      const changeSummary = [
        patch.name !== undefined && patch.name !== existing.name ? `renamed to "${patch.name}"` : null,
        patch.active !== undefined && patch.active !== existing.active ? (patch.active ? "reactivated" : "deactivated") : null,
        patch.description !== undefined ? "description updated" : null,
        patch.departmentId !== undefined && patch.departmentId !== existing.departmentId ? (patch.departmentId === null ? "unlinked from its department" : "department link updated") : null,
        patch.usedForGroupAccess !== undefined && patch.usedForGroupAccess !== existing.usedForGroupAccess
          ? (patch.usedForGroupAccess ? "enabled for Group Access" : "disabled for Group Access")
          : null,
      ].filter(Boolean).join(", ");
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Relationship Group Edited",
        planName: null,
        description: `Relationship group "${existing.name}"${changeSummary ? `: ${changeSummary}.` : " updated."}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for relationship group edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A relationship group with that name already exists." });
    }
    console.error("Failed to update relationship group:", err);
    return res.status(500).json({ error: `Failed to update this relationship group: ${err.message}` });
  }
});

// Deleting a relationship group is blocked outright (not the two-step
// confirm dance org_teams/departments/roles use) whenever any mapping still
// references it — the FK is ON DELETE RESTRICT (see schema.ts), unlike
// those three catalogs' ON DELETE SET NULL, because silently widening an
// Access Rule's condition (what SET NULL risks there) has no equivalent
// here: a relationship group with no owner/subject rows left is simply
// gone, nothing "widens". Checked here for a clean error message instead
// of surfacing the raw Postgres FK-violation error.
app.delete("/api/relationship-groups/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipGroups, userRelationships, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    // Hardcoded Developer/Platform Admin-only (at the user's explicit
    // request) — deliberately NOT requireFeatureAccess("group_management",
    // "Editor", ...) like the other group routes, so an Admin-tier Custom
    // Grant on group_management can never unlock permanent deletion, only
    // the real account tier can.
    if (!isDeveloperPower(callerTier)) {
      return res.status(403).json({ error: "Only the Developer or Platform Admin role can delete relationship groups." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid relationship group id." });
    }
    const existing = await relationshipGroups.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Relationship group not found." });
    }
    const referencing = (await userRelationships.list()).filter((r) => r.relationshipGroupId === id).length;
    if (referencing > 0) {
      return res.status(409).json({
        error: `"${existing.name}" is used by ${referencing} mapping${referencing === 1 ? "" : "s"} in its roster — remove ${referencing === 1 ? "it" : "them"} first, or deactivate this group instead of deleting it.`,
      });
    }

    await relationshipGroups.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Relationship Group Deleted",
        planName: null,
        description: `Deleted relationship group "${existing.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for relationship group deletion:", logErr);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to delete relationship group:", err);
    return res.status(500).json({ error: `Failed to delete this relationship group: ${err.message}` });
  }
});

// User Relationships — explicit person-to-person mappings (e.g. a Mentor's
// mentees). Hard-deletable (see userRelationshipsRepository.ts's doc
// comment on why, unlike the catalogs above).
app.get("/api/user-relationships", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "group_management", "Viewer", "Viewing user relationships"))) return;
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
    const { users: usersRepo, relationshipGroups, userRelationships, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const { ownerEmail, subjectEmail, relationshipGroupId } = req.body;
    if (typeof ownerEmail !== "string" || !ownerEmail.trim() || typeof subjectEmail !== "string" || !subjectEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail and subjectEmail are required." });
    }
    if (ownerEmail.trim().toLowerCase() === subjectEmail.trim().toLowerCase()) {
      return res.status(400).json({ error: "A user cannot be mapped to themselves." });
    }
    if (typeof relationshipGroupId !== "number" || !Number.isInteger(relationshipGroupId)) {
      return res.status(400).json({ error: "relationshipGroupId is required." });
    }
    // Ownership-aware (2026-09h) — see requireGroupAccessEditor's doc
    // comment. Checked against the GROUP being added to, not `ownerEmail`
    // in the body (the roster's owner picker can name anyone in the pool,
    // not just the caller).
    if (!(await requireGroupAccessEditor(req, res, relationshipGroupId, "Creating user relationships"))) return;
    const [owner, subject, relGroup] = await Promise.all([
      usersRepo.findByEmail(ownerEmail.trim().toLowerCase()),
      usersRepo.findByEmail(subjectEmail.trim().toLowerCase()),
      relationshipGroups.get(relationshipGroupId),
    ]);
    if (!owner) return res.status(400).json({ error: "ownerEmail does not match an existing user." });
    if (!subject) return res.status(400).json({ error: "subjectEmail does not match an existing user." });
    if (!relGroup || !relGroup.active) return res.status(400).json({ error: "relationshipGroupId does not match an active relationship group." });

    const row = await userRelationships.create({
      ownerEmail: ownerEmail.trim(),
      subjectEmail: subjectEmail.trim(),
      relationshipGroupId,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Relationship Created",
        planName: null,
        description: `Mapped ${subject.name} (${subject.email}) to ${owner.name} (${owner.email}) as "${relGroup.name}".`,
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid relationship id." });
    }
    // Ownership-aware (2026-09h) — must look up the mapping's own group
    // FIRST (its id alone doesn't say which group it's in), then check
    // ownership of THAT group. A caller who isn't authorized (and the
    // mapping doesn't even exist) still gets the ownership-based 403 below
    // rather than a 404, same as every other route here that checks auth
    // before existence.
    const existingRelationship = await userRelationships.get(id);
    if (!existingRelationship) {
      return res.status(404).json({ error: "Relationship not found." });
    }
    if (!(await requireGroupAccessEditor(req, res, existingRelationship.relationshipGroupId, "Removing user relationships"))) return;
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

// Reassign Owner — moves an owner's entire roster within one group to a
// new owner in a single transactional operation (userRelationshipsRepository
// .reassignOwner), instead of the caller deleting and recreating every
// mapping by hand. Purely a roster-management convenience: group access
// itself never depends on who owns a group (migration 0081), so this has
// no effect on any member's actual access.
app.post("/api/relationship-groups/:groupId/reassign-owner", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipGroups, userRelationships, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const groupId = Number(req.params.groupId);
    if (!Number.isInteger(groupId)) return res.status(400).json({ error: "A valid groupId is required." });
    // Ownership-aware (2026-09h) — see requireGroupAccessEditor's doc
    // comment.
    if (!(await requireGroupAccessEditor(req, res, groupId, "Reassigning a group's roster owner"))) return;
    const group = await relationshipGroups.get(groupId);
    if (!group) return res.status(404).json({ error: "Group not found." });

    const { fromOwnerEmail, toOwnerEmail } = req.body;
    if (typeof fromOwnerEmail !== "string" || !fromOwnerEmail.trim() || typeof toOwnerEmail !== "string" || !toOwnerEmail.trim()) {
      return res.status(400).json({ error: "fromOwnerEmail and toOwnerEmail are required." });
    }
    if (fromOwnerEmail.trim().toLowerCase() === toOwnerEmail.trim().toLowerCase()) {
      return res.status(400).json({ error: "The new owner must be different from the current owner." });
    }
    const [fromUser, toUser] = await Promise.all([
      usersRepo.findByEmail(fromOwnerEmail.trim().toLowerCase()),
      usersRepo.findByEmail(toOwnerEmail.trim().toLowerCase()),
    ]);
    if (!fromUser) return res.status(400).json({ error: "fromOwnerEmail does not match an existing user." });
    if (!toUser) return res.status(400).json({ error: "toOwnerEmail does not match an existing user." });

    const { reassigned, duplicatesDropped } = await userRelationships.reassignOwner(groupId, fromOwnerEmail.trim(), toOwnerEmail.trim());
    if (reassigned === 0 && duplicatesDropped === 0) {
      return res.status(400).json({ error: `${fromUser.name} has no roster in "${group.name}" to reassign.` });
    }

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "User Relationships Reassigned",
        planName: null,
        description:
          `Reassigned ${reassigned} mapping${reassigned === 1 ? "" : "s"} in "${group.name}" from ${fromUser.name} to ${toUser.name}` +
          (duplicatesDropped > 0 ? ` (${duplicatesDropped} already existed under ${toUser.name} and were merged).` : "."),
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for owner reassignment:", logErr);
    }

    return res.json({ success: true, reassigned, duplicatesDropped });
  } catch (err: any) {
    console.error("Failed to reassign group owner:", err);
    return res.status(500).json({ error: `Failed to reassign this group's owner: ${err.message}` });
  }
});

// Group Access — 2026-09, part of Access Control Center's unified "Groups"
// tab (originally its own "Group Access" tab, renamed once from "Training
// Access" before that — same mechanism throughout, generalized beyond the
// Training Department's original trainer/trainee use case, now folded into
// the same screen as group/roster management — see GroupsManagement.tsx).
// REDESIGNED 2026-09d, at the user's explicit request, from a fail-closed
// hard ceiling into a plain additive, raise-only (featureId, level) grant
// list — see schema.ts's doc comment on `group_tool_access` and
// accessRuleEvaluator.ts's resolveAccess() for the full model. A group is
// returned here once it's been admin-flagged usedForGroupAccess=true (see
// schema.ts's comment on that column — toggled per relationship group from
// the same tab, not matched by name); its members are whoever that group's
// user_relationships rows' subjectEmail point at, and may be empty (a group
// can have its grants pre-configured before anyone's mapped to it). See
// evaluateAccess.ts's getGroupFeatureLevels for the full enforcement story
// — this section only manages the admin-facing grant list, it doesn't
// itself gate anything.
//
// PERMISSIONS ARE GROUP-LEVEL, NOT OWNER-LEVEL (migration 0081, 2026-09):
// keyed by relationshipGroupId throughout, never by ownerEmail. The "owner"
// shown per group here is display-only (who currently manages that group's
// roster) — it has no bearing on the group's access and one owner can
// manage several groups, each configured independently.
app.get("/api/group-access/groups", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "group_management", "Viewer", "Viewing group tool access"))) return;
    const { relationshipGroups, userRelationships, users: usersRepo, groupToolAccess } = createRepositories(getDb());
    const allGroups = await relationshipGroups.list();
    const flagged = allGroups.filter((g) => g.usedForGroupAccess);
    const flaggedIds = flagged.map((g) => g.id);
    const [allRelationships, allUsers, allGrants] = await Promise.all([
      userRelationships.list(),
      usersRepo.list(),
      groupToolAccess.listForGroups(flaggedIds),
    ]);
    const nameByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u.name]));
    const tierByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u.tier]));
    const relsByGroupId = new Map<number, typeof allRelationships>();
    for (const r of allRelationships) {
      if (!flagged.some((g) => g.id === r.relationshipGroupId)) continue;
      const list = relsByGroupId.get(r.relationshipGroupId) ?? [];
      list.push(r);
      relsByGroupId.set(r.relationshipGroupId, list);
    }
    const entries = flagged
      .map((g) => {
        const rels = relsByGroupId.get(g.id) ?? [];
        const ownerEmails = Array.from(new Set(rels.map((r) => r.ownerEmail.toLowerCase())));
        const memberEmails = Array.from(new Set(rels.map((r) => r.subjectEmail.toLowerCase())));
        return {
          groupId: g.id,
          groupName: g.name,
          owners: ownerEmails.map((email) => ({ email, name: nameByEmail.get(email) || email })),
          // Each member's own tier is included so the UI can show, per
          // member, which of the group's grants actually apply to them
          // (isFeatureGroupGrantableForTier() — a group can hold mixed
          // tiers, and an Admin Zone grant has zero effect on a
          // General-tier member of the same group).
          members: memberEmails.map((email) => ({ email, name: nameByEmail.get(email) || email, tier: tierByEmail.get(email) || "General" })),
          grants: allGrants
            .filter((grant) => grant.relationshipGroupId === g.id)
            .map((grant) => ({ featureId: grant.featureId, level: grant.level })),
        };
      });
    // Every flagged group is returned, even with zero members — the Groups
    // tab shows roster and grant list side by side for whichever group is
    // selected, so an admin can pre-configure a group's grants before its
    // first member is mapped, not just after.
    entries.sort((a, b) => a.groupName.localeCompare(b.groupName));
    // relationshipGroups returned too, so the tab can render its "which
    // group(s) count" checklist without a second round trip.
    return res.json({ relationshipGroups: allGroups, entries });
  } catch (err: any) {
    console.error("Failed to list groups for Group Access:", err);
    return res.status(500).json({ error: `Failed to load the Group Access tab: ${err.message}` });
  }
});

app.put("/api/group-access/:groupId", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, relationshipGroups, groupToolAccess, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const groupId = Number(req.params.groupId);
    if (!Number.isInteger(groupId)) return res.status(400).json({ error: "A valid groupId is required." });
    // Ownership-aware (2026-09h) — a group's own owner can configure its
    // Access Control (Group Access) grants without needing blanket
    // group_management Editor. See requireGroupAccessEditor's doc comment.
    if (!(await requireGroupAccessEditor(req, res, groupId, "Changing a group's tool access"))) return;

    const group = await relationshipGroups.get(groupId);
    if (!group) return res.status(404).json({ error: "Group not found." });

    // Redesigned 2026-09d: a plain array of (featureId, level) grants,
    // replacing the old flat `featureIds: string[]` ceiling — see
    // schema.ts's group_tool_access comment for the full model.
    const { grants: submittedGrants } = req.body;
    if (
      !Array.isArray(submittedGrants) ||
      !submittedGrants.every(
        (g) => g && typeof g.featureId === "string" && (g.level === "Viewer" || g.level === "Editor")
      )
    ) {
      return res.status(400).json({ error: 'grants must be an array of { featureId: string, level: "Viewer" | "Editor" }.' });
    }
    const invalid = submittedGrants.filter((g) => !GROUP_CONFIGURABLE_FEATURES.has(g.featureId));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Not a group-configurable feature: ${invalid.map((g) => g.featureId).join(", ")}.` });
    }

    await groupToolAccess.replaceForGroup(
      groupId,
      submittedGrants.map((g) => ({ featureId: g.featureId, level: g.level as "Viewer" | "Editor" })),
      `${req.user!.name} (${callerTier})`
    );

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Group Tool Access Updated",
        planName: null,
        description: `Set "${group.name}"'s access grants to: ${submittedGrants.length ? submittedGrants.map((g) => `${g.featureId} (${g.level})`).join(", ") : "(none)"}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for group tool access update:", logErr);
    }

    return res.json({ success: true, grants: submittedGrants });
  } catch (err: any) {
    console.error("Failed to update group tool access:", err);
    return res.status(500).json({ error: `Failed to save this group's tool access: ${err.message}` });
  }
});

// The signed-in caller's OWN Group Access grants — deliberately
// requireAuth-only (every signed-in user needs to resolve their own
// effective access), same posture/reasoning as GET /api/my-access-grants
// and GET /api/my-access-rules above. `featureLevels: null` means "belongs
// to no active, access-configured group at all" — see
// getGroupFeatureLevels's own doc comment. Note this map is NOT yet
// filtered to features this caller's own tier can use (isFeatureGroup
// GrantableForTier is applied by resolveAccess() itself when it reads a
// single key back out) — the client's own hasAccess() re-applies that same
// check, mirroring the server.
app.get("/api/my-group-access", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    const featureLevels = await getGroupFeatureLevels(repos, req.user!.email);
    return res.json({ featureLevels });
  } catch (err: any) {
    console.error("Failed to load caller's group access:", err);
    return res.status(500).json({ error: `Failed to load your group access: ${err.message}` });
  }
});

// Same lookup as GET /api/my-group-access above, but for an ARBITRARY
// user — added for EffectiveAccessModal.tsx's admin diagnostic view (2026-
// 09f), which previously omitted Group Access's contribution entirely since
// no route existed to fetch anyone else's group grants. Admin+Developer-
// only (same posture as GET /api/custom-access-grants and GET
// /api/access-rules, which that same modal already fetches) — a General or
// Admin-tier caller has no legitimate need to see another person's group
// grants, only their own (the self-only route above covers that). Returns
// the same raw union getGroupFeatureLevels() always returns; it's
// resolveAccess() on the client side (called with this map as
// groupFeatureLevels) that turns an absent key into a restriction for the
// target user's own tier — this route doesn't know or care what tier the
// target is.
app.get("/api/group-access/effective/:email", requireAuth, async (req, res) => {
  try {
    if (!(await requireAdminOrDeveloper(req, res, "Viewing another user's effective group access"))) return;
    const repos = createRepositories(getDb());
    const featureLevels = await getGroupFeatureLevels(repos, req.params.email);
    return res.json({ featureLevels });
  } catch (err: any) {
    console.error("Failed to load target user's group access:", err);
    return res.status(500).json({ error: `Failed to load this user's group access: ${err.message}` });
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

// A user's own MATCHING active access_rules rows — the Access Rules
// counterpart to GET /api/my-access-grants above, same reasoning
// (deliberately requireAuth-only, every signed-in user needs to resolve
// their own effective access — see App.tsx's hasAccess()). Deliberately
// pre-filtered server-side to rows that actually match this caller's own
// Team/Department/Role/Product Tags (via the same ruleMatchesCaller() the
// server-side evaluator uses), rather than returning the full admin table —
// GET /api/access-rules (the full list, with every population's rule names
// and conditions) stays Admin+Developer-only. Access Control Center Phase 3
// (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md).
app.get("/api/my-access-rules", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, accessRules } = createRepositories(getDb());
    const user = await usersRepo.findByEmail(req.user!.email);
    const caller = { orgTeamId: user?.orgTeamId, departmentId: user?.departmentId, roleId: user?.roleId, tags: user?.tags };
    const all = await accessRules.list();
    const mine = all.filter((r) => r.active && ruleMatchesCaller(r, caller));
    return res.json({ entries: mine });
  } catch (err: any) {
    console.error("Failed to load caller's access rules:", err);
    return res.status(500).json({ error: `Failed to load your access rules: ${err.message}` });
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
    // Was requireAdminOrDeveloper (a hardcoded tier check) — switched to
    // ped_suggestions Viewer (2026-09 permission architecture fix) to
    // match the PATCH routes below, which already gate on ped_suggestions
    // Editor.
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Viewer", "Viewing AI Mapping Review"))) return;
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

    let promotion: {
      promoted: boolean;
      categoryKey?: string;
      reason?: string;
      verified?: boolean;
      reverted?: boolean;
      noMappingApplied?: boolean;
      alreadyLive?: boolean;
      changeSetId?: number;
      engine?: "db";
    } = { promoted: false };
    if (MAPPING_ENGINE === "db") {
      // Authoritative path (Phase 3A): change ped_repository / ped_aliases, confirm with a
      // fresh live lookup, record an undoable change set. Never writes ped_mapping_overrides.
      try {
        const actionRepos = createRepositories(getDb());
        const deps = buildMappingActionDeps(actionRepos);
        if (status === "approved") {
          const storedResult = (existing.aiResponse as { result?: MatchOutput } | null)?.result;
          const config = await loadLookupConfig(actionRepos, existing.planName);
          if (!storedResult || !config) {
            promotion = { promoted: false, reason: "Plan configuration or cached answer unavailable.", engine: "db" };
          } else if (storedResult.match_type !== "P1" && storedResult.match_type !== "P2") {
            promotion = { promoted: false, reason: `Answer type "${storedResult.match_type}" has no specific question to generalize.`, engine: "db" };
          } else if (storedResult.matched_question === config.anyOther) {
            promotion = { promoted: false, reason: "Answer routes to this plan's general fallback, not a specific category.", engine: "db" };
          } else {
            const categoryKey = inferCategoryKeyForQuestion(config, storedResult.matched_question);
            if (!categoryKey) {
              promotion = { promoted: false, reason: "Could not confidently infer a single category from this plan's answer — assign one manually via the PED Library.", engine: "db" };
            } else {
              const r = await applyAiApproval(deps, {
                condition: existing.condition,
                planName: existing.planName,
                categoryKey,
                expectedQuestion: storedResult.matched_question,
                aiMemoryId: id,
                performedBy: reviewer,
              });
              promotion = { promoted: r.applied, verified: r.verified, categoryKey: r.categoryKey, reason: r.reason, changeSetId: r.changeSetId, alreadyLive: r.alreadyLive, engine: "db" };
            }
          }
        } else if (status === "rejected" && existing.status === "approved") {
          const r = await revertAiApproval(deps, id, reviewer);
          promotion = { promoted: false, reverted: r.reverted, verified: r.verified, noMappingApplied: r.noMappingApplied, reason: r.reason, changeSetId: r.changeSetId, engine: "db" };
        }
      } catch (err) {
        console.error("AI Mapping Review (db engine) could not complete the mapping change:", err);
        promotion = { promoted: false, reason: "The mapping change could not be completed — see server logs. Nothing was changed.", engine: "db" };
      }
    } else if (status === "approved") {
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
            ? ` — promoted to live category "${promotion.categoryKey}" for every plan${promotion.verified ? " (confirmed on a live lookup)" : ""}.`
            : promotion.reverted
            ? ` — the mapping this approval created was removed${promotion.verified ? " (confirmed on a live lookup)" : ""}.`
            : (status === "approved" || status === "rejected") && promotion.reason
            ? ` (no mapping changed: ${promotion.reason})`
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

// Audit + undo for admin mapping actions (Phase 3A). Undo reverses exactly what
// the change set recorded, refuses when the rows were edited since, and only
// reports success after a fresh live lookup confirms the mapping is gone.
app.get("/api/mapping-changes", requireAuth, async (req, res) => {
  try {
    if (!(await canViewMappingControl(req))) return res.status(403).json({ error: "Viewing mapping change history requires access to this feature." });
    const { mappingChangeSets } = createRepositories(getDb());
    const aiMemoryId = Number(req.query.aiMemoryId);
    const entries = Number.isInteger(aiMemoryId) ? await mappingChangeSets.listByAiMemory(aiMemoryId) : await mappingChangeSets.listRecent(50);
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list mapping changes:", err);
    return res.status(500).json({ error: `Failed to load mapping changes: ${err.message}` });
  }
});

app.post("/api/mapping-changes/:id/undo", requireAuth, async (req, res) => {
  try {
    if (!(await canEditMappingControl(req))) return res.status(403).json({ error: "Undoing a mapping change requires edit access to the PED Repository or Plan Management." });
    if (MAPPING_ENGINE !== "db") {
      return res.status(409).json({ error: "Mapping changes can only be undone while the database-backed mapping engine is active." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid change id." });
    const repos = createRepositories(getDb());
    const callerTier = await getCallerTier(req, repos.users);
    const performedBy = `${req.user!.name} (${callerTier})`;
    const note = typeof req.body?.note === "string" ? req.body.note : undefined;
    const existing = await repos.mappingChangeSets.get(id);
    const result =
      existing?.kind === "admin_change"
        ? await undoAdminChange(getDb(), id, performedBy, note)
        : await undoChangeSet(buildMappingActionDeps(repos), id, performedBy, note);
    try {
      await repos.changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Mapping Change Undone",
        planName: "PED Repository",
        description: result.reverted ? `Undid mapping change #${id}${"verified" in result && result.verified ? " (confirmed on a live lookup)" : ""}.` : `Could not undo mapping change #${id}: ${"reason" in result ? result.reason : ""}`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for mapping undo:", logErr);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("Failed to undo mapping change:", err);
    return res.status(500).json({ error: `Failed to undo this change: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Mapping-control Phase 3B-ii — administration of the routing pipeline (routing_rules), the category list,
// and "which rule decided this lookup". Every write goes through mappingGate (impact preview, change-control
// fields, confirmation, change set + undo); validation lives in src/server/mappingAdmin.ts. Only meaningful
// with MAPPING_ENGINE=db (the legacy engine reads none of this).
// ─────────────────────────────────────────────────────────────────────────
async function canEditMappingControl(req: any): Promise<boolean> {
  for (const feature of ["plan_scope", "ped_suggestions"]) {
    const { level } = await evaluateAccess(getDb(), req.user?.email, feature);
    if (levelAllows(level, "Editor" as AccessActionType)) return true;
  }
  return false;
}

async function canViewMappingControl(req: any): Promise<boolean> {
  for (const feature of ["plan_scope", "ped_suggestions"]) {
    const { level } = await evaluateAccess(getDb(), req.user?.email, feature);
    if (levelAllows(level, "Viewer" as AccessActionType)) return true;
  }
  return false;
}

app.get("/api/routing-rules", requireAuth, async (req, res) => {
  try {
    if (!(await canViewMappingControl(req))) return res.status(403).json({ error: "Viewing mapping rules requires access to this feature." });
    const rules = await createRepositories(getDb()).routingRules.listAll();
    return res.json({ rules: rules.map(ruleToJson), bands: STAGE_BANDS, engine: MAPPING_ENGINE });
  } catch (err: any) {
    console.error("Failed to list routing rules:", err);
    return res.status(500).json({ error: `Failed to load rules: ${err.message}` });
  }
});

app.post("/api/routing-rules/validate", requireAuth, mappingGateRateLimit, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Validating a mapping rule"))) return;
    const { stage, definition, planScope, ruleKey } = req.body ?? {};
    if (!bandFor(stage)) return res.status(400).json({ error: "Unknown stage." });
    const repos = createRepositories(getDb());
    const previous = typeof ruleKey === "string" ? await repos.routingRules.getByKey(ruleKey) : undefined;
    const errors = await validateRuleCandidate(repos, { ruleKey: typeof ruleKey === "string" ? ruleKey : "custom.__new__", stage, definition, planScope: planScope || null }, previous);
    return res.json({ ok: errors.length === 0, errors });
  } catch (err: any) {
    console.error("Rule validation failed:", err);
    return res.status(500).json({ error: `Validation failed: ${err.message}` });
  }
});

app.post("/api/routing-rules", requireAuth, mappingGateRateLimit, mappingGate("Added a routing rule"), adminWrite("plan_scope", "Adding a routing rule", (repos, req) => createRule(repos, req.body)));
app.patch("/api/routing-rules/:ruleKey", requireAuth, mappingGateRateLimit, mappingGate("Edited a routing rule"), adminWrite("plan_scope", "Editing a routing rule", (repos, req) => patchRule(repos, req.params.ruleKey, req.body)));
app.post("/api/routing-rules/:ruleKey/move", requireAuth, mappingGateRateLimit, mappingGate("Reordered a routing rule"), adminWrite("plan_scope", "Reordering a routing rule", (repos, req) => moveRule(repos, req.params.ruleKey, req.body?.direction)));
app.delete("/api/routing-rules/:ruleKey", requireAuth, mappingGateRateLimit, mappingGate("Deleted a routing rule"), adminWrite("plan_scope", "Deleting a routing rule", (repos, req) => deleteRule(repos, req.params.ruleKey)));

// ── categories ──
app.get("/api/mapping-categories", requireAuth, async (req, res) => {
  try {
    if (!(await canViewMappingControl(req))) return res.status(403).json({ error: "Viewing categories requires access to this feature." });
    return sendOp(res, await listCategories(getDb(), createRepositories(getDb())));
  } catch (err: any) {
    console.error("Failed to list categories:", err);
    return res.status(500).json({ error: `Failed to load categories: ${err.message}` });
  }
});
app.post("/api/mapping-categories", requireAuth, mappingGateRateLimit, mappingGate("Added a category"), adminWrite("plan_scope", "Adding a category", (repos, req) => createCategory(repos, req.body), false));
app.patch("/api/mapping-categories/:categoryKey", requireAuth, mappingGateRateLimit, mappingGate("Edited a category"), adminWrite("plan_scope", "Editing a category", (repos, req) => patchCategory(repos, req.params.categoryKey, req.body), false));
app.delete("/api/mapping-categories/:categoryKey", requireAuth, mappingGateRateLimit, mappingGate("Deleted a category"), adminWrite("plan_scope", "Deleting a category", (repos, req) => deleteCategory(getDb(), repos, req.params.categoryKey), false));

// ── "which rule decides this lookup?" — read-only: no AI call, no search history, no AI Memory write ──
app.post("/api/mapping-trace", requireAuth, matchLimiter, async (req, res) => {
  try {
    if (!(await canViewMappingControl(req))) return res.status(403).json({ error: "Tracing a lookup requires access to this feature." });
    if (MAPPING_ENGINE !== "db") return res.status(409).json({ error: "Lookup tracing is only available with the database-backed engine." });
    const { term, planName } = req.body ?? {};
    if (typeof term !== "string" || !term.trim() || term.length > 200 || typeof planName !== "string") return res.status(400).json({ error: "Give a condition (up to 200 characters) and a plan." });
    const repos = createRepositories(getDb());
    const config = await loadLookupConfig(repos, planName);
    if (!config) return res.status(404).json({ error: `Unknown plan "${planName}".` });
    const snapshot = await getMappingSnapshot(repos);
    return sendOp(res, await traceLookup(repos, { term: term.trim(), planName, config, snapshot, engineVersion: ENGINE_VERSION }));
  } catch (err: any) {
    console.error("Lookup trace failed:", err);
    return res.status(500).json({ error: `Trace failed: ${err.message}` });
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
    if (legacyOnlyWriteBlocked(MAPPING_ENGINE)) return res.status(410).json({ error: RETIRED_ACTION_MESSAGE, retired: true }); // LEGACY_ONLY_WRITE_GUARD
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
    if (legacyOnlyWriteBlocked(MAPPING_ENGINE)) return res.status(410).json({ error: RETIRED_ACTION_MESSAGE, retired: true }); // LEGACY_ONLY_WRITE_GUARD
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
    if (legacyOnlyWriteBlocked(MAPPING_ENGINE)) return res.status(410).json({ error: RETIRED_ACTION_MESSAGE, retired: true }); // LEGACY_ONLY_WRITE_GUARD
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
    // Was requireAdminOrDeveloper — same ped_suggestions Viewer fix as
    // /api/ai-memory above.
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Viewer", "Viewing PED aliases"))) return;
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

app.post("/api/ped-repository", requireAuth, mappingGateRateLimit, mappingGate("Added a PED to the PED Library"), async (req, res) => {
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
    await bumpMappingVersion();

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

app.patch("/api/ped-repository/:id", requireAuth, mappingGateRateLimit, mappingGate("Edited a PED in the PED Library"), async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Editing a PED"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED id." });

    const { canonicalName, categoryKey, categoryChain, status, notes } = req.body;
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

    // Phase 4 / R11 — ordered category fallback. The primary category stays in categoryKey; categoryChain holds the
    // ordered fallbacks after it. A chain only has an effect with the database-backed engine, so saving one elsewhere
    // is refused rather than silently ignored.
    let chainValue: string[] | null | undefined;
    {
      const nextPrimary = categoryKey !== undefined ? categoryValue ?? null : before.categoryKey;
      const existingChain = Array.isArray(before.categoryChain) ? (before.categoryChain as string[]) : null;
      if (categoryChain !== undefined || (categoryKey !== undefined && existingChain && existingChain.length > 0)) {
        const known = new Set((await createRepositories(getDb()).categories.list()).map((c) => c.categoryKey));
        const check = validateCategoryChain(nextPrimary, categoryChain !== undefined ? categoryChain : existingChain, known);
        if (check.ok === false) {
          return res.status(400).json({ error: categoryChain !== undefined ? check.error : `${check.error} Remove or fix the fallback categories first.` });
        }
        if (categoryChain !== undefined) {
          chainValue = check.value;
          if (chainValue && MAPPING_ENGINE !== "db") {
            return res.status(409).json({ error: "Fallback categories only take effect with the database-backed engine, so they cannot be saved here." });
          }
        }
      }
    }

    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const after = await updatePedRow(
      { pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides },
      id,
      {
        ...(canonicalName !== undefined ? { canonicalName: canonicalName.trim() } : {}),
        ...(categoryKey !== undefined ? { categoryKey: categoryValue } : {}),
        ...(chainValue !== undefined ? { categoryChain: chainValue } : {}),
        ...(statusValue !== undefined ? { status: statusValue } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      performedBy
    );
    if (!after) return res.status(404).json({ error: "PED not found." });
    await bumpMappingVersion();

    try {
      await mappingHistory.record({ pedId: id, entityType: "ped", action: "updated", previousValue: before, newValue: after, reason: null, performedBy });
    } catch (err) {
      console.error("Failed to write mapping history for PED update:", err);
    }

    const changes: string[] = [];
    if (before.canonicalName !== after.canonicalName) changes.push(`name "${before.canonicalName}" → "${after.canonicalName}"`);
    if (before.categoryKey !== after.categoryKey) changes.push(`category "${before.categoryKey || "none"}" → "${after.categoryKey || "none"}"`);
    {
      const chainText = (v: unknown) => (Array.isArray(v) && v.length ? v.join(" > ") : "none");
      if (chainText(before.categoryChain) !== chainText(after.categoryChain)) changes.push(`fallback categories "${chainText(before.categoryChain)}" → "${chainText(after.categoryChain)}"`);
    }
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

app.delete("/api/ped-repository/:id", requireAuth, mappingGateRateLimit, mappingGate("Deleted a PED from the PED Library"), async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Deleting a PED"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid PED id." });

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const deleted = await deletePedRow({ pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides }, id, performedBy);
    if (!deleted) return res.status(404).json({ error: "PED not found." });
    await bumpMappingVersion();

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

app.post("/api/ped-repository/:id/aliases", requireAuth, mappingGateRateLimit, mappingGate("Added a PED alias"), async (req, res) => {
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
    await bumpMappingVersion();

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

app.patch("/api/ped-repository/aliases/:aliasId", requireAuth, mappingGateRateLimit, mappingGate("Edited a PED alias"), async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "ped_suggestions", "Editor", "Editing a PED alias"))) return;
    const aliasId = Number(req.params.aliasId);
    if (!Number.isInteger(aliasId)) return res.status(400).json({ error: "Invalid alias id." });
    const { aliasText, isVisible, isPrimary, routingEnabled, categoryKeyOverride, fallbackCategoryKey } = req.body;
    if (routingEnabled !== undefined && typeof routingEnabled !== "boolean") {
      return res.status(400).json({ error: "routingEnabled must be a boolean." });
    }
    for (const [fieldName, value] of [["categoryKeyOverride", categoryKeyOverride], ["fallbackCategoryKey", fallbackCategoryKey]] as const) {
      if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim())) {
        return res.status(400).json({ error: `${fieldName} must be a category key or null.` });
      }
    }
    if (aliasText !== undefined && (typeof aliasText !== "string" || !aliasText.trim())) {
      return res.status(400).json({ error: "aliasText must be a non-empty string." });
    }
    if (isVisible !== undefined && typeof isVisible !== "boolean") {
      return res.status(400).json({ error: "isVisible must be a boolean." });
    }
    if (isPrimary !== undefined && isPrimary !== true) {
      return res.status(400).json({ error: "isPrimary can only be set to true here — set a different alias primary to demote this one." });
    }

    const { users: usersRepo, pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides, changeLogs, mappingHistory, categories: categoriesRepo } = createRepositories(getDb());
    const before = await pedAliases.get(aliasId);
    if (!before) return res.status(404).json({ error: "Alias not found." });

    // A category an alias control points at must exist — otherwise the lookup would silently skip it.
    const requestedCategories = [categoryKeyOverride, fallbackCategoryKey].filter((v): v is string => typeof v === "string");
    if (requestedCategories.length > 0) {
      const known = new Set((await categoriesRepo.list()).map((c) => c.categoryKey));
      const unknown = requestedCategories.filter((k) => !known.has(k));
      if (unknown.length > 0) return res.status(400).json({ error: `Unknown category: ${unknown.join(", ")}.` });
    }

    const callerTier = await getCallerTier(req, usersRepo);
    const performedBy = `${req.user!.name} (${callerTier})`;

    const after = await updateAliasRow(
      { pedRepository: pedRepositoryRepo, pedAliases, pedMappingOverrides },
      aliasId,
      { ...(aliasText !== undefined ? { aliasText: aliasText.trim() } : {}), isVisible, isPrimary, routingEnabled, categoryKeyOverride, fallbackCategoryKey },
      performedBy
    );
    if (!after) return res.status(404).json({ error: "Alias not found." });
    await bumpMappingVersion();

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

app.delete("/api/ped-repository/aliases/:aliasId", requireAuth, mappingGateRateLimit, mappingGate("Deleted a PED alias"), async (req, res) => {
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
    await bumpMappingVersion();

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
    if (MAPPING_ENGINE !== "db") await ensurePedOverridesLoaded(pedOverridesRepo);
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
    const smokeDbSource = await attachPlanPedOverrides(config, planName, smokeTestRepos, dbSource);

    const smokeSnapshot = MAPPING_ENGINE === "db" ? await getMappingSnapshot(smokeTestRepos) : null;
    const results = peds.map((ped: string) => {
      if (smokeSnapshot) {
        const { result } = runDeterministicPipeline(ped, planName, config, smokeSnapshot);
        if (!result) return { ped, resolved: false as const };
        return {
          ped,
          resolved: true as const,
          match_type: result.match_type,
          matched_question: result.matched_question,
          question_number: result.question_number,
          explanation: result.explanation,
        };
      }
      let output = classifyDeterministic(ped, planName, config, smokeDbSource);
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

app.post("/api/plan-configs", requireAuth, expensiveActionLimiter, mappingGateRateLimit, mappingGate("Added a plan"), async (req, res) => {
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

app.put("/api/plan-configs/:planName", requireAuth, expensiveActionLimiter, mappingGateRateLimit, mappingGate("Edited a plan"), async (req, res) => {
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
      try {
        await createRepositories(getDb()).planOverrides.renamePlan(planName, newPlanName);
      } catch (err) {
        console.error("Failed to carry plan-specific PED mappings over to the renamed plan:", err);
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

app.delete("/api/plan-configs/:planName", requireAuth, mappingGateRateLimit, mappingGate("Removed a plan"), async (req, res) => {
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
    // Was requireAdminOrDeveloper (a hardcoded tier check) — switched to
    // plan_scope Viewer (2026-09 permission architecture fix) so this
    // matches the POST/PATCH/DELETE routes below, which already gate on
    // plan_scope Editor. Without this, a Custom Grant/Access Rule raising a
    // non-Admin/Developer user to plan_scope Editor could add/edit/delete a
    // restriction but never see the plan's existing ones first.
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Viewer", "Viewing Plan-Specific Restrictions"))) return;
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

app.post("/api/plan-restrictions/:planName", requireAuth, mappingGateRateLimit, mappingGate("Added a plan restriction"), async (req, res) => {
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

app.patch("/api/plan-restrictions/:id", requireAuth, mappingGateRateLimit, mappingGate("Edited a plan restriction"), async (req, res) => {
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

app.delete("/api/plan-restrictions/:id", requireAuth, mappingGateRateLimit, mappingGate("Deleted a plan restriction"), async (req, res) => {
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

// ─────────────────────────────────────────────────────────────────────────
// Plan-Specific PED Mappings — admin-authored `plan_overrides` rows that pin
// one PED to an exact question on one plan (e.g. Obstructive Sleep Apnea →
// Optima Secure's "Sleep disorder" question while every other plan keeps
// routing it by its Respiratory category). Evaluated FIRST by engine.ts's
// applyPlanPedOverride, ahead of every category mapping. Writes take effect
// for every user on their next lookup: /api/match re-reads these rows per
// request (attachPlanPedOverrides) and the client fast path re-fetches
// GET /api/plan-ped-overrides before each lookup.
// ─────────────────────────────────────────────────────────────────────────

// Every override across every plan, in the engine's shape — readable by
// every signed-in user (same reasoning as GET /api/plan-restrictions: the
// client-side deterministic path must classify identically to /api/match).
app.get("/api/plan-ped-overrides", requireAuth, async (req, res) => {
  try {
    const { planOverrides } = createRepositories(getDb());
    const rows = await planOverrides.listDetailed();
    const overridesByPlan: Record<string, ReturnType<typeof toPlanPedOverrides>> = {};
    for (const row of rows) {
      overridesByPlan[row.planName] = overridesByPlan[row.planName] || [];
      overridesByPlan[row.planName].push(...toPlanPedOverrides([row]));
    }
    return res.json({ overridesByPlan });
  } catch (err: any) {
    console.error("Failed to list plan-specific PED mappings:", err);
    return res.status(500).json({ error: `Failed to load plan-specific PED mappings: ${err.message}` });
  }
});

app.get("/api/plan-ped-overrides/:planName", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Viewer", "Viewing Plan-Specific PED Mappings"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const { planOverrides } = createRepositories(getDb());
    const entries = await planOverrides.listDetailed(planName);
    entries.sort((a, b) => a.pedName.localeCompare(b.pedName));
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list plan-specific PED mappings for plan:", err);
    return res.status(500).json({ error: `Failed to load PED mappings for this plan: ${err.message}` });
  }
});

// PED picker for the editor — matches aliases/abbreviations too ("osa").
app.get("/api/plan-ped-overrides-ped-search", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Viewer", "Searching PEDs for a Plan-Specific PED Mapping"))) return;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.json({ entries: [] });
    const { pedRepository: pedRepositoryRepo } = createRepositories(getDb());
    const rows = await pedRepositoryRepo.searchByNameOrAlias(q);
    return res.json({ entries: rows.map((r) => ({ id: r.id, pedCode: r.pedCode, canonicalName: r.canonicalName, categoryKey: r.categoryKey, status: r.status })) });
  } catch (err: any) {
    console.error("Failed to search PEDs for plan mapping:", err);
    return res.status(500).json({ error: `Failed to search PEDs: ${err.message}` });
  }
});

/** The plan's live question list (DB row first, hardcoded seed otherwise) —
 * same resolution order as /api/match, used to reject a target question
 * that doesn't exist on the plan. */
async function resolvePlanQuestionsForOverride(planName: string): Promise<string[] | null> {
  const { planConfigs } = createRepositories(getDb());
  const dbPlan = await planConfigs.get(planName);
  const config = dbPlan ? dbRowToPlanConfig(dbPlan) : getPlanConfig()[planName];
  if (!config) return null;
  return Array.from(new Set([...(config.questions || []), config.anyOther].filter(Boolean)));
}

app.put("/api/plan-ped-overrides/:planName/:pedId", requireAuth, mappingGateRateLimit, mappingGate("Set a plan-specific PED mapping"), async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Saving a Plan-Specific PED Mapping"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const pedId = Number(req.params.pedId);
    if (!Number.isInteger(pedId)) return res.status(400).json({ error: "Invalid PED id." });
    const targetQuestion = typeof req.body?.targetQuestion === "string" ? req.body.targetQuestion.trim() : "";
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null;
    if (!targetQuestion) return res.status(400).json({ error: "targetQuestion is required." });

    const planQuestions = await resolvePlanQuestionsForOverride(planName);
    if (!planQuestions) return res.status(404).json({ error: `Plan '${planName}' not found.` });
    const exactQuestion = planQuestions.find((q) => q.trim() === targetQuestion);
    if (!exactQuestion) return res.status(400).json({ error: "That question doesn't exist on this plan." });

    const repos = createRepositories(getDb());
    const ped = await repos.pedRepository.get(pedId);
    if (!ped) return res.status(404).json({ error: "PED not found." });

    const callerTier = await getCallerTier(req, repos.users);
    const existing = await repos.planOverrides.get(planName, pedId);
    const row = await repos.planOverrides.upsert({
      planName,
      pedId,
      categoryKey: null,
      targetQuestion: exactQuestion,
      reason,
      addedBy: `${req.user!.name} (${callerTier})`,
    });
    updateDbPlanOverrideCache(planName, pedId, null, reason);

    try {
      await repos.changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: existing ? "Plan PED Mapping Edited" : "Plan PED Mapping Created",
        planName,
        description: `Mapped "${ped.canonicalName}" (${ped.pedCode}) to "${exactQuestion}" on ${planName}${existing ? " (replacing the previous plan-specific mapping)" : ""}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for plan PED mapping:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to save plan-specific PED mapping:", err);
    return res.status(500).json({ error: `Failed to save this mapping: ${err.message}` });
  }
});

app.delete("/api/plan-ped-overrides/:planName/:pedId", requireAuth, mappingGateRateLimit, mappingGate("Removed a plan-specific PED mapping"), async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "plan_scope", "Editor", "Deleting a Plan-Specific PED Mapping"))) return;
    const planName = decodeURIComponent(req.params.planName);
    const pedId = Number(req.params.pedId);
    if (!Number.isInteger(pedId)) return res.status(400).json({ error: "Invalid PED id." });
    const repos = createRepositories(getDb());
    const existing = await repos.planOverrides.get(planName, pedId);
    if (!existing) return res.status(404).json({ error: "Mapping not found." });
    await repos.planOverrides.delete(planName, pedId);
    removeDbPlanOverrideCache(planName, pedId);

    try {
      const callerTier = await getCallerTier(req, repos.users);
      const ped = await repos.pedRepository.get(pedId);
      await repos.changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Plan PED Mapping Deleted",
        planName,
        description: `Removed the plan-specific mapping for "${ped?.canonicalName ?? `PED #${pedId}`}" on ${planName} — it now follows its normal category mapping.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for plan PED mapping deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Failed to delete plan-specific PED mapping:", err);
    return res.status(500).json({ error: `Failed to delete this mapping: ${err.message}` });
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
    let usedModel: string = modelsToTry[0];
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
        usedModel = model;
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`[Specific Illness AI Check] Attempt failed with model ${model}:`, err?.message || err);
      }
    }
    if (!response) {
      throw lastError || new Error("Failed to get a response from Gemini.");
    }

    // Cross-feature usage tracking (2026-09, visibility only — see
    // ai_usage_log's schema.ts comment). Fire-and-forget — a failure here
    // must never affect the advisor's AI check, which has already succeeded
    // above.
    void createRepositories(getDb())
      .aiUsageLog.record({
        source: "specific_illness_ai_check",
        userEmail: req.user!.email,
        model: usedModel,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        label: condition.slice(0, 200),
      })
      .catch((err: unknown) => console.error("AI usage log: failed to record Specific Illness AI check entry (non-fatal):", err));

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
    // Was requireAdminOrDeveloper (a hardcoded tier check) — switched to
    // flagged_responses Viewer (2026-09 permission architecture fix) to
    // match the PUT route below, which already gates on flagged_responses
    // Editor.
    if (!(await requireFeatureAccess(req, res, "flagged_responses", "Viewer", "Viewing flagged responses"))) return;
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
    if (!team) return res.status(400).json({ error: "That business unit doesn't exist." });
    if (!role) return res.status(400).json({ error: "That role doesn't exist." });

    const email = req.user!.email.toLowerCase();
    const existing = await usersRepo.findByEmail(email);
    // A row with a blank TACT ID is a pre-provisioned account (see POST
    // /api/users/bulk-provision above) — its Business Unit/Department/Role/
    // Tier/Product Tag were already decided by whoever bulk-added it, and
    // this request is that same person completing it with just their own
    // name + TACT ID, not creating a brand-new row. A row that already has
    // a TACT ID is genuinely already set up, and still 409s exactly as
    // before.
    if (existing && existing.tactId) {
      return res.status(409).json({ error: "This account is already set up. Please refresh and sign in again." });
    }

    const newUser = existing
      ? await usersRepo.updateUser(email, {
          name: name.trim(),
          tactId: normalizedTactId,
          tags: resolvedTags,
          departmentId,
          orgTeamId,
          roleId,
          // Deliberately NOT touching `tier` — a pre-provisioned row's tier
          // was set by whoever bulk-added it (Admin/Developer); this
          // self-service completion must never let someone grant/change
          // their own tier, same boundary the brand-new-row path below
          // enforces by always hardcoding "General".
        })
      : await usersRepo.create({
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
    // Only reachable if the pre-provisioned row was deleted between the
    // findByEmail check above and this update — vanishingly unlikely, but
    // updateUser()'s return type is UserRow | undefined, so this keeps the
    // response honest instead of silently sending `user: undefined`.
    if (!newUser) {
      return res.status(404).json({ error: "Your pre-provisioned account could not be found. Please contact an admin." });
    }
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Connecting Google Sheets"))) return;
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
    if (!row) return res.json({ connected: false, sheetUrl });
    // "connected" here means a grant is STORED — it does not by itself mean
    // the grant still works (a revoked/expired refresh token, a Testing-mode
    // OAuth consent screen, etc. all leave the row in place). `resource`
    // below reports the real, passively-tracked outcome of the last actual
    // Sheets read this app made (see sheetsClient.ts's getQaSheetsHealth) —
    // same shape ConnectionRowCard.tsx already reads from the Playbook/FAQ/
    // Term FAQ connections, so a broken grant shows as "Attention" here too,
    // not a false "Connected".
    const health = getQaSheetsHealth();
    const resource = health.lastSuccessAt || health.lastErrorAt
      ? {
          status: health.lastErrorAt && (!health.lastSuccessAt || health.lastErrorAt > health.lastSuccessAt) ? ("error" as const) : ("active" as const),
          lastFetchedAt: (health.lastSuccessAt ?? health.lastErrorAt)!.toISOString(),
          errorMessage: health.lastErrorAt && (!health.lastSuccessAt || health.lastErrorAt > health.lastSuccessAt) ? health.lastErrorMessage : null,
        }
      : null;
    return res.json({ connected: true, connectedEmail: row.connectedEmail, connectedAt: row.connectedAt, sheetUrl, resource });
  } catch (err: any) {
    console.error("QA Dashboard: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${err.message}` });
  }
});

app.delete("/api/qa-dashboard/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Disconnecting Google Sheets"))) return;
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Syncing the Advisor Directory"))) return;
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
          // Full structured result (not just the description string above) so
          // GET /api/qa-dashboard/advisor-directory-sync/last-run can show the
          // Connections page's real last-run stats after a page reload,
          // instead of only ever knowing about a sync run in THIS browser
          // session — see that route below.
          snapshot: result,
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

// Real last-run info for the Connections page — reads the most recent
// successful sync's full structured result back out of change_logs.snapshot
// (see the POST route above), rather than relying on in-session React state
// that resets to "not yet synced" on every page reload/refresh even though a
// sync genuinely ran earlier. A failed run (result.errors.length > 0) is
// deliberately never change-logged (see the POST route above), so this only
// ever reports the last run that actually completed cleanly.
app.get("/api/qa-dashboard/advisor-directory-sync/last-run", requireAuth, async (req, res) => {
  try {
    const { changeLogs } = createRepositories(getDb());
    const [entry] = await changeLogs.list({ actionType: "Advisor Directory Synced", limit: 1 });
    if (!entry) return res.json({ result: null });
    return res.json({ result: entry.snapshot ?? null, syncedAt: entry.timestamp });
  } catch (err: any) {
    console.error("Failed to load the last Advisor Directory Sync run:", err);
    return res.status(500).json({ error: `Failed to load: ${err.message}` });
  }
});

// --- Guide/Mentor -> Advisor Relationship Mappings (2026-09) — Access
// Control Center's Relationships tab. See guideMentorRelationshipsSync.ts's
// header comment: mirrors master_advisors' Guide/Mentor columns into
// guide_mentor_advisor_mappings, same "Admin/Developer can view, Developer+
// Platform Admin can edit" posture as the Relationship Types/User
// Relationships routes above, plus a sync trigger gated like Advisor
// Directory Sync (a directory-wide write action against Google Sheets
// data). ---
app.get("/api/relationship-mappings/guide-mentor-advisors", requireAuth, async (req, res) => {
  try {
    // Corrected 2026-09 alongside the PATCH/DELETE routes below — Viewer
    // level on "master_advisors", not a hardcoded Admin-power check, so a
    // Permissions-tab/override/grant change actually takes effect for
    // viewing too.
    if (!(await requireFeatureAccess(req, res, "master_advisors", "Viewer", "Viewing Guide/Mentor advisor mappings"))) return;
    const { guideMentorAdvisorMappings } = createRepositories(getDb());
    const rows = await guideMentorAdvisorMappings.list();
    return res.json({ entries: rows });
  } catch (err: any) {
    console.error("Failed to list Guide/Mentor advisor mappings:", err);
    return res.status(500).json({ error: `Failed to load Guide/Mentor advisor mappings: ${err.message}` });
  }
});

app.post("/api/relationship-mappings/guide-mentor-advisors/sync", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Syncing Guide/Mentor advisor mappings"))) return;
    const repos = createRepositories(getDb());
    const callerTier = await getCallerTier(req, repos.users);
    const { changeLogs } = repos;
    const result = await syncGuideMentorRelationships(repos, `${req.user!.name} (${callerTier})`);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Guide/Mentor Advisor Mappings Synced",
        planName: null,
        description:
          `Guide/Mentor Advisor Mapping Sync: ${result.recordsRead} record(s) read, ${result.mappingsWritten} mapped ` +
          `(${result.withGuide} Guide only, ${result.withMentor} Mentor only, ${result.withBoth} both, ${result.withNeither} neither), ` +
          `${result.skippedNoTactId} skipped (no Tact ID).`,
        // Full structured result so GET .../last-run can show it after a
        // page reload — same reasoning as Advisor Directory Sync's own
        // last-run route.
        snapshot: result,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Guide/Mentor Advisor Mapping Sync:", logErr);
    }

    return res.json(result);
  } catch (err: any) {
    console.error("Guide/Mentor Advisor Mapping Sync failed:", err);
    return res.status(500).json({ error: `Guide/Mentor Advisor Mapping Sync failed: ${err.message}` });
  }
});

app.get("/api/relationship-mappings/guide-mentor-advisors/last-run", requireAuth, async (req, res) => {
  try {
    const { changeLogs } = createRepositories(getDb());
    const [entry] = await changeLogs.list({ actionType: "Guide/Mentor Advisor Mappings Synced", limit: 1 });
    if (!entry) return res.json({ result: null });
    return res.json({ result: entry.snapshot ?? null, syncedAt: entry.timestamp });
  } catch (err: any) {
    console.error("Failed to load the last Guide/Mentor Advisor Mapping Sync run:", err);
    return res.status(500).json({ error: `Failed to load: ${err.message}` });
  }
});

// Per-advisor Mentor/Guide relationship timeline — see
// guide_mentor_relationship_history's schema.ts comment. Same view
// permission as the list route above (Admin+); id is the
// guide_mentor_advisor_mappings row id, resolved to a tact_id here so the
// client doesn't need to know that table's internal keying.
app.get("/api/relationship-mappings/guide-mentor-advisors/:id/history", requireAuth, async (req, res) => {
  try {
    // See the list route's comment above — same correction.
    if (!(await requireFeatureAccess(req, res, "master_advisors", "Viewer", "Viewing a Guide/Mentor relationship history"))) return;
    const { guideMentorAdvisorMappings, guideMentorRelationshipHistory } = createRepositories(getDb());
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid mapping id." });
    }
    const mapping = await guideMentorAdvisorMappings.get(id);
    if (!mapping) {
      return res.status(404).json({ error: "Mapping not found." });
    }
    const rows = await guideMentorRelationshipHistory.listForAdvisor(mapping.tactId);
    return res.json({
      guide: rows.filter((r) => r.kind === "guide"),
      mentor: rows.filter((r) => r.kind === "mentor"),
    });
  } catch (err: any) {
    console.error("Failed to load Guide/Mentor relationship history:", err);
    return res.status(500).json({ error: `Failed to load relationship history: ${err.message}` });
  }
});

app.patch("/api/relationship-mappings/guide-mentor-advisors/:id", requireAuth, async (req, res) => {
  try {
    // Corrected 2026-09 (permission architecture fix): was a hardcoded
    // isDeveloperPower-only gate that ignored the "master_advisors"
    // featurePermissions entry and any Custom Grant for it entirely — an
    // Admin explicitly granted Editor here could never actually use it.
    // Centralized like every other governed content-management route.
    if (!(await requireFeatureAccess(req, res, "master_advisors", "Editor", "Editing Guide/Mentor advisor mappings"))) return;
    const { users: usersRepo, guideMentorAdvisorMappings, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid mapping id." });
    }
    const existing = await guideMentorAdvisorMappings.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Mapping not found." });
    }

    const { name, guideName, mentorName, status, skillDomain, batchNumber, dateOfMovingOut, lastWorkingDay, guideEffectiveDate, mentorEffectiveDate } = req.body;
    const patch: {
      name?: string;
      guideName?: string | null;
      mentorName?: string | null;
      status?: string | null;
      skillDomain?: string | null;
      batchNumber?: string | null;
      dateOfMovingOut?: string | null;
      lastWorkingDay?: string | null;
      guideEffectiveDate?: string;
      mentorEffectiveDate?: string;
    } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty." });
      }
      patch.name = name.trim();
    }
    if (guideName !== undefined) patch.guideName = typeof guideName === "string" ? guideName.trim() || null : null;
    if (mentorName !== undefined) patch.mentorName = typeof mentorName === "string" ? mentorName.trim() || null : null;
    if (status !== undefined) patch.status = typeof status === "string" ? status.trim() || null : null;
    if (skillDomain !== undefined) patch.skillDomain = typeof skillDomain === "string" ? skillDomain.trim() || null : null;
    if (batchNumber !== undefined) patch.batchNumber = typeof batchNumber === "string" ? batchNumber.trim() || null : null;
    if (dateOfMovingOut !== undefined) patch.dateOfMovingOut = typeof dateOfMovingOut === "string" ? dateOfMovingOut.trim() || null : null;
    if (lastWorkingDay !== undefined) patch.lastWorkingDay = typeof lastWorkingDay === "string" ? lastWorkingDay.trim() || null : null;
    // Effective date for a Mentor/Guide relationship CHANGE recorded into
    // guide_mentor_relationship_history — distinct from the advisor-level
    // dateOfMovingOut/lastWorkingDay above (see that table's schema.ts
    // comment). Ignored by the repository unless the matching guideName/
    // mentorName field is also present in this patch.
    if (typeof guideEffectiveDate === "string" && guideEffectiveDate.trim()) patch.guideEffectiveDate = guideEffectiveDate.trim();
    if (typeof mentorEffectiveDate === "string" && mentorEffectiveDate.trim()) patch.mentorEffectiveDate = mentorEffectiveDate.trim();

    const row = await guideMentorAdvisorMappings.update(id, patch, `${req.user!.name} (${callerTier})`);
    // QA Dashboard/Team Tracker cache this same data (advisorSnapshotCache
    // in qaDataEngine.ts) for up to SHEET_CACHE_TTL_MS — invalidate so a
    // Mentor/Guide/Active Till edit here is reflected immediately rather
    // than waiting out that TTL. See "Rewire Advisor Mapping" project memory.
    invalidateQaSheetCache();

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Guide/Mentor Advisor Mapping Edited",
        planName: null,
        description: `Edited the Guide/Mentor mapping for "${existing.name}" (Tact ID ${existing.tactId}).`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Guide/Mentor advisor mapping edit:", logErr);
    }

    return res.json({ entry: row });
  } catch (err: any) {
    console.error("Failed to update Guide/Mentor advisor mapping:", err);
    return res.status(500).json({ error: `Failed to update this mapping: ${err.message}` });
  }
});

app.delete("/api/relationship-mappings/guide-mentor-advisors/:id", requireAuth, async (req, res) => {
  try {
    // See the PATCH route's comment above — same 2026-09 correction.
    if (!(await requireFeatureAccess(req, res, "master_advisors", "Editor", "Removing Guide/Mentor advisor mappings"))) return;
    const { users: usersRepo, guideMentorAdvisorMappings, changeLogs } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid mapping id." });
    }
    const existing = await guideMentorAdvisorMappings.get(id);
    await guideMentorAdvisorMappings.delete(id);
    invalidateQaSheetCache(); // see the PATCH route's comment above

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Guide/Mentor Advisor Mapping Removed",
        planName: null,
        description: existing ? `Removed the Guide/Mentor mapping for "${existing.name}" (Tact ID ${existing.tactId}).` : `Removed Guide/Mentor advisor mapping #${id}.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Guide/Mentor advisor mapping removal:", logErr);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Failed to remove Guide/Mentor advisor mapping:", err);
    return res.status(500).json({ error: `Failed to remove this mapping: ${err.message}` });
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Connecting Google Sheets"))) return;
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
    if (!row) return res.json({ connected: false, pendingCount, sheetUrl });
    // Same "a stored grant isn't proof it still works" reasoning as the QA
    // Dashboard route above — resource reflects the real outcome of the
    // last actual export attempt (see productAssistLogSheetsClient.ts's
    // getProductAssistLogExportHealth), not just row presence.
    const health = getProductAssistLogExportHealth();
    const resource = health.lastSuccessAt || health.lastErrorAt
      ? {
          status: health.lastErrorAt && (!health.lastSuccessAt || health.lastErrorAt > health.lastSuccessAt) ? ("error" as const) : ("active" as const),
          lastFetchedAt: (health.lastSuccessAt ?? health.lastErrorAt)!.toISOString(),
          errorMessage: health.lastErrorAt && (!health.lastSuccessAt || health.lastErrorAt > health.lastSuccessAt) ? health.lastErrorMessage : null,
        }
      : null;
    return res.json({ connected: true, connectedEmail: row.connectedEmail, connectedAt: row.connectedAt, pendingCount, sheetUrl, resource });
  } catch (err: any) {
    console.error("Product Assist Log Export: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${describeDbError(err)}` });
  }
});

app.delete("/api/product-assist-logs/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Disconnecting Google Sheets"))) return;
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
      if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Exporting Product Assist logs"))) return;
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

// --- Team QA Performance Tracker ("Team Tracker") ---
// Separate, additive page — reuses qaDataEngine.ts's existing scoring math
// (getAdvisorsBatchMetrics, same function the QA Dashboard's own roster
// view calls) via teamTrackerService.ts, which does not modify
// qaDashboardService.ts or qaDataEngine.ts. Admin/Guide/Mentor only (no
// plain-Advisor "own record" view here, unlike the QA Dashboard) — see
// teamTrackerService.ts's header comment.

app.get("/api/qa-dashboard/team-tracker/context", requireAuth, async (req, res) => {
  try {
    const guide = typeof req.query.guide === "string" && req.query.guide.trim() ? req.query.guide.trim() : null;
    const mentor = typeof req.query.mentor === "string" && req.query.mentor.trim() ? req.query.mentor.trim() : null;
    const result = await getTeamTrackerContext(req.user!.email, guide, mentor);
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to load context:", err);
    return res.status(500).json({ error: `Failed to load Team Tracker: ${err.message}` });
  }
});

app.get("/api/qa-dashboard/team-tracker/table", requireAuth, async (req, res) => {
  try {
    const guide = typeof req.query.guide === "string" && req.query.guide.trim() ? req.query.guide.trim() : null;
    const mentor = typeof req.query.mentor === "string" && req.query.mentor.trim() ? req.query.mentor.trim() : null;
    const tactId = typeof req.query.tactId === "string" && req.query.tactId.trim() ? req.query.tactId.trim() : null;
    const fromYm = typeof req.query.fromMonth === "string" ? req.query.fromMonth.trim() : "";
    const toYm = typeof req.query.toMonth === "string" ? req.query.toMonth.trim() : "";
    if (!/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) {
      return res.status(400).json({ error: "fromMonth and toMonth (yyyy-MM) are required." });
    }
    const result = await getTeamTrackerTable(req.user!.email, guide, mentor, tactId, fromYm, toYm);
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to load table:", err);
    return res.status(500).json({ error: `Failed to load Team Tracker table: ${err.message}` });
  }
});

// "QA Performance" tiles/rankings for a period view — one getAdvisorsBatchMetrics
// call over the actual [fromMonth, toMonth] date range (Start/End/Till Date),
// instead of /table's per-month averages. See teamTrackerService.ts's
// getTeamTrackerPeriodSummary header comment.
app.get("/api/qa-dashboard/team-tracker/period-summary", requireAuth, async (req, res) => {
  try {
    const guide = typeof req.query.guide === "string" && req.query.guide.trim() ? req.query.guide.trim() : null;
    const mentor = typeof req.query.mentor === "string" && req.query.mentor.trim() ? req.query.mentor.trim() : null;
    const fromYm = typeof req.query.fromMonth === "string" ? req.query.fromMonth.trim() : "";
    const toYm = typeof req.query.toMonth === "string" ? req.query.toMonth.trim() : "";
    if (!/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) {
      return res.status(400).json({ error: "fromMonth and toMonth (yyyy-MM) are required." });
    }
    const result = await getTeamTrackerPeriodSummary(req.user!.email, guide, mentor, fromYm, toYm);
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to load period summary:", err);
    return res.status(500).json({ error: `Failed to load Team Tracker period summary: ${err.message}` });
  }
});

// Team Tracker Home Page's "Current Month Analysis" — Period Change card.
// Separate from /table because it needs its own day-of-month-clamped
// queries per prior month (see teamTrackerService.ts's
// getCurrentMonthPeriodChange header comment) rather than the full-month
// data /table already returns. currentMonthKey ("yyyy-MM") is the client's
// own already-computed "latest scored month within the loaded period" —
// passed in rather than re-derived here so the two endpoints never
// disagree on which month is "current."
app.get("/api/qa-dashboard/team-tracker/current-month-period-change", requireAuth, async (req, res) => {
  try {
    const guide = typeof req.query.guide === "string" && req.query.guide.trim() ? req.query.guide.trim() : null;
    const mentor = typeof req.query.mentor === "string" && req.query.mentor.trim() ? req.query.mentor.trim() : null;
    const fromYm = typeof req.query.fromMonth === "string" ? req.query.fromMonth.trim() : "";
    const toYm = typeof req.query.toMonth === "string" ? req.query.toMonth.trim() : "";
    const currentMonthKey = typeof req.query.currentMonthKey === "string" ? req.query.currentMonthKey.trim() : "";
    if (!/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) {
      return res.status(400).json({ error: "fromMonth and toMonth (yyyy-MM) are required." });
    }
    const result = await getCurrentMonthPeriodChange(req.user!.email, guide, mentor, fromYm, toYm, currentMonthKey);
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to load current-month period change:", err);
    return res.status(500).json({ error: `Failed to load current-month period change: ${err.message}` });
  }
});

// --- Team Tracker: Coaching Workspace ---
// Access control reuses teamTrackerService.ts's own Guide/Mentor/Admin
// scope (see canAccessAdvisorForCoaching) via coachingService.ts — same
// "no plain-Advisor access" rule as the rest of Team Tracker. A session is
// only ever written on an explicit Save from the client; there is no
// autosave route (drafts live in the browser's own localStorage).

app.post("/api/qa-dashboard/team-tracker/coaching/sessions", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const actionables = Array.isArray(body.actionables)
      ? body.actionables.map((a: any) => ({
          description: typeof a?.description === "string" ? a.description : "",
          dueDate: typeof a?.dueDate === "string" && a.dueDate ? a.dueDate : null,
          status: a?.status === "In Progress" || a?.status === "Completed" ? a.status : "Open",
        }))
      : [];
    const result = await saveCoachingSession(req.user!.email, {
      tactId: typeof body.tactId === "string" ? body.tactId : "",
      meetingDate: typeof body.meetingDate === "string" ? body.meetingDate : "",
      discussionPoints: typeof body.discussionPoints === "string" ? body.discussionPoints : "",
      meetingNotes: typeof body.meetingNotes === "string" ? body.meetingNotes : "",
      actionables,
    });
    if (result && typeof result === "object" && "error" in result) {
      const status = result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : result.error === "INVALID_INPUT" ? 400 : 500;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to save coaching session:", err);
    return res.status(500).json({ error: `Failed to save coaching session: ${err.message}` });
  }
});

// Edit option for saved session feedback (Task 7 — previously only an
// actionable's status could be changed after Save, never the session's own
// discussion points / meeting notes / actionable list).
app.patch("/api/qa-dashboard/team-tracker/coaching/sessions/:id", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const body = req.body || {};
    const actionables = Array.isArray(body.actionables)
      ? body.actionables.map((a: any) => ({
          id: Number.isFinite(Number(a?.id)) && a?.id != null ? Number(a.id) : undefined,
          description: typeof a?.description === "string" ? a.description : "",
          dueDate: typeof a?.dueDate === "string" && a.dueDate ? a.dueDate : null,
          status: a?.status === "In Progress" || a?.status === "Completed" || a?.status === "Failed" ? a.status : "Open",
        }))
      : [];
    const result = await updateCoachingSession(req.user!.email, sessionId, {
      meetingDate: typeof body.meetingDate === "string" ? body.meetingDate : "",
      discussionPoints: typeof body.discussionPoints === "string" ? body.discussionPoints : "",
      meetingNotes: typeof body.meetingNotes === "string" ? body.meetingNotes : "",
      actionables,
    });
    if (result && typeof result === "object" && "error" in result) {
      const status = result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : result.error === "INVALID_INPUT" ? 400 : 500;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to update coaching session:", err);
    return res.status(500).json({ error: `Failed to update coaching session: ${err.message}` });
  }
});

app.get("/api/qa-dashboard/team-tracker/coaching/history", requireAuth, async (req, res) => {
  try {
    const tactId = typeof req.query.tactId === "string" ? req.query.tactId : "";
    const result = await getCoachingHistory(req.user!.email, tactId);
    if (!Array.isArray(result) && result && typeof result === "object" && "error" in result) {
      const status = result.error === "FORBIDDEN" ? 403 : result.error === "INVALID_INPUT" ? 400 : 500;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to load coaching history:", err);
    return res.status(500).json({ error: `Failed to load coaching history: ${err.message}` });
  }
});

// Feedback Summary's own status control (Advisor QA Dashboard) — moves one
// actionable along Open -> In Progress -> Completed/Failed. New
// actionables from the Session Feedback form always start "Open"; this is
// the only route that changes status after that.
app.patch("/api/qa-dashboard/team-tracker/coaching/actionables/:id/status", requireAuth, async (req, res) => {
  try {
    const actionableId = Number(req.params.id);
    const status = req.body?.status;
    if (status !== "Open" && status !== "In Progress" && status !== "Completed" && status !== "Failed") {
      return res.status(400).json({ error: "INVALID_INPUT", message: "status must be one of Open, In Progress, Completed, Failed" });
    }
    const result = await updateActionableStatus(req.user!.email, actionableId, status);
    if (result && typeof result === "object" && "error" in result) {
      const httpStatus = result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : result.error === "INVALID_INPUT" ? 400 : 500;
      return res.status(httpStatus).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("QA Dashboard: failed to update actionable status:", err);
    return res.status(500).json({ error: `Failed to update actionable status: ${err.message}` });
  }
});

// QA Feedback's "Mark as Discussed" checkbox (Advisor Insight Page) —
// backend-persisted so the mark is the same for every Guide/Mentor/Admin
// who opens that advisor, not per-browser localStorage.
app.get("/api/qa-dashboard/team-tracker/feedback-discussed", requireAuth, async (req, res) => {
  try {
    const tactId = typeof req.query.tactId === "string" ? req.query.tactId : "";
    const result = await listDiscussedFeedback(req.user!.email, tactId);
    if (!Array.isArray(result) && result && typeof result === "object" && "error" in result) {
      const status = result.error === "FORBIDDEN" ? 403 : result.error === "INVALID_INPUT" ? 400 : 500;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to load discussed feedback marks:", err);
    return res.status(500).json({ error: `Failed to load discussed feedback marks: ${err.message}` });
  }
});

app.put("/api/qa-dashboard/team-tracker/feedback-discussed", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const tactId = typeof body.tactId === "string" ? body.tactId : "";
    const rowIdentity = typeof body.rowIdentity === "string" ? body.rowIdentity : "";
    const discussed = Boolean(body.discussed);
    const result = await setFeedbackDiscussed(req.user!.email, tactId, rowIdentity, discussed);
    if (result && typeof result === "object" && "error" in result) {
      const status = result.error === "FORBIDDEN" ? 403 : result.error === "INVALID_INPUT" ? 400 : 500;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("Team Tracker: failed to update discussed feedback mark:", err);
    return res.status(500).json({ error: `Failed to update discussed feedback mark: ${err.message}` });
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Connecting Google Sheets"))) return;
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Disconnecting Google Sheets"))) return;
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Resyncing the Product Playbook"))) return;
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
      previousPlanFactCount: result.previousPlanFactCount,
      previousNarrativeChunkCount: result.previousNarrativeChunkCount,
      plansAdded: result.plansAdded,
      plansRemoved: result.plansRemoved,
      plansChanged: result.plansChanged,
      plansUnchanged: result.plansUnchanged,
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Connecting Google Sheets"))) return;
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
    const resource = (await kbResources.list({})).find(r => r.type === "sheet" && r.title === FAQ_DITTO_RESOURCE_TITLE);
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Disconnecting Google Sheets"))) return;
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
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Resyncing the Ditto FAQ"))) return;
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
// gated route. This route (and its Term FAQ sibling below) is fetched only
// from the Connections page's Health FAQ card (KnowledgeBaseFaqConnection.tsx,
// which already gates its own manage actions on hasAccess("connections",
// "Editor")) — so it belongs to "connections", not "knowledge_base". Was
// requireAdminOrDeveloper (a hardcoded tier check); switched to
// requireFeatureAccess (2026-09 permission architecture fix) so this
// matches the rest of the Connections page's routes.
app.get("/api/kb/faq/records", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Viewer", "Viewing the Ditto FAQ"))) return;
    const { faqRecords } = createRepositories(getDb());
    const category = typeof req.query.category === "string" && FAQ_CATEGORIES.includes(req.query.category) ? (req.query.category as any) : undefined;
    // ?hasConflict=true — used by the Connections page's "N flagged for
    // review" detail, so it can list the actual conflicting question/answer
    // pairs instead of just showing the count.
    const hasConflict = req.query.hasConflict === "true" ? true : req.query.hasConflict === "false" ? false : undefined;
    const entries = await faqRecords.list({ category, hasConflict });
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

// --- Term FAQ: "Connect Google Sheets" + Resync (see
// src/server/knowledgeBase/termFaqIngest.ts / termFaqSheetsClient.ts) — same
// shape as the Ditto/Health FAQ routes above, own OAuth grant/table/resource,
// own Google Sheet (7 tabs, see termFaqIngest.ts's TERM_FAQ_TABS). ---

app.get("/api/kb/term-faq/connect-google", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Connecting Google Sheets"))) return;
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(TERM_FAQ_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(getTermFaqSheetsAuthUrl(state, req.user!.email));
  } catch (err: any) {
    console.error("Failed to start Term FAQ Google Sheets connection:", err);
    res.status(500).send("Could not start the connection. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example.");
  }
});

app.get("/api/kb/term-faq/connection-status", requireAuth, async (req, res) => {
  try {
    const { termFaqConnection, kbResources, termFaqRecords } = createRepositories(getDb());
    const row = await termFaqConnection.get();
    const resource = (await kbResources.list({})).find(r => r.type === "sheet" && r.title === TERM_FAQ_RESOURCE_TITLE);
    const records = resource ? await termFaqRecords.list({ resourceId: resource.id }) : [];
    return res.json({
      connected: !!row,
      connectedEmail: row?.connectedEmail ?? null,
      connectedAt: row?.connectedAt ?? null,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${TERM_FAQ_SPREADSHEET_ID}/edit`,
      resource: resource
        ? {
            status: resource.status,
            lastFetchedAt: resource.lastFetchedAt,
            errorMessage: resource.errorMessage,
            totalRecords: records.length,
            answerableCount: records.filter(r => r.isAnswerable && !r.hasConflict).length,
            incompleteCount: records.filter(r => !r.isAnswerable && !r.hasConflict).length,
            conflictingCount: records.filter(r => r.hasConflict).length,
          }
        : null,
    });
  } catch (err: any) {
    console.error("Term FAQ: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${err.message}` });
  }
});

app.delete("/api/kb/term-faq/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Disconnecting Google Sheets"))) return;
    const { termFaqConnection } = createRepositories(getDb());
    await termFaqConnection.clear();
    invalidateTermFaqSheetsAuthCache();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Term FAQ: failed to disconnect Google Sheets:", err);
    return res.status(500).json({ error: `Failed to disconnect: ${err.message}` });
  }
});

app.post("/api/kb/term-faq/resync", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Resyncing the Term FAQ"))) return;
    const repos = createRepositories(getDb());
    const result = await syncTermFaq(repos, req.user!.email);
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
    console.error("Term FAQ: resync failed:", err);
    return res.status(500).json({ error: `Resync failed: ${err.message}` });
  }
});

// Admin review listing — every record (including incomplete/conflicting),
// never exposed to advisors outside this gated route. Same "connections",
// not "knowledge_base" reasoning as /api/kb/faq/records above — fetched
// only from the Connections page's Term FAQ card.
app.get("/api/kb/term-faq/records", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Viewer", "Viewing the Term FAQ"))) return;
    const { termFaqRecords } = createRepositories(getDb());
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    // ?hasConflict=true — used by the Connections page's "N flagged for
    // review" detail, so it can list the actual conflicting question/answer
    // pairs instead of just showing the count.
    const hasConflict = req.query.hasConflict === "true" ? true : req.query.hasConflict === "false" ? false : undefined;
    const entries = await termFaqRecords.list({ category, hasConflict });
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list Term FAQ records:", err);
    return res.status(500).json({ error: `Failed to load FAQ records: ${err.message}` });
  }
});

// The only write this table supports outside a full resync — retiring a
// bad/outdated record without waiting for the next sheet edit. Never edits
// question/answer text itself: the Sheet remains the sole authoring source.
app.patch("/api/kb/term-faq/records/:id", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Editing a Term FAQ record"))) return;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });
    if (typeof req.body.isActive !== "boolean") return res.status(400).json({ error: "isActive (boolean) is required." });
    const { termFaqRecords, changeLogs, users: usersRepo } = createRepositories(getDb());
    const callerTier = await getCallerTier(req, usersRepo);
    const updated = await termFaqRecords.setActive(id, req.body.isActive);
    if (!updated) return res.status(404).json({ error: "FAQ record not found." });
    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: req.body.isActive ? "Term FAQ Record Activated" : "Term FAQ Record Deactivated",
        planName: null,
        description: `${req.body.isActive ? "Activated" : "Deactivated"} Term FAQ record #${id}: "${updated.question}"`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Term FAQ record update:", logErr);
    }
    return res.json({ record: updated });
  } catch (err: any) {
    console.error("Failed to update Term FAQ record:", err);
    return res.status(500).json({ error: `Failed to update: ${err.message}` });
  }
});

// --- Term Product Playbook: "Connect Google Sheets" + Resync (see
// src/server/knowledgeBase/termPlaybookIngest.ts / termPlaybookSheetsClient.ts) —
// same shape as the Health Playbook routes above, own OAuth grant/table/
// resource, own Google Sheet. ---

app.get("/api/kb/term-playbook/connect-google", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Connecting Google Sheets"))) return;
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(TERM_PLAYBOOK_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProdEnv(),
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(getTermPlaybookSheetsAuthUrl(state, req.user!.email));
  } catch (err: any) {
    console.error("Failed to start Term Playbook Google Sheets connection:", err);
    res.status(500).send("Could not start the connection. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set — see .env.example.");
  }
});

app.get("/api/kb/term-playbook/connection-status", requireAuth, async (req, res) => {
  try {
    const { termPlaybookConnection, kbResources, kbPlaybookPlanFacts } = createRepositories(getDb());
    const row = await termPlaybookConnection.get();
    const resource = (await kbResources.list({})).find(r => r.type === "sheet" && r.title === TERM_PLAYBOOK_RESOURCE_TITLE);
    const planFactCount = resource ? (await kbPlaybookPlanFacts.listByResource(resource.id)).length : 0;
    return res.json({
      connected: !!row,
      connectedEmail: row?.connectedEmail ?? null,
      connectedAt: row?.connectedAt ?? null,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${TERM_PLAYBOOK_SPREADSHEET_ID}/edit`,
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
    console.error("Term Playbook: failed to load connection status:", err);
    return res.status(500).json({ error: `Failed to load connection status: ${err.message}` });
  }
});

app.delete("/api/kb/term-playbook/connection", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Disconnecting Google Sheets"))) return;
    const { termPlaybookConnection } = createRepositories(getDb());
    await termPlaybookConnection.clear();
    invalidateTermPlaybookSheetsAuthCache();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Term Playbook: failed to disconnect Google Sheets:", err);
    return res.status(500).json({ error: `Failed to disconnect: ${err.message}` });
  }
});

app.post("/api/kb/term-playbook/resync", requireAuth, expensiveActionLimiter, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "connections", "Editor", "Resyncing the Term Playbook"))) return;
    const repos = createRepositories(getDb());
    const result = await syncTermPlaybook(repos, req.user!.email);
    if (result.resource.status === "error") {
      return res.status(500).json({ error: result.resource.errorMessage || "Sync failed.", resource: result.resource });
    }
    return res.json({
      ok: true,
      skipped: result.skipped,
      planFactCount: result.planFactCount,
      narrativeChunkCount: result.narrativeChunkCount,
      previousPlanFactCount: result.previousPlanFactCount,
      previousNarrativeChunkCount: result.previousNarrativeChunkCount,
      plansAdded: result.plansAdded,
      plansRemoved: result.plansRemoved,
      plansChanged: result.plansChanged,
      plansUnchanged: result.plansUnchanged,
      resource: result.resource,
    });
  } catch (err: any) {
    console.error("Term Playbook: resync failed:", err);
    return res.status(500).json({ error: `Resync failed: ${err.message}` });
  }
});

// --- Did You Know card: combined daily-rotating Health + Term FAQ feed
// (see src/server/knowledgeBase/didYouKnow.ts). Replaces the old dedicated
// GET /api/announcements/insight route — visibility is tag-based, not
// admin-authored. ---
app.get("/api/did-you-know", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    const caller = await repos.users.findByEmail(req.user!.email);
    // Same visibility rule as /api/announcements: Health-tagged -> Health
    // only, Term-tagged -> Term only, both/neither -> undefined (no
    // restriction, i.e. both categories) — see teamForTags above.
    const team = teamForTags(caller?.tags);
    // Fire-and-forget lazy staleness refresh for the Health/Term FAQ sheets
    // this feed reads from — never awaited, so a slow/failed refresh can
    // never delay this response (same pattern as Product Assist's own
    // maybeRefreshFaqIfStale usage above).
    void maybeRefreshFaqIfStale(repos);
    void maybeRefreshTermFaqIfStale(repos);
    const items = await getDidYouKnowFeed(repos, team);
    return res.json({ items });
  } catch (err: any) {
    console.error("Failed to load the Did You Know feed:", err);
    return res.status(500).json({ error: `Failed to load: ${err.message}` });
  }
});

// --- Categories ---

app.get("/api/kb/categories", requireAuth, async (req, res) => {
  try {
    // Was requireAdminOrDeveloper (a hardcoded tier check) — switched to
    // knowledge_base Viewer (2026-09 permission architecture fix) to match
    // the write routes below, which already gate on knowledge_base Editor.
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Viewer", "Viewing the Knowledge Base"))) return;
    const { domain } = req.query;
    const { kbCategories } = createRepositories(getDb());
    const entries = await kbCategories.list(isValidAnnouncementTeam(domain) ? { domain } : {});
    return res.json({ entries });
  } catch (err: any) {
    console.error("Failed to list KB categories:", err);
    return res.status(500).json({ error: `Failed to load categories: ${err.message}` });
  }
});

app.post("/api/kb/categories", requireAuth, async (req, res) => {
  try {
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Editor", "Adding a Knowledge Base category"))) return;
    const { name, type, sortOrder, domain } = req.body;
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required." });
    if (type !== "insurer" && type !== "general" && type !== "fundamentals") {
      return res.status(400).json({ error: 'type must be "insurer", "general", or "fundamentals".' });
    }
    // domain defaults to "Health" (the DB column's own default) when
    // omitted, so every pre-Term caller of this route keeps working
    // unchanged — see kb_categories.domain's schema.ts comment.
    if (domain !== undefined && !isValidAnnouncementTeam(domain)) {
      return res.status(400).json({ error: 'domain must be "Health" or "Term".' });
    }
    const { kbCategories } = createRepositories(getDb());
    const category = await kbCategories.create({
      name: name.trim(),
      type,
      sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      ...(isValidAnnouncementTeam(domain) ? { domain } : {}),
    });
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
    if (type !== undefined && type !== "insurer" && type !== "general" && type !== "fundamentals") {
      return res.status(400).json({ error: 'type must be "insurer", "general", or "fundamentals".' });
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
    // Was requireAdminOrDeveloper — same knowledge_base Viewer fix as
    // /api/kb/categories above.
    if (!(await requireFeatureAccess(req, res, "knowledge_base", "Viewer", "Viewing the Knowledge Base"))) return;
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
    const { topic, instructionType, insurerCategoryId, isActive, domain } = req.query;
    const { specialInstructions } = createRepositories(getDb());
    const entries = await specialInstructions.list({
      ...(typeof topic === "string" && topic.trim() ? { topic: topic.trim() } : {}),
      ...(typeof instructionType === "string" && SPECIAL_INSTRUCTION_TYPES.includes(instructionType) ? { instructionType: instructionType as any } : {}),
      ...(insurerCategoryId !== undefined && Number.isInteger(Number(insurerCategoryId)) ? { insurerCategoryId: Number(insurerCategoryId) } : {}),
      ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
      ...(isValidAnnouncementTeam(domain) ? { domain } : {}),
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
    const { topic, instructionText, instructionType, insurerCategoryId, productPlanName, domain } = req.body;
    if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "topic is required." });
    if (typeof instructionText !== "string" || !instructionText.trim()) {
      return res.status(400).json({ error: "instructionText is required." });
    }
    if (typeof instructionType !== "string" || !SPECIAL_INSTRUCTION_TYPES.includes(instructionType)) {
      return res.status(400).json({ error: `instructionType must be one of: ${SPECIAL_INSTRUCTION_TYPES.join(", ")}.` });
    }
    // domain defaults to "Health" (the DB column's own default) when
    // omitted — see special_instructions.domain's schema.ts comment.
    if (domain !== undefined && !isValidAnnouncementTeam(domain)) {
      return res.status(400).json({ error: 'domain must be "Health" or "Term".' });
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
      ...(isValidAnnouncementTeam(domain) ? { domain } : {}),
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
    const { search, isActive, domain } = req.query;
    const { kbAcronyms } = createRepositories(getDb());
    const entries = await kbAcronyms.list({
      ...(typeof search === "string" && search.trim() ? { search: search.trim() } : {}),
      ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
      ...(isValidAnnouncementTeam(domain) ? { domain } : {}),
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
    const { acronym, expansion, notes, domain } = req.body;
    if (typeof acronym !== "string" || !acronym.trim()) return res.status(400).json({ error: "acronym is required." });
    if (typeof expansion !== "string" || !expansion.trim()) return res.status(400).json({ error: "expansion is required." });
    // domain defaults to "Health" (the DB column's own default) when
    // omitted — see kb_acronyms.domain's schema.ts comment.
    if (domain !== undefined && !isValidAnnouncementTeam(domain)) {
      return res.status(400).json({ error: 'domain must be "Health" or "Term".' });
    }

    const entry = await kbAcronyms.create({
      acronym: acronym.trim(),
      expansion: expansion.trim(),
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      isActive: true,
      ...(isValidAnnouncementTeam(domain) ? { domain } : {}),
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
    const { kbCategories, kbResources, users: usersRepo } = createRepositories(getDb());
    const caller = await usersRepo.findByEmail(req.user!.email);
    const resolved = resolveCallerDomain(req.query.domain, caller?.tags);
    if ("error" in resolved) return res.status(403).json({ error: resolved.error });
    const [entries, resources] = await Promise.all([
      kbCategories.list({ domain: resolved.domain }),
      kbResources.list({ status: "active" }),
    ]);
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
    const { kbCategories, kbResources, users: usersRepo } = createRepositories(getDb());
    const caller = await usersRepo.findByEmail(req.user!.email);
    const resolved = resolveCallerDomain(req.query.domain, caller?.tags);
    if ("error" in resolved) return res.status(403).json({ error: resolved.error });
    const [categories, resources] = await Promise.all([
      kbCategories.list({ domain: resolved.domain }),
      kbResources.list({ status: "active" }),
    ]);

    const resourcesByCategory = new Map<number, typeof resources>();
    for (const r of resources) {
      const list = resourcesByCategory.get(r.categoryId);
      if (list) list.push(r);
      else resourcesByCategory.set(r.categoryId, [r]);
    }

    // Domain-appropriate Playbook resource — Health and Term each have their
    // own kb_resources row (2026-09: Term Playbook added), identified by
    // title exactly like PLAYBOOK_RESOURCE_TITLE's own doc comment describes.
    const playbookResourceTitle = resolved.domain === "Health" ? PLAYBOOK_RESOURCE_TITLE : TERM_PLAYBOOK_RESOURCE_TITLE;
    const playbookResource = resources.find(r => r.type === "sheet" && r.title === playbookResourceTitle);

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
    const { categoryId, planTags, question, history, domain } = req.body;
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

    // Health/Term isolation (2026-09) — validated against the caller's own
    // users.tags server-side, never trusted purely from the client, per the
    // confirmed tag-based access rule (see resolveCallerDomain's comment).
    const caller = await repos.users.findByEmail(req.user!.email);
    const resolvedDomain = resolveCallerDomain(domain, caller?.tags);
    if ("error" in resolvedDomain) return res.status(403).json({ error: resolvedDomain.error });

    // Credit & Usage Management (2026-08, enforcement revised 2026-09) —
    // checked BEFORE the AI call, per productAssistQuota.ts's doc comment.
    // Monthly is the sole gate now (the daily figure is informational
    // pacing only, never blocking by itself — see that file's ENFORCEMENT
    // MODEL comment), so this only ever fires once the monthly allowance
    // itself is exhausted; never touches retrieval/prompt/answer logic
    // below.
    const callerEmail = req.user!.email;
    const { allowed, status: quotaStatus } = await checkQuota(repos, callerEmail);
    if (!allowed) {
      return res.status(429).json({
        error: "Monthly Product Assist credit limit reached. Contact a Developer/Platform Admin for extra credits.",
        quota: quotaStatus,
      });
    }

    // Fire-and-forget staleness refreshes — never awaited, so a slow or
    // failed refresh can never delay this answer. Both domains now have a
    // Playbook and a FAQ to keep fresh (2026-09: Term Playbook added).
    if (resolvedDomain.domain === "Health") {
      void maybeRefreshPlaybookIfStale(repos);
      void maybeRefreshFaqIfStale(repos);
    } else {
      void maybeRefreshTermPlaybookIfStale(repos);
      void maybeRefreshTermFaqIfStale(repos);
    }
    const scope = { categoryId: categoryId ?? null, planTags: Array.isArray(planTags) ? planTags : [] };
    const result = await answerQuery(repos, scope, question.trim(), Array.isArray(history) ? history : [], resolvedDomain.domain);

    // Record actual consumption SYNCHRONOUSLY (awaited, unlike the
    // product_assist_logs write below) — this is the quota system's real
    // source of truth. Null tokens means no AI call actually happened (e.g.
    // a deterministic Special-Instruction-conflict answer), so there's
    // nothing to charge for.
    let quotaAfter = quotaStatus;
    let usageLedgerId: number | null = null;
    if (result.meta.inputTokens !== null && result.meta.outputTokens !== null) {
      const ledgerRow = await recordUsage(repos, callerEmail, result.meta.inputTokens, result.meta.outputTokens);
      usageLedgerId = ledgerRow.id;
      quotaAfter = await getQuotaStatus(repos, callerEmail);

      // Cross-feature usage tracking (2026-09, visibility only — see
      // ai_usage_log's schema.ts comment). Mirrors the same call this
      // ledger row above already recorded for enforcement; fire-and-forget
      // since a failure here must never affect the advisor's answer or the
      // quota system that already recorded above.
      void repos.aiUsageLog
        .record({
          source: "product_assist",
          userEmail: callerEmail,
          model: result.meta.modelName ?? "unknown",
          inputTokens: result.meta.inputTokens,
          outputTokens: result.meta.outputTokens,
        })
        .catch(err => console.error("AI usage log: failed to record Product Assist entry (non-fatal):", err));
    }

    // Resolved once, shared by both fire-and-forget writes below (the
    // temporary analysis log and the permanent Unresolved Queries record)
    // so a question with categoryId set only pays for one kbCategories.list
    // call rather than two.
    const categoryNamePromise: Promise<string | null> =
      scope.categoryId !== null
        ? repos.kbCategories.list({ domain: resolvedDomain.domain }).then(cats => cats.find(c => c.id === scope.categoryId)?.name ?? null)
        : Promise.resolve(null);

    // Query-detail log (see product_assist_logs's schema comment — a
    // permanent record as of 2026-09): fire-and-forget, never awaited — a
    // logging failure must never affect the advisor's actual answer, which
    // has already been computed above regardless of what happens here.
    // Gated by PRODUCT_ASSIST_LOG_ENABLED so this can be turned off (set to
    // "false"); unset/anything else defaults to enabled. usageLedgerId links
    // this row back to the ledger entry above (null when no AI call
    // happened, e.g. a Special-Instruction-conflict answer) so the Usage
    // History admin tab can look up one usage row's full detail directly.
    if (process.env.PRODUCT_ASSIST_LOG_ENABLED !== "false") {
      void (async () => {
        try {
          await repos.productAssistLogs.create({
            userEmail: req.user!.email,
            usageLedgerId,
            categoryId: scope.categoryId,
            categoryName: await categoryNamePromise,
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
            modelName: result.meta.modelName,
            latencyMs: result.meta.latencyMs,
          });
        } catch (logErr) {
          console.error("Product Assist: failed to write analysis log row (non-fatal):", logErr);
        }
      })();
    }

    // PERMANENT (see product_assist_unresolved_queries's schema comment) —
    // unlike the log above, this is never gated by PRODUCT_ASSIST_LOG_ENABLED
    // and is never cleared by an export: it's the durable "AI had nothing to
    // answer with" queue the AI Usage & Limits > Unresolved Queries tab is
    // built around. Also fire-and-forget for the same reason as above.
    if (result.hadNoMatches) {
      void (async () => {
        try {
          await repos.productAssistUnresolvedQueries.create({
            domain: resolvedDomain.domain,
            userEmail: req.user!.email,
            categoryId: scope.categoryId,
            categoryName: await categoryNamePromise,
            planTags: scope.planTags,
            question: question.trim(),
          });
        } catch (unresolvedErr) {
          console.error("Product Assist: failed to record unresolved query (non-fatal):", unresolvedErr);
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
// below goes through requireQuotaAdmin() -> requireFeatureAccess() against
// the "product_assist_quota" governed feature, whose shipped default keeps
// it Developer + Platform Admin ONLY — deliberately narrower than the
// typical Admin-Zone gate (isAdminPower) per the user's explicit access-
// control decision, a plain Admin cannot view or change anyone's quota by
// default. No longer a hardcoded isDeveloperPower-only gate as of 2026-09
// (DEVELOPER_ONLY_FEATURES is now empty — see featurePermissions.ts), so a
// Developer can reassign this from the Permissions tab like any other
// feature. The "AI Usage & Limits" page mirrors this client-side via
// hasAccess("product_assist_quota", ...).
// ─────────────────────────────────────────────────────────────────────────

// Was a hardcoded isDeveloperPower-only gate (matching product_assist_quota's
// old DEVELOPER_ONLY_FEATURES membership). That Set is now empty (2026-09 —
// see featurePermissions.ts), so this routes through the same
// requireFeatureAccess() every other governed feature uses, meaning a
// Permissions-tab / Access Rule / Custom Grant on "product_assist_quota"
// actually takes effect here instead of being silently ignored.
// actionType defaults to "Editor" (every route below except the 5 GET reads
// passes "Viewer" explicitly) since most of what this gates is a write.
async function requireQuotaAdmin(req: any, res: any, usersRepo: UsersRepository, actionType: "Viewer" | "Editor" = "Editor"): Promise<string | null> {
  if (!(await requireFeatureAccess(req, res, "product_assist_quota", actionType, "Product Assist usage & limits"))) return null;
  return getCallerTier(req, usersRepo);
}

// GET /api/product-assist/quota/settings — the global defaults/conversion/
// budget/pricing row (Settings tab).
app.get("/api/product-assist/quota/settings", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistQuotaSettings } = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, usersRepo, "Viewer"))) return;
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
// Eligibility/default-credit fields live on product_assist_eligibility_groups
// as of 2026-09-07 (see the /eligibility-groups routes below), not here.
app.put("/api/product-assist/quota/settings", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistQuotaSettings, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const b = req.body ?? {};
    const intFields = ["tokensPerCredit", "warningThresholdPercent", "budgetWarningThresholdPercent"] as const;
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

// ─────────────────────────────────────────────────────────────────────────
// AI Model Pricing (2026-09) — see ai_model_pricing's schema.ts comment.
// Used exclusively by the cross-feature Overview cost estimate
// (GET /api/product-assist/quota/overview's allSources); Product Assist's
// own single-model budget tracking above is unaffected. Same
// requireQuotaAdmin gate as every other route in this section.
// ─────────────────────────────────────────────────────────────────────────

// GET /api/product-assist/quota/model-pricing — every configured model's
// price (Settings tab's pricing editor).
app.get("/api/product-assist/quota/model-pricing", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, aiModelPricing } = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, usersRepo, "Viewer"))) return;
    const pricing = await aiModelPricing.list();
    return res.json({ pricing });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load model pricing:", err);
    return res.status(500).json({ error: `Failed to load model pricing: ${err.message}` });
  }
});

// PUT /api/product-assist/quota/model-pricing/:modelName — set one model's
// input/output price. Upsert (create-or-update) so a new model any AI
// call site starts using can be priced without a separate "add" step.
app.put("/api/product-assist/quota/model-pricing/:modelName", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, aiModelPricing, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const modelName = String(req.params.modelName).trim();
    if (!modelName) return res.status(400).json({ error: "modelName is required." });

    const { inputPricePerMillionTokens, outputPricePerMillionTokens } = req.body ?? {};
    const inputPrice = Number(inputPricePerMillionTokens);
    const outputPrice = Number(outputPricePerMillionTokens);
    if (!Number.isFinite(inputPrice) || inputPrice < 0) {
      return res.status(400).json({ error: "inputPricePerMillionTokens must be a non-negative number." });
    }
    if (!Number.isFinite(outputPrice) || outputPrice < 0) {
      return res.status(400).json({ error: "outputPricePerMillionTokens must be a non-negative number." });
    }

    const updated = await aiModelPricing.upsert({
      modelName,
      inputPricePerMillionTokens: inputPrice,
      outputPricePerMillionTokens: outputPrice,
      updatedBy: req.user!.email,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "AI Model Pricing Changed",
        planName: null,
        description: `Updated AI model pricing for "${modelName}".`,
        snapshot: { after: updated },
      });
    } catch (logErr) {
      console.error("Failed to write change log for model pricing update:", logErr);
    }

    return res.json({ pricing: updated });
  } catch (err: any) {
    console.error("Product Assist quota: failed to update model pricing:", err);
    return res.status(500).json({ error: `Failed to update model pricing: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Product Assist Eligibility Groups (2026-09-07) — CRUD for the ordered
// list of admin-defined groups that decide which users get which
// daily/monthly credit allowance, replacing the single global Department/
// Team/Role rule + trial fallback. See schema.ts's doc comment on
// product_assist_eligibility_groups and productAssistQuota.ts's header
// comment for the full reasoning. Same requireQuotaAdmin gate as every
// other route in this section.
// ─────────────────────────────────────────────────────────────────────────

// GET /api/product-assist/quota/eligibility-groups — every group, in
// display order (Settings tab).
app.get("/api/product-assist/quota/eligibility-groups", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistEligibilityGroups } = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, usersRepo, "Viewer"))) return;
    const groups = await productAssistEligibilityGroups.list();
    return res.json({ groups });
  } catch (err: any) {
    console.error("Product Assist quota: failed to list eligibility groups:", err);
    return res.status(500).json({ error: `Failed to load eligibility groups: ${err.message}` });
  }
});

// Shared body-parsing/validation for POST (create) and PATCH (update)
// below — each of the four matching conditions is optional/nullable
// ("any" when unset), but if provided as an ID must reference a real,
// existing catalog row so a typo can't silently no-op. Returns an error
// string on failure, or the validated patch fields on success.
async function parseEligibilityGroupBody(
  b: any,
  catalogs: { departments: { get(id: number): Promise<unknown> }; orgTeams: { get(id: number): Promise<unknown> }; roles: { get(id: number): Promise<unknown> } },
  { partial }: { partial: boolean }
): Promise<{ error: string } | { patch: Record<string, unknown> }> {
  const patch: Record<string, unknown> = {};

  if (!partial || b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) return { error: "name is required." };
    patch.name = b.name.trim();
  }

  const idFields = [
    { field: "departmentId", repo: catalogs.departments, noun: "department" },
    { field: "orgTeamId", repo: catalogs.orgTeams, noun: "business unit" },
    { field: "roleId", repo: catalogs.roles, noun: "role" },
  ] as const;
  for (const { field, repo, noun } of idFields) {
    if (partial && b[field] === undefined) continue;
    if (b[field] === null || b[field] === undefined || b[field] === "") {
      patch[field] = null;
      continue;
    }
    const id = Number(b[field]);
    if (!Number.isInteger(id)) return { error: `${field} must be a whole number ID or null.` };
    const row = await repo.get(id);
    if (!row) return { error: `${field} does not reference an existing ${noun}.` };
    patch[field] = id;
  }

  if (!partial || b.tag !== undefined) {
    patch.tag = typeof b.tag === "string" && b.tag.trim() ? b.tag.trim() : null;
  }

  for (const field of ["dailyCredits", "monthlyCredits"] as const) {
    if (partial && b[field] === undefined) continue;
    if (b[field] === null || b[field] === undefined || b[field] === "") {
      patch[field] = null;
      continue;
    }
    const n = Number(b[field]);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { error: `${field} must be a non-negative whole number, or blank for uncapped.` };
    }
    patch[field] = n;
  }

  if (b.sortOrder !== undefined) {
    const n = Number(b.sortOrder);
    if (!Number.isInteger(n)) return { error: "sortOrder must be a whole number." };
    patch.sortOrder = n;
  }

  return { patch };
}

// POST /api/product-assist/quota/eligibility-groups — create a new group.
app.post("/api/product-assist/quota/eligibility-groups", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistEligibilityGroups, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const parsed = await parseEligibilityGroupBody(req.body ?? {}, { departments, orgTeams, roles }, { partial: false });
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const row = await productAssistEligibilityGroups.create({
      name: parsed.patch.name as string,
      departmentId: (parsed.patch.departmentId as number | null) ?? null,
      orgTeamId: (parsed.patch.orgTeamId as number | null) ?? null,
      roleId: (parsed.patch.roleId as number | null) ?? null,
      tag: (parsed.patch.tag as string | null) ?? null,
      dailyCredits: (parsed.patch.dailyCredits as number | null) ?? null,
      monthlyCredits: (parsed.patch.monthlyCredits as number | null) ?? null,
      sortOrder: (parsed.patch.sortOrder as number | undefined) ?? 0,
      createdBy: `${req.user!.name} (${callerTier})`,
    });

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Product Assist Eligibility Group Created",
        planName: null,
        description: `Created Product Assist eligibility group "${row.name}".`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for eligibility group creation:", logErr);
    }

    return res.json({ group: row });
  } catch (err: any) {
    console.error("Product Assist quota: failed to create eligibility group:", err);
    return res.status(500).json({ error: `Failed to create eligibility group: ${err.message}` });
  }
});

// PATCH /api/product-assist/quota/eligibility-groups/:id — partial update.
app.patch("/api/product-assist/quota/eligibility-groups/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistEligibilityGroups, departments, orgTeams, roles, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid eligibility group id." });
    const existing = await productAssistEligibilityGroups.get(id);
    if (!existing) return res.status(404).json({ error: "Eligibility group not found." });

    const parsed = await parseEligibilityGroupBody(req.body ?? {}, { departments, orgTeams, roles }, { partial: true });
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const row = await productAssistEligibilityGroups.update(id, parsed.patch);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Product Assist Eligibility Group Edited",
        planName: null,
        description: `Updated Product Assist eligibility group "${existing.name}" (${Object.keys(parsed.patch).join(", ") || "no fields"}).`,
        snapshot: { before: existing, after: row },
      });
    } catch (logErr) {
      console.error("Failed to write change log for eligibility group edit:", logErr);
    }

    return res.json({ group: row });
  } catch (err: any) {
    console.error("Product Assist quota: failed to update eligibility group:", err);
    return res.status(500).json({ error: `Failed to update eligibility group: ${err.message}` });
  }
});

// DELETE /api/product-assist/quota/eligibility-groups/:id — real deletion
// (unlike access_rules, a group has no dependent rows anywhere else).
app.delete("/api/product-assist/quota/eligibility-groups/:id", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistEligibilityGroups, changeLogs } = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, usersRepo);
    if (!callerTier) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid eligibility group id." });
    const existing = await productAssistEligibilityGroups.get(id);
    if (!existing) return res.status(404).json({ error: "Eligibility group not found." });

    await productAssistEligibilityGroups.delete(id);

    try {
      await changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Product Assist Eligibility Group Deleted",
        planName: null,
        description: `Deleted Product Assist eligibility group "${existing.name}".`,
        snapshot: { before: existing, after: null },
      });
    } catch (logErr) {
      console.error("Failed to write change log for eligibility group deletion:", logErr);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Product Assist quota: failed to delete eligibility group:", err);
    return res.status(500).json({ error: `Failed to delete eligibility group: ${err.message}` });
  }
});

// GET /api/product-assist/quota/overview[?month=YYYY-MM] — company-wide
// totals for the Overview tab: credits/tokens used, request count, and a
// budget estimate from the configured pricing — visibility only, never an
// auto-stop, per product decision. Defaults to the current IST month; a past
// month ("YYYY-MM", IST calendar month — same boundaries as the current-month
// figures) is read straight from the stored ledger/usage-log rows, bounded
// [month start, next month start). A past month's cost is estimated with the
// CURRENT per-token prices (no historical price is stored). `today` is only
// meaningful for the current month, so it is null for a past one.
app.get("/api/product-assist/quota/overview", requireAuth, async (req, res) => {
  try {
    const { users: usersRepo, productAssistQuotaSettings, productAssistUsageLedger, aiUsageLog, aiModelPricing } = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, usersRepo, "Viewer"))) return;

    const settings = await productAssistQuotaSettings.get();
    const now = new Date();
    const currentMonth = istMonthKey(now);
    const requestedMonth = typeof req.query.month === "string" && req.query.month ? req.query.month : currentMonth;
    const range = istMonthRange(requestedMonth);
    if (!range || requestedMonth > currentMonth) {
      return res.status(400).json({ error: "Choose a valid month, no later than the current month." });
    }
    const isCurrentMonth = requestedMonth === currentMonth;
    const monthStart = range.start;
    const monthEnd = isCurrentMonth ? undefined : range.end;
    const dayStart = startOfDayIST(now);
    const [monthTotals, todayTotals, monthByModel, priceMap, ledgerMonths, usageLogMonths] = await Promise.all([
      productAssistUsageLedger.companyTotals(monthStart, monthEnd),
      isCurrentMonth ? productAssistUsageLedger.companyTotals(dayStart) : Promise.resolve(null),
      aiUsageLog.companyTotalsByModel(monthStart, monthEnd),
      aiModelPricing.getMap(),
      productAssistUsageLedger.distinctMonthsIST(),
      aiUsageLog.distinctMonthsIST(),
    ]);
    // Selector options: every month that has stored usage (either table) up
    // to the current month, newest first. The current month is always
    // offered, even before it has any usage.
    const availableMonths = Array.from(new Set([...ledgerMonths, ...usageLogMonths, currentMonth]))
      .filter((m) => m <= currentMonth)
      .sort()
      .reverse();
    const estimatedCostThisMonth = estimateCost(monthTotals.totalInputTokens, monthTotals.totalOutputTokens, {
      inputPricePerMillionTokens: Number(settings.inputPricePerMillionTokens),
      outputPricePerMillionTokens: Number(settings.outputPricePerMillionTokens),
    });
    const monthlyBudget = Number(settings.monthlyBudget);
    const budgetUtilizationPercent = monthlyBudget > 0 ? Math.round((estimatedCostThisMonth / monthlyBudget) * 100) : null;

    // Cross-feature usage breakdown (2026-09, visibility only — see
    // ai_usage_log's schema.ts comment). Cost per (source, model) row uses
    // ai_model_pricing, not product_assist_quota_settings's single price —
    // several of these sources try more than one model, so a per-model
    // lookup is required for an accurate total; a model with no configured
    // price contributes 0 to cost but still counts toward tokens, and is
    // flagged via hasUnpricedModel so the UI can say the total is a
    // undercount rather than silently implying completeness.
    const bySource = new Map<
      string,
      { inputTokens: number; outputTokens: number; totalTokens: number; requestCount: number; estimatedCost: number; hasUnpricedModel: boolean }
    >();
    for (const row of monthByModel) {
      const entry = bySource.get(row.source) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        estimatedCost: 0,
        hasUnpricedModel: false,
      };
      entry.inputTokens += row.inputTokens;
      entry.outputTokens += row.outputTokens;
      entry.totalTokens += row.totalTokens;
      entry.requestCount += row.requestCount;
      const price = priceMap.get(row.model);
      if (price) {
        entry.estimatedCost += estimateCost(row.inputTokens, row.outputTokens, price);
      } else {
        entry.hasUnpricedModel = true;
      }
      bySource.set(row.source, entry);
    }
    const allSources = Array.from(bySource.entries()).map(([source, totals]) => ({
      source,
      ...totals,
      estimatedCost: Math.round(totals.estimatedCost * 100) / 100,
    }));

    return res.json({
      settings,
      selectedMonth: requestedMonth,
      currentMonth,
      isCurrentMonth,
      availableMonths,
      today: todayTotals,
      month: monthTotals,
      budget: {
        currency: settings.currency,
        monthlyBudget,
        estimatedCostThisMonth: Math.round(estimatedCostThisMonth * 100) / 100,
        budgetUtilizationPercent,
        warningThresholdPercent: settings.budgetWarningThresholdPercent,
      },
      allSources,
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
    if (!(await requireQuotaAdmin(req, res, repos.users, "Viewer"))) return;
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
    if (!(await requireQuotaAdmin(req, res, repos.users, "Viewer"))) return;
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
// back to their computed eligibility-group default(s).
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
        description: `Reverted ${email} to their default Product Assist quota (based on the eligibility group(s) they match).`,
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
    if (!(await requireQuotaAdmin(req, res, repos.users, "Viewer"))) return;

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
    // Attach modelName (2026-09) so the Usage History tab's collapsed row
    // shows which Gemini model answered without a per-row fetch — a bulk
    // lookup keyed by ledger id, not a join, so this stays a plain
    // best-effort enrichment of an otherwise-unrelated ledger query.
    const modelNames = await repos.productAssistLogs.findModelNamesByUsageLedgerIds(rows.map((r) => r.id));
    const rowsWithModel = rows.map((r) => ({ ...r, modelName: modelNames[r.id] ?? null }));
    return res.json({ rows: rowsWithModel });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load usage history:", err);
    return res.status(500).json({ error: `Failed to load usage history: ${err.message}` });
  }
});

// GET /api/product-assist/quota/usage/:id/detail — full query detail for one
// Usage History row (2026-09), expand-in-place on the admin tab. Looked up
// via product_assist_logs.usageLedgerId — see that column's schema.ts
// comment. Returns { detail: null } (not a 404) when no log row is linked,
// since that's an expected, non-error state (logging disabled for that
// request, or it predates the usageLedgerId link) the client should render
// as a plain "no detail recorded" message rather than an error.
app.get("/api/product-assist/quota/usage/:id/detail", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, repos.users, "Viewer"))) return;

    const ledgerId = Number(req.params.id);
    if (!Number.isInteger(ledgerId)) return res.status(400).json({ error: "Invalid usage row id." });

    const detail = await repos.productAssistLogs.findByUsageLedgerId(ledgerId);
    return res.json({ detail });
  } catch (err: any) {
    console.error("Product Assist quota: failed to load usage row detail:", err);
    return res.status(500).json({ error: `Failed to load usage row detail: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Unresolved Queries (2026-09) — see product_assist_unresolved_queries's
// schema.ts comment for the full design. Same requireQuotaAdmin gate as
// every other AI Usage & Limits route above (this is that page's
// "Unresolved Queries" tab); resolving a row by actually CREATING a Special
// Instruction still goes through the separately-authorized POST /api/kb/
// special-instructions route (Developer/Platform Admin only, unchanged) —
// the PATCH route below only ever links an already-created instruction's id
// to a row, it never creates one itself.
// ─────────────────────────────────────────────────────────────────────────

// GET /api/product-assist/quota/unresolved-queries — filterable list for the
// Unresolved Queries tab (date range, status, domain).
app.get("/api/product-assist/quota/unresolved-queries", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    if (!(await requireQuotaAdmin(req, res, repos.users, "Viewer"))) return;

    const { domain, status, from, to } = req.query;
    const filter: Parameters<typeof repos.productAssistUnresolvedQueries.list>[0] = {};
    if (isValidAnnouncementTeam(domain)) filter.domain = domain;
    if (status === "unresolved" || status === "resolved" || status === "skipped") filter.status = status;
    if (typeof from === "string" && from.trim()) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) filter.from = d;
    }
    if (typeof to === "string" && to.trim()) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) filter.to = d;
    }

    const rows = await repos.productAssistUnresolvedQueries.list(filter);
    return res.json({ rows });
  } catch (err: any) {
    console.error("Unresolved Queries: failed to load list:", err);
    return res.status(500).json({ error: `Failed to load Unresolved Queries: ${describeDbError(err)}` });
  }
});

// PATCH /api/product-assist/quota/unresolved-queries/:id — resolve (linking
// an already-created Special Instruction), skip, or reopen a row.
app.patch("/api/product-assist/quota/unresolved-queries/:id", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, repos.users);
    if (!callerTier) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid Unresolved Query id." });
    const existing = await repos.productAssistUnresolvedQueries.get(id);
    if (!existing) return res.status(404).json({ error: "Unresolved Query not found." });

    const { status, resolvedSpecialInstructionId } = req.body;
    if (status !== "unresolved" && status !== "resolved" && status !== "skipped") {
      return res.status(400).json({ error: 'status must be "unresolved", "resolved", or "skipped".' });
    }
    let linkedInstructionId: number | null = null;
    if (status === "resolved" && resolvedSpecialInstructionId !== undefined && resolvedSpecialInstructionId !== null) {
      const idNum = Number(resolvedSpecialInstructionId);
      if (!Number.isInteger(idNum)) return res.status(400).json({ error: "Invalid resolvedSpecialInstructionId." });
      const instruction = await repos.specialInstructions.get(idNum);
      if (!instruction) return res.status(400).json({ error: "Special Instruction not found." });
      linkedInstructionId = idNum;
    }

    const row = await repos.productAssistUnresolvedQueries.updateStatus(id, {
      status,
      resolvedBy: `${req.user!.name} (${req.user!.email})`,
      resolvedSpecialInstructionId: linkedInstructionId,
    });
    if (!row) return res.status(404).json({ error: "Unresolved Query not found." });

    try {
      const actionType =
        status === "resolved" ? "Unresolved Query Resolved" : status === "skipped" ? "Unresolved Query Skipped" : "Unresolved Query Reopened";
      await repos.changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType,
        planName: null,
        description: `${actionType} — "${row.question.slice(0, 120)}${row.question.length > 120 ? "…" : ""}"${
          linkedInstructionId !== null ? ` (linked to Special Instruction #${linkedInstructionId})` : ""
        }.`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Unresolved Query status change:", logErr);
    }

    return res.json({ row });
  } catch (err: any) {
    console.error("Unresolved Queries: failed to update status:", err);
    return res.status(500).json({ error: `Failed to update this Unresolved Query: ${describeDbError(err)}` });
  }
});

// POST /api/product-assist/quota/unresolved-queries/export — pushes the full
// current snapshot to the "Unresolved - Health"/"Unresolved - Term" tabs of
// the same Sheet Product Assist Log Export already writes to (see
// productAssistUnresolvedQueriesSheetsClient.ts's header comment).
app.post("/api/product-assist/quota/unresolved-queries/export", requireAuth, async (req, res) => {
  try {
    const repos = createRepositories(getDb());
    const callerTier = await requireQuotaAdmin(req, res, repos.users);
    if (!callerTier) return;

    const rows = await repos.productAssistUnresolvedQueries.listAll();
    await exportUnresolvedQueryRows(rows);

    try {
      await repos.changeLogs.create({
        userName: req.user!.name,
        role: callerTier,
        actionType: "Unresolved Queries Exported",
        planName: null,
        description: `Exported ${rows.length} Unresolved Quer${rows.length === 1 ? "y" : "ies"} to Google Sheets (Health/Term tabs).`,
        snapshot: null,
      });
    } catch (logErr) {
      console.error("Failed to write change log for Unresolved Queries export:", logErr);
    }

    return res.json({ ok: true, exportedCount: rows.length });
  } catch (err: any) {
    console.error("Unresolved Queries: export failed:", err);
    return res.status(500).json({ error: `Export failed: ${describeDbError(err)}` });
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
  console.log(
    `[Mapping engine] ${MAPPING_ENGINE === "db" ? "db — data-driven routing (routing_rules / aliases / categories; live across instances via mapping_state)" : "legacy — hard-coded engine in src/engine.ts"}`
  );
  if (MAPPING_ENGINE === "db") {
    try {
      const snapshot = await getMappingSnapshot(createRepositories(getDb()));
      console.log(`[Mapping engine] Snapshot v${snapshot.version} loaded: ${snapshot.steps.length} pipeline steps, ${snapshot.aliases.size} aliases.`);
      if (snapshot.steps.length === 0) {
        console.warn("[Mapping engine] WARNING: no routing rules found — every lookup would fall through to AI. Run the mapping seed (npm run mapping:seed -- --apply) against this database, or set MAPPING_ENGINE=legacy.");
      }
    } catch (err) {
      console.error("[Mapping engine] Failed to load the mapping snapshot at startup (lookups will retry per request):", err);
    }
  }
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
