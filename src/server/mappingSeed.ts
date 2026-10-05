/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, sql } from "drizzle-orm";
import type { AnyDb } from "./db/client.js";
import { categories, mappingState, pedAliases, pedMappingOverrides, pedRepository, routingRules } from "./db/schema.js";
import { PedRepositoryRepository } from "./db/repositories/pedRepositoryRepository.js";
import { normalizeDictionaryKey } from "../mapping/helpers.js";
import { LEGACY_RULE_SEED } from "../mapping/legacyRuleSeed.js";
import { planSeed, type AliasException, type MappingDump, type SeedPlan } from "../mapping/seedBuilder.js";

/**
 * Mapping-control Phase 2 seed: derives, from an environment's own data, the
 * routing_rules rows and the per-alias compatibility controls that make the
 * DB-backed engine reproduce that environment's current production behaviour
 * exactly (see src/mapping/seedBuilder.ts). Strictly additive: no existing PED,
 * alias text, category, plan config or override is deleted or altered — the
 * only writes are new routing_rules rows, the three new ped_aliases columns,
 * a few new PED/alias rows for dictionary keys that had no alias row, and a
 * mapping_state version bump.
 *
 * Generated per environment from that environment's own snapshot (never
 * copied between environments).
 */

export interface SeedReport {
  mode: "dry-run" | "applied" | "skipped-already-seeded";
  rules: number;
  counts: SeedPlan["counts"];
  exceptions: AliasException[];
  newPeds: SeedPlan["newPeds"];
}

export async function readSeedInputs(db: AnyDb): Promise<MappingDump> {
  const [pedRows, aliasRows, categoryRows, overrideRows] = await Promise.all([
    db.select().from(pedRepository),
    // Explicit column list (not select-all): a dry run must work BEFORE migration 0085 has added the new alias columns.
    db
      .select({ id: pedAliases.id, pedId: pedAliases.pedId, aliasText: pedAliases.aliasText, normalizedAlias: pedAliases.normalizedAlias, isPrimary: pedAliases.isPrimary, isVisible: pedAliases.isVisible })
      .from(pedAliases),
    db.select().from(categories),
    db.select().from(pedMappingOverrides),
  ]);
  return {
    planConfigs: [],
    categories: categoryRows.map((c) => ({ categoryKey: c.categoryKey, label: c.label })),
    pedRepository: pedRows.map((p) => ({ id: p.id, pedCode: p.pedCode, canonicalName: p.canonicalName, categoryKey: p.categoryKey, status: p.status })),
    pedAliases: aliasRows.map((a) => ({ id: a.id, pedId: a.pedId, aliasText: a.aliasText, normalizedAlias: a.normalizedAlias, isPrimary: a.isPrimary, isVisible: a.isVisible })),
    planOverrides: [],
    planRestrictions: [],
    pedMappingOverrides: overrideRows.map((o) => ({ pedText: o.pedText, category: o.category })),
  };
}

export async function applyMappingSeed(db: AnyDb, opts: { apply: boolean; force?: boolean; addedBy: string }): Promise<SeedReport> {
  const dump = await readSeedInputs(db);
  const plan = planSeed(dump);
  const base = { rules: LEGACY_RULE_SEED.length, counts: plan.counts, exceptions: plan.exceptions, newPeds: plan.newPeds };
  if (!opts.apply) return { mode: "dry-run", ...base };

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: routingRules.id }).from(routingRules).limit(1);
    if (existing.length > 0 && !opts.force) return { mode: "skipped-already-seeded" as const, ...base };

    for (const rule of LEGACY_RULE_SEED) {
      const values = {
        ruleKey: rule.ruleKey,
        kind: rule.kind,
        stage: rule.stage,
        primitive: rule.primitive,
        position: rule.position,
        planScope: rule.planScope,
        enabled: rule.enabled,
        description: rule.description,
        definition: rule.definition,
      };
      await tx.insert(routingRules).values(values).onConflictDoUpdate({ target: routingRules.ruleKey, set: { ...values, updatedAt: new Date() } });
    }

    for (const ex of plan.exceptions) {
      if (ex.newPed || ex.aliasId === null) continue;
      await tx
        .update(pedAliases)
        .set({ routingEnabled: ex.routingEnabled, categoryKeyOverride: ex.categoryOverride, fallbackCategoryKey: ex.fallbackCategory })
        .where(eq(pedAliases.id, ex.aliasId));
    }

    const pedRepo = new PedRepositoryRepository(tx as unknown as AnyDb);
    for (const n of plan.newPeds) {
      const ex = plan.exceptions.find((e) => e.newPed && e.normalizedAlias === n.normalizedAlias);
      const ped = await pedRepo.create({
        canonicalName: n.canonicalName,
        categoryKey: n.categoryKey,
        status: "approved",
        notes: "Added by the mapping-control seed to reproduce an existing production dictionary entry.",
        addedBy: opts.addedBy,
      });
      await tx.insert(pedAliases).values({
        pedId: ped.id,
        aliasText: n.aliasText,
        normalizedAlias: normalizeDictionaryKey(n.aliasText),
        isPrimary: true,
        isVisible: true,
        routingEnabled: true,
        categoryKeyOverride: null,
        fallbackCategoryKey: ex?.fallbackCategory ?? null,
        addedBy: opts.addedBy,
      });
    }

    await tx
      .insert(mappingState)
      .values({ id: 1, version: 2 })
      .onConflictDoUpdate({ target: mappingState.id, set: { version: sql`${mappingState.version} + 1`, updatedAt: sql`now()` } });
    return { mode: "applied" as const, ...base };
  });
}
