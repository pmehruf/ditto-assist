/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "./db/repositories/index.js";
import type { AliasEntry, MappingSnapshot } from "../mapping/ruleTypes.js";

/**
 * Runtime loader for the mapping-control snapshot (mapping-control Phase 2).
 *
 * The data-driven engine (src/mapping/routingEngine.ts) is a pure function of
 * a MappingSnapshot. This module builds that snapshot from the database and
 * keeps one per process — but unlike the old pedRuntimeCache it never trusts
 * its own copy blindly: every call first reads the single-row
 * `mapping_state.version` (one indexed query) and rebuilds the snapshot only
 * when the number changed. Every mapping write bumps that number, so an edit
 * made on any server instance reaches every other instance on its very next
 * lookup — no restart, publish step, manual cache clear, or cross-instance
 * messaging.
 *
 * Staleness safety: the version is read BEFORE the data, and writers commit
 * their data before bumping, so a snapshot is never older than the version
 * it is labelled with (at worst it is newer, which just costs one extra
 * reload on the next lookup).
 */

type SnapshotRepos = Pick<Repositories, "mappingState" | "routingRules" | "pedAliases" | "pedRepository" | "categories">;

export async function loadMappingSnapshot(repos: SnapshotRepos, version: number): Promise<MappingSnapshot> {
  const [aliasRows, pedRows, categoryRows, steps] = await Promise.all([
    repos.pedAliases.listAll(),
    repos.pedRepository.list(),
    repos.categories.list(),
    repos.routingRules.listEnabled(),
  ]);
  const categoryByPedId = new Map(pedRows.map((p) => [p.id, p.categoryKey] as const));
  const aliases = new Map<string, AliasEntry>();
  const chainByPedId = new Map<number, string[]>();
  for (const p of pedRows) {
    const chain = (p as { categoryChain?: unknown }).categoryChain;
    if (Array.isArray(chain) && chain.length > 0) chainByPedId.set(p.id, chain.filter((c): c is string => typeof c === "string"));
  }
  for (const a of aliasRows) {
    const entry: AliasEntry = {
      pedId: a.pedId,
      pedCategory: categoryByPedId.get(a.pedId) ?? null,
      routingEnabled: a.routingEnabled,
      categoryOverride: a.categoryKeyOverride ?? null,
      fallbackCategory: a.fallbackCategoryKey ?? null,
    };
    // Only PEDs that actually have a chain carry the field, so every other entry is exactly what it was before R11.
    const chain = chainByPedId.get(a.pedId);
    if (chain) entry.categoryChain = chain;
    aliases.set(a.normalizedAlias, entry);
  }
  return {
    version,
    categoryLabels: new Map(categoryRows.map((c) => [c.categoryKey, c.label] as const)),
    aliases,
    steps,
  };
}

/**
 * One snapshot cache per server instance. `get()` compares the database's
 * mapping version against its own and reloads when they differ. Tests create
 * several providers over one database to simulate several instances.
 */
export function createMappingSnapshotProvider(repos: SnapshotRepos) {
  let cached: MappingSnapshot | null = null;
  let inFlight: { version: number; promise: Promise<MappingSnapshot> } | null = null;
  return {
    async get(): Promise<MappingSnapshot> {
      const version = await repos.mappingState.getVersion();
      if (cached && cached.version === version) return cached;
      if (inFlight && inFlight.version === version) return inFlight.promise;
      const promise = loadMappingSnapshot(repos, version)
        .then((snap) => {
          cached = snap;
          return snap;
        })
        .finally(() => {
          if (inFlight && inFlight.promise === promise) inFlight = null;
        });
      inFlight = { version, promise };
      return promise;
    },
  };
}

let defaultProvider: ReturnType<typeof createMappingSnapshotProvider> | null = null;

/** The process-wide snapshot, reloaded first if any instance bumped the version since the last lookup. */
export function getMappingSnapshot(repos: SnapshotRepos): Promise<MappingSnapshot> {
  if (!defaultProvider) defaultProvider = createMappingSnapshotProvider(repos);
  return defaultProvider.get();
}
