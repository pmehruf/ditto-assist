/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, eq, inArray } from "drizzle-orm";
import { categories, pedAliases, pedRepository, planConfigs, planOverrides, planRestrictions, pedMappingOverrides } from "./db/schema.js";
import { createRepositories } from "./db/repositories/index.js";
import { createMappingSnapshotProvider } from "./mappingSnapshot.js";
import { corpusTerms, newEngineOutcome, planConfigsFromDump, primaryKey, strictHash } from "../mapping/equalityHarness.js";
import type { MappingDump } from "../mapping/seedBuilder.js";

/**
 * Declaration Assist suggestion cleanup: the ONLY data change is `ped_aliases.is_visible = false` for an approved list of names.
 * The routing engine never reads `is_visible`, so a hidden name resolves exactly as before; the suggestion list
 * (`GET /api/ped-repository/autocomplete`) is the only thing that loses it. Nothing is merged, deleted, renamed or recategorised.
 */

export type HideGroup = "A" | "B1" | "NON_MEDICAL";

export interface HideItem {
  id: number;
  text: string;
  normalized: string;
  group: HideGroup;
  /** The condition the name belongs to when the plan was made (null = its condition was already deleted). */
  pedId: number | null;
  /** NON_MEDICAL names that belong to a condition: the category that made them non-medical. */
  category: string | null;
  /** Groups A and B1: the alias that stays visible instead of this one. Never hide a name whose replacement is gone or hidden. */
  keeperId: number | null;
  keeperText: string | null;
}

export interface HidePlan {
  version: 1;
  madeFrom: { environment: string; capturedAt: string };
  expectedVisibleBefore: number;
  expectedVisibleAfter: number;
  items: HideItem[];
}

// The drizzle handle (or a transaction on it); typed loosely because both are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDbHandle = any;

export interface Problem { item: HideItem; why: string }
export interface Check {
  toHide: HideItem[];
  alreadyHidden: HideItem[];
  problems: Problem[];
  visibleNow: number;
  expectedVisibleAfter: number;
}

export async function checkPlan(db: AnyDbHandle, plan: HidePlan): Promise<Check> {
  const aliasRows = await db.select().from(pedAliases);
  const pedRows = await db.select().from(pedRepository);
  const aliasById = new Map<number, (typeof aliasRows)[number]>(aliasRows.map((a: { id: number }) => [a.id, a]));
  const pedById = new Map<number, (typeof pedRows)[number]>(pedRows.map((p: { id: number }) => [p.id, p]));
  const check: Check = { toHide: [], alreadyHidden: [], problems: [], visibleNow: aliasRows.filter((a: { isVisible: boolean }) => a.isVisible).length, expectedVisibleAfter: 0 };
  const hidingIds = new Set(plan.items.map((i) => i.id));
  for (const item of plan.items) {
    const row = aliasById.get(item.id);
    if (!row) { check.problems.push({ item, why: "the name no longer exists" }); continue; }
    if (row.aliasText !== item.text || row.normalizedAlias !== item.normalized) { check.problems.push({ item, why: `the name changed (now "${row.aliasText}")` }); continue; }
    if (item.pedId === null) {
      if (pedById.has(row.pedId)) { check.problems.push({ item, why: "its condition exists again, so it is no longer an orphan" }); continue; }
    } else {
      if (row.pedId !== item.pedId) { check.problems.push({ item, why: "it now belongs to a different condition" }); continue; }
      const ped = pedById.get(row.pedId);
      if (item.group === "NON_MEDICAL" && ped?.categoryKey !== item.category) { check.problems.push({ item, why: `its condition's category is now ${ped?.categoryKey ?? "none"}, not ${item.category}` }); continue; }
    }
    if (item.group !== "NON_MEDICAL") {
      const keeper = item.keeperId ? aliasById.get(item.keeperId) : undefined;
      if (!keeper || !keeper.isVisible || hidingIds.has(keeper.id)) { check.problems.push({ item, why: `the name that should stay visible ("${item.keeperText}") is missing, hidden or also being hidden` }); continue; }
    }
    if (!row.isVisible) check.alreadyHidden.push(item);
    else check.toHide.push(item);
  }
  check.expectedVisibleAfter = check.visibleNow - check.toHide.length;
  return check;
}

/** Every plan's answer for each listed name, computed the way the live server computes it (same snapshot loader and plan configs). */
export async function captureAnswers(db: AnyDbHandle, texts: string[]): Promise<Record<string, string>> {
  const [plans, cats, peds, aliasRows, overrides, restrictions, legacy] = await Promise.all([
    db.select().from(planConfigs),
    db.select().from(categories),
    db.select().from(pedRepository),
    db.select({ id: pedAliases.id, pedId: pedAliases.pedId, aliasText: pedAliases.aliasText, normalizedAlias: pedAliases.normalizedAlias, isPrimary: pedAliases.isPrimary, isVisible: pedAliases.isVisible }).from(pedAliases),
    db.select().from(planOverrides),
    db.select().from(planRestrictions),
    db.select().from(pedMappingOverrides),
  ]);
  const dump = {
    planConfigs: plans,
    categories: cats.map((c: { categoryKey: string; label: string }) => ({ categoryKey: c.categoryKey, label: c.label })),
    pedRepository: peds.map((p: { id: number; pedCode: string; canonicalName: string; categoryKey: string | null; status: string }) => ({ id: p.id, pedCode: p.pedCode, canonicalName: p.canonicalName, categoryKey: p.categoryKey, status: p.status })),
    pedAliases: aliasRows,
    planOverrides: overrides,
    planRestrictions: restrictions,
    pedMappingOverrides: legacy.map((o: { pedText: string; category: string }) => ({ pedText: o.pedText, category: o.category })),
  } as unknown as MappingDump;
  if (!plans.length) throw new Error("No plan configs were found, so no answers can be checked. Stopping.");
  const snapshot = await createMappingSnapshotProvider(createRepositories(db)).get();
  const out: Record<string, string> = {};
  for (const { planName, config } of planConfigsFromDump(dump)) {
    for (const t of texts) {
      const o = newEngineOutcome(t, planName, config, snapshot);
      out[`${planName}||${t}`] = `${primaryKey(o)}#${strictHash(o)}`;
    }
  }
  return out;
}

export { corpusTerms };

export interface Backup {
  takenAt: string;
  visibleBefore: number;
  mappingVersionBefore: number | null;
  /** Full rows of every name being changed, exactly as they were. */
  rows: Array<Record<string, unknown>>;
}

export async function makeBackup(db: AnyDbHandle, items: HideItem[]): Promise<Backup> {
  const rows = items.length ? await db.select().from(pedAliases).where(inArray(pedAliases.id, items.map((i) => i.id))) : [];
  const visible = (await db.select({ id: pedAliases.id }).from(pedAliases).where(eq(pedAliases.isVisible, true))).length;
  let version: number | null = null;
  try {
    version = await createRepositories(db).mappingState.getVersion();
  } catch {
    version = null;
  }
  return { takenAt: new Date().toISOString(), visibleBefore: visible, mappingVersionBefore: version, rows: rows as Array<Record<string, unknown>> };
}

export interface ApplyResult { hidden: number; visibleAfter: number; mappingVersion: number }

/** One transaction: hide exactly the checked names, then bump the mapping version so running servers reload. */
export async function applyHide(db: AnyDbHandle, items: HideItem[]): Promise<ApplyResult> {
  return db.transaction(async (tx: AnyDbHandle) => {
    const updated = items.length
      ? await tx.update(pedAliases).set({ isVisible: false }).where(and(inArray(pedAliases.id, items.map((i) => i.id)), eq(pedAliases.isVisible, true))).returning({ id: pedAliases.id })
      : [];
    if (updated.length !== items.length) throw new Error(`Expected to hide ${items.length} names but ${updated.length} changed; rolled back.`);
    const version = await createRepositories(tx).mappingState.bump();
    const visibleAfter = (await tx.select({ id: pedAliases.id }).from(pedAliases).where(eq(pedAliases.isVisible, true))).length;
    return { hidden: updated.length, visibleAfter, mappingVersion: version };
  });
}

/** Puts back exactly the names the backup shows as visible, in one transaction, and bumps the mapping version. */
export async function rollbackHide(db: AnyDbHandle, backup: Backup): Promise<ApplyResult> {
  const ids = backup.rows.filter((r) => r.isVisible === true).map((r) => Number(r.id));
  return db.transaction(async (tx: AnyDbHandle) => {
    const updated = ids.length ? await tx.update(pedAliases).set({ isVisible: true }).where(inArray(pedAliases.id, ids)).returning({ id: pedAliases.id }) : [];
    if (updated.length !== ids.length) throw new Error(`Expected to restore ${ids.length} names but ${updated.length} were found; rolled back.`);
    const version = await createRepositories(tx).mappingState.bump();
    const visibleAfter = (await tx.select({ id: pedAliases.id }).from(pedAliases).where(eq(pedAliases.isVisible, true))).length;
    return { hidden: 0, visibleAfter, mappingVersion: version };
  });
}
