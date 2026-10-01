/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { getTableColumns, type Table } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import type { AnyDb } from "./db/client.js";
import { dbScope } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { mappingChangeSets, mappingState, pedAliases, pedRepository, planConfigs, planOverrides, planRestrictions, searchHistory } from "./db/schema.js";
import { loadMappingSnapshot } from "./mappingSnapshot.js";
import { dbRowToPlanConfig, toPlanPedOverrides, toPlanRestrictions } from "./planConfigUtils.js";
import { normalizeDictionaryKey } from "../engine.js";
import { compareWorlds, type ImpactReport, type Usage, type World } from "../mapping/impact.js";
import type { PlanConfig } from "../types.js";

/**
 * Phase 3B-i — the safety backbone for admin mapping writes.
 *
 * Every admin route that can change a routing result is wrapped by `mappingGate`.
 * The wrapper runs the route's own, unmodified logic inside ONE database
 * transaction (every `getDb()` call in the route resolves to that transaction via
 * AsyncLocalStorage), then:
 *
 *   - measures the impact by running the real engine over the before/after worlds
 *     (src/mapping/impact.ts),
 *   - PREVIEW (header X-Mapping-Preview: 1): rolls everything back and returns the impact,
 *   - APPLY: refuses a route error, requires the change-control fields, requires the
 *     caller to have confirmed the exact previewed impact when it is elevated/high,
 *     records a change set with row-level before/after, bumps the mapping version and
 *     commits.
 *
 * Because preview and apply execute the very same route code, they cannot disagree.
 * Everything is serialised on the single `mapping_state` row (FOR UPDATE) so two
 * admins can never apply overlapping changes against stale impact numbers.
 */

// ── change-control fields (Constitution Part XI step 4 / Part XIV) ───────────

export const CHANGE_CATEGORIES = [
  "New synonym",
  "New canonical condition",
  "Dictionary update",
  "Regex update",
  "Shield update",
  "New category",
  "Plan override",
  "Fallback update",
  "Regression fix",
] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

export interface ChangeControl {
  reason: string;
  changeCategory: ChangeCategory;
  /** "none" = no Business Decision (Part IX) is involved; otherwise "approved: <who / reference>". */
  businessDecision: string;
  /** Hash of the impact the admin confirmed in the preview (required when impact is elevated/high). */
  confirmHash?: string;
}

export function parseChangeControl(raw: string | undefined): { ok: true; value: ChangeControl } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Change details are required: a reason, a change category and the Business-Decision check." };
  let v: any;
  try {
    v = JSON.parse(decodeURIComponent(raw));
  } catch {
    return { ok: false, error: "The change details could not be read." };
  }
  const reason = typeof v?.reason === "string" ? v.reason.trim() : "";
  if (reason.length < 8) return { ok: false, error: "Give a reason for this change (at least a short sentence)." };
  if (!CHANGE_CATEGORIES.includes(v?.changeCategory)) return { ok: false, error: "Choose a valid change category." };
  const bd = typeof v?.businessDecision === "string" ? v.businessDecision.trim() : "";
  if (bd !== "none" && !/^approved:\s*\S+/i.test(bd)) return { ok: false, error: 'Business-Decision check: choose "none involved" or record who approved it.' };
  return { ok: true, value: { reason, changeCategory: v.changeCategory, businessDecision: bd, confirmHash: typeof v?.confirmHash === "string" ? v.confirmHash : undefined } };
}

// ── row-level before/after capture ─────────────────────────────────────────

interface TableSpec {
  name: string;
  table: Table;
  pk: string[];
}

/** Order matters for undo: parents before children. */
export const MAPPING_TABLES: TableSpec[] = [
  { name: "ped_repository", table: pedRepository, pk: ["id"] },
  { name: "ped_aliases", table: pedAliases, pk: ["id"] },
  { name: "plan_configs", table: planConfigs, pk: ["planName"] },
  { name: "plan_overrides", table: planOverrides, pk: ["id"] },
  { name: "plan_restrictions", table: planRestrictions, pk: ["id"] },
];

type Row = Record<string, unknown>;

export interface RowOp {
  table: string;
  op: "insert" | "update" | "delete";
  pk: Record<string, unknown>;
  before: Row | null;
  after: Row | null;
}

const canon = (row: unknown): string =>
  JSON.stringify(row, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

const toJsonRow = (row: unknown): Row => JSON.parse(JSON.stringify(row));

export async function captureTables(db: AnyDb): Promise<Map<string, Map<string, Row>>> {
  const out = new Map<string, Map<string, Row>>();
  for (const spec of MAPPING_TABLES) {
    const rows = (await db.select().from(spec.table as any)) as Row[];
    out.set(spec.name, new Map(rows.map((r) => [spec.pk.map((k) => String(r[k])).join("|"), toJsonRow(r)] as const)));
  }
  return out;
}

export function diffTables(before: Map<string, Map<string, Row>>, after: Map<string, Map<string, Row>>): RowOp[] {
  const ops: RowOp[] = [];
  for (const spec of MAPPING_TABLES) {
    const b = before.get(spec.name)!;
    const a = after.get(spec.name)!;
    const pkOf = (r: Row) => Object.fromEntries(spec.pk.map((k) => [k, r[k]]));
    for (const [key, row] of a) {
      const prev = b.get(key);
      if (!prev) ops.push({ table: spec.name, op: "insert", pk: pkOf(row), before: null, after: row });
      else if (canon(prev) !== canon(row)) ops.push({ table: spec.name, op: "update", pk: pkOf(row), before: prev, after: row });
    }
    for (const [key, row] of b) if (!a.has(key)) ops.push({ table: spec.name, op: "delete", pk: pkOf(row), before: row, after: null });
  }
  return ops;
}

function specFor(name: string): TableSpec {
  const spec = MAPPING_TABLES.find((t) => t.name === name);
  if (!spec) throw new Error(`Unknown mapping table in change set: ${name}`);
  return spec;
}

/** JSON → driver values (ISO strings back to Dates for timestamp columns). */
function hydrate(spec: TableSpec, row: Row): Row {
  const cols = getTableColumns(spec.table) as Record<string, { dataType: string }>;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = cols[k]?.dataType === "date" && typeof v === "string" ? new Date(v) : v;
  return out;
}

function pkWhere(spec: TableSpec, pk: Record<string, unknown>) {
  const cols = getTableColumns(spec.table) as Record<string, any>;
  return and(...spec.pk.map((k) => eq(cols[k], pk[k] as any)))!;
}

async function currentRow(db: AnyDb, spec: TableSpec, pk: Record<string, unknown>): Promise<Row | null> {
  const [row] = (await db.select().from(spec.table as any).where(pkWhere(spec, pk))) as Row[];
  return row ? toJsonRow(row) : null;
}

// ── generic undo ───────────────────────────────────────────────────────────

export type UndoResult = { reverted: true; changeSetId: number; opsReverted: number } | { reverted: false; changeSetId?: number; reason: string };

class Refused extends Error {}

async function lockMappingState(tx: AnyDb): Promise<void> {
  await tx.insert(mappingState).values({ id: 1, version: 1 }).onConflictDoNothing();
  await tx.execute(sql`select version from mapping_state where id = 1 for update`);
}

/**
 * Undo of a Phase 3B change set. Restores the recorded rows exactly. Refuses —
 * never forces — if any affected row has changed since the change was applied.
 */
export async function undoAdminChange(db: AnyDb, changeSetId: number, performedBy: string, note?: string): Promise<UndoResult> {
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as AnyDb;
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await lockMappingState(tx);
      const repos = createRepositories(tx);
      const cs = await repos.mappingChangeSets.get(changeSetId);
      if (!cs) throw new Refused("That change was not found.");
      if (cs.status !== "applied") throw new Refused(cs.status === "undone" ? "That change has already been undone." : "That change did not take effect, so there is nothing to undo.");
      const ops = cs.ops as RowOp[];
      if (!Array.isArray(ops) || ops.some((o) => !o?.table)) throw new Refused("That change cannot be undone here.");

      // Precondition: every touched row is still exactly as the change left it.
      for (const o of ops) {
        const spec = specFor(o.table);
        const cur = await currentRow(tx, spec, o.pk);
        if (o.op === "delete" ? cur !== null : cur === null || canon(cur) !== canon(o.after)) {
          throw new Refused("This mapping was changed after it was applied. Change it in the PED Library instead.");
        }
      }
      // Inverse, in an FK-safe order: remove created rows (children first), restore deleted rows (parents first), revert updates.
      const order = MAPPING_TABLES.map((t) => t.name);
      const created = ops.filter((o) => o.op === "insert").sort((a, b) => order.indexOf(b.table) - order.indexOf(a.table));
      const deleted = ops.filter((o) => o.op === "delete").sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
      const updated = ops.filter((o) => o.op === "update");
      for (const o of updated) {
        const spec = specFor(o.table);
        await tx.update(spec.table as any).set(hydrate(spec, o.before!) as any).where(pkWhere(spec, o.pk));
      }
      for (const o of created) {
        const spec = specFor(o.table);
        await tx.delete(spec.table as any).where(pkWhere(spec, o.pk));
      }
      for (const o of deleted) {
        const spec = specFor(o.table);
        await tx.insert(spec.table as any).values(hydrate(spec, o.before!) as any);
      }
      await repos.mappingState.bump();
      await repos.mappingChangeSets.setStatus(changeSetId, "undone", { undoneBy: performedBy, undoNote: note });
      return { reverted: true as const, changeSetId, opsReverted: ops.length };
    });
  } catch (err) {
    if (err instanceof Refused) return { reverted: false, changeSetId, reason: err.message };
    throw err;
  }
}

// ── worlds & usage ──────────────────────────────────────────────────────────

export async function loadWorld(db: AnyDb): Promise<World> {
  const repos = createRepositories(db);
  const version = await repos.mappingState.getVersion();
  const snapshot = await loadMappingSnapshot(repos, version);
  const plans = new Map<string, PlanConfig>();
  const [rows, restrictions] = await Promise.all([repos.planConfigs.list(), repos.planRestrictions.listAllActive()]);
  for (const row of rows) {
    if ((row as any).removed) continue;
    const config = dbRowToPlanConfig(row) as PlanConfig;
    config.restrictions = toPlanRestrictions(restrictions.filter((r) => r.planName === row.planName));
    config.pedOverrides = toPlanPedOverrides(await repos.planOverrides.listDetailed(row.planName));
    plans.set(row.planName, config);
  }
  return { snapshot, plans };
}

const USAGE_WINDOW_DAYS = 90;
const USAGE_TTL_MS = 10 * 60 * 1000;
const MAX_USAGE_TERMS = 5000;
let usageCache: { at: number; usage: Usage; terms: string[] } | null = null;

export function resetUsageCache(): void {
  usageCache = null;
}

/** What advisors actually searched in the last 90 days (cached per instance for 10 minutes). */
export async function loadUsage(db: AnyDb): Promise<{ usage: Usage; terms: string[] }> {
  if (usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return usageCache;
  const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db
    .select({ planName: searchHistory.planName, pedInput: searchHistory.pedInput, n: sql<number>`count(*)::int` })
    .from(searchHistory)
    .where(gte(searchHistory.timestamp, since))
    .groupBy(searchHistory.planName, searchHistory.pedInput);
  const usage: Usage = { byTerm: {}, byPair: {} };
  const termCount = new Map<string, number>();
  for (const r of rows) {
    const key = normalizeDictionaryKey(r.pedInput);
    const n = Number(r.n);
    usage.byTerm[key] = (usage.byTerm[key] ?? 0) + n;
    usage.byPair[`${r.planName}||${key}`] = (usage.byPair[`${r.planName}||${key}`] ?? 0) + n;
    termCount.set(r.pedInput, (termCount.get(r.pedInput) ?? 0) + n);
  }
  const terms = [...termCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_USAGE_TERMS).map(([t]) => t);
  usageCache = { at: Date.now(), usage, terms };
  return usageCache;
}

export interface ImpactResult {
  report: ImpactReport;
  /** Identifies exactly which lookups change and how; an admin confirms this value. */
  hash: string;
}

export async function measureImpact(before: World, after: World, usageSource: { usage: Usage; terms: string[] }): Promise<ImpactResult> {
  const corpus = [...new Set<string>([...before.snapshot.aliases.keys(), ...after.snapshot.aliases.keys(), ...usageSource.terms])];
  const report = compareWorlds(before, after, corpus, usageSource.usage);
  return { report, hash: createHash("sha256").update(report.fingerprint).digest("hex").slice(0, 24) };
}

// ── the gate ───────────────────────────────────────────────────────────────

export interface GateDeps {
  /** True only when MAPPING_ENGINE=db and MAPPING_IMPACT_GATE=on. */
  enabled(): boolean;
  /** The root (non-transaction) database. */
  rootDb(): AnyDb;
  /** "Name (tier)" of the caller, for the audit trail. */
  performer(req: Request): Promise<string>;
}

class Rollback extends Error {
  constructor(public readonly outcome: { status: number; body: unknown }) {
    super("rollback");
  }
}

interface Captured {
  status: number;
  body: unknown;
}

const HANDLER_TIMEOUT_MS = 25_000;

function captureResponse(res: Response, run: () => void): Promise<Captured> {
  return new Promise<Captured>((resolve) => {
    let done = false;
    const originals = { json: res.json, send: res.send, end: res.end };
    const finish = (body: unknown) => {
      if (done) return res;
      done = true;
      clearTimeout(timer);
      Object.assign(res, originals);
      resolve({ status: res.statusCode, body });
      return res;
    };
    const timer = setTimeout(() => {
      res.statusCode = 504;
      finish({ error: "The change took too long and was cancelled; nothing was saved." });
    }, HANDLER_TIMEOUT_MS);
    (res as any).json = (body: unknown) => finish(body);
    (res as any).send = (body: unknown) => finish(typeof body === "string" ? safeParse(body) : body);
    (res as any).end = (body?: unknown) => finish(typeof body === "string" ? safeParse(body) : body ?? null);
    run();
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { message: s };
  }
}

const tierRank = { none: 0, low: 1, elevated: 2, high: 3 } as const;

/** Route middleware factory: `app.patch(path, requireAuth, mappingGate("summary text"), handler)`. */
export function createMappingGate(deps: GateDeps) {
  return (describe: string) => async (req: Request, res: Response, next: NextFunction) => {
    const preview = req.get("x-mapping-preview") === "1";
    if (!deps.enabled()) {
      // Never let a preview request fall through to a real write.
      if (preview) return res.status(409).json({ error: "Impact preview is not enabled on this server.", code: "preview_unavailable" });
      return next();
    }
    // The change-control fields are only demanded once the route has actually changed something (a save that
    // changes nothing needs no reason).
    let control: ChangeControl | undefined;
    let controlError = "";
    if (!preview) {
      const parsed = parseChangeControl(req.get("x-mapping-change") ?? undefined);
      if (parsed.ok === false) controlError = parsed.error;
      else control = parsed.value;
    }
    const root = deps.rootDb();
    try {
      const performedBy = await deps.performer(req);
      const usageSource = await loadUsage(root);
      let sent: { status: number; body: unknown } | undefined;
      try {
        const afterCommit: Array<() => void> = [];
        await root.transaction(async (txRaw) => {
          const tx = txRaw as unknown as AnyDb;
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await lockMappingState(tx);
          const repos = createRepositories(tx);
          const versionBefore = await repos.mappingState.getVersion();
          const [tablesBefore, worldBefore] = await Promise.all([captureTables(tx), loadWorld(tx)]);

          const captured = await dbScope.run({ db: tx, afterCommit }, () => captureResponse(res, () => next()));
          if (captured.status >= 400) throw new Rollback({ status: captured.status, body: preview ? { preview: true, ...asObject(captured.body) } : captured.body });

          const tablesAfter = await captureTables(tx);
          const ops = diffTables(tablesBefore, tablesAfter);
          if (ops.length === 0) throw new Rollback({ status: captured.status, body: preview ? { preview: true, impact: null, tier: "none", changes: 0, response: captured.body } : captured.body });

          const worldAfter = await loadWorld(tx);
          const { report, hash } = await measureImpact(worldBefore, worldAfter, usageSource);
          // A save that changes no lookup result (e.g. disabling a plan, editing its illness list) is still audited and
          // undoable but needs no reason/confirmation; anything that changes a result must carry the change-control fields.
          if (!preview && report.tier !== "none" && !control) throw new Rollback({ status: 400, body: { error: controlError, code: "change_control_required" } });
          const summary = { ops: ops.length, tables: [...new Set(ops.map((o) => o.table))] };

          if (preview) {
            throw new Rollback({ status: 200, body: { preview: true, tier: report.tier, reasons: report.reasons, impact: report, impactHash: hash, changes: summary, response: captured.body } });
          }
          if (tierRank[report.tier] >= tierRank.elevated && control?.confirmHash !== hash) {
            throw new Rollback({
              status: 409,
              body: { error: "This change affects many lookups. Review the impact and confirm it.", code: "impact_confirmation_required", tier: report.tier, reasons: report.reasons, impact: report, impactHash: hash },
            });
          }
          const versionNow = await repos.mappingState.getVersion();
          const version = versionNow === versionBefore ? await repos.mappingState.bump() : versionNow;
          const cs = await repos.mappingChangeSets.create({
            kind: "admin_change",
            summary: describe,
            status: "applied",
            ops,
            verification: { snapshotVersion: version },
            performedBy,
            reason: control?.reason ?? null,
            changeCategory: control?.changeCategory ?? null,
            businessDecision: control?.businessDecision ?? null,
            impactTier: report.tier,
            impact: { metrics: report.metrics, reasons: report.reasons, hash },
          });
          const body = captured.body && typeof captured.body === "object" && !Array.isArray(captured.body) ? { ...(captured.body as object), mappingChange: { id: cs.id, tier: report.tier, pairsChanged: report.metrics.pairsChanged } } : captured.body;
          sent = { status: captured.status, body };
        });
        for (const fn of afterCommit) fn();
      } catch (err) {
        if (err instanceof Rollback) sent = err.outcome;
        else throw err;
      }
      return res.status(sent!.status).json(sent!.body);
    } catch (err: any) {
      console.error("Mapping change gate failed (nothing was saved):", err);
      if (!res.headersSent) return res.status(500).json({ error: `Nothing was saved: ${err.cause?.message || err.message}` });
    }
  };
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { message: v };
}
