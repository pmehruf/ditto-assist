/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeDictionaryKey } from "../engine.js";
import { promotePedMappingOverride, unmapPedMappingOverride } from "./pedMappingLive.js";
import { updateDbAliasCache, removeDbAliasCache, updateDbPedCategoryCache } from "./pedRuntimeCache.js";
import type { Repositories } from "./db/repositories/index.js";
import type { PedRepositoryRow, PedAliasRow } from "./db/schema.js";

/**
 * Write-path orchestration for `ped_repository` / `ped_aliases` — the
 * "wire admin edits to actually be the source of truth" half of the PED
 * Repository migration (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §4;
 * pedRuntimeCache.ts's "Known gap" comment). Mirrors the exact pattern
 * pedMappingLive.ts already established for the legacy `ped_mapping_overrides`
 * table: every function here does the DB write, then updates
 * pedRuntimeCache.ts's in-memory Maps in place before returning, so
 * `classifyDeterministic` sees the change on the very next request with no
 * restart.
 *
 * Decision (2026-07-29, confirmed with the user): every write ALSO mirrors
 * into the legacy `ped_mapping_overrides` table via
 * promotePedMappingOverride/unmapPedMappingOverride, keyed on each alias's
 * literal text (not just the canonical name). This is pure rollback
 * insurance — flipping `PED_SOURCE` back to "legacy" in .env (a same-restart,
 * no-deploy action) then still resolves every alias variant added or edited
 * through the new PED Repository UI, not just whatever was in the legacy
 * table at cutover. A mirror failure is logged and swallowed, never allowed
 * to fail the caller's actual edit — the new-schema write above it is always
 * the one that already succeeded.
 */

type Repos = Pick<Repositories, "pedRepository" | "pedAliases" | "pedMappingOverrides">;

export interface CreatePedInput {
  canonicalName: string;
  categoryKey: string | null;
  status?: "draft" | "approved" | "deprecated";
  notes?: string | null;
  addedBy: string;
}

/**
 * Creates a new `ped_repository` row plus its primary/visible alias
 * (aliasText mirrors canonicalName, matching seed-time convention). Defaults
 * `status` to "approved" — unlike an AI-suggested draft, a term an admin
 * types directly into this page is meant to take effect immediately, the
 * same as every other admin write path in this app.
 */
export async function createPedWithPrimaryAlias(
  repos: Repos,
  input: CreatePedInput
): Promise<{ ped: PedRepositoryRow; alias: PedAliasRow }> {
  const ped = await repos.pedRepository.create({
    canonicalName: input.canonicalName,
    categoryKey: input.categoryKey,
    status: input.status ?? "approved",
    notes: input.notes ?? null,
    addedBy: input.addedBy,
  });
  const alias = await repos.pedAliases.create({
    pedId: ped.id,
    aliasText: input.canonicalName,
    isPrimary: true,
    isVisible: true,
    addedBy: input.addedBy,
  });
  updateDbAliasCache(alias.normalizedAlias, ped.id, ped.categoryKey);

  if (ped.categoryKey) {
    try {
      await promotePedMappingOverride(repos.pedMappingOverrides, input.canonicalName, ped.categoryKey, input.addedBy);
    } catch (err) {
      console.error("Failed to mirror new PED into legacy mapping overrides (rollback safety net):", err);
    }
  }

  return { ped, alias };
}

export interface UpdatePedInput {
  canonicalName?: string;
  categoryKey?: string | null;
  status?: "draft" | "approved" | "deprecated";
  notes?: string | null;
}

/**
 * Updates a PED's own fields. A category change refreshes every currently
 * cached alias of this PED (`updateDbPedCategoryCache` — see
 * pedRuntimeCache.ts's doc comment on why that's a cheap linear scan rather
 * than a secondary index). A canonical-name change also renames the PED's
 * primary alias to match, keeping the "primary alias mirrors canonicalName"
 * convention intact, and re-syncs every alias's legacy mirror so a rollback
 * to PED_SOURCE=legacy still resolves correctly under the new category.
 */
export async function updatePedRow(
  repos: Repos,
  id: number,
  patch: UpdatePedInput,
  performedBy: string
): Promise<PedRepositoryRow | undefined> {
  const before = await repos.pedRepository.get(id);
  if (!before) return undefined;

  const after = await repos.pedRepository.update(id, patch);
  if (!after) return undefined;

  const categoryChanged = patch.categoryKey !== undefined && before.categoryKey !== after.categoryKey;
  const nameChanged = patch.canonicalName !== undefined && before.canonicalName !== after.canonicalName;

  if (categoryChanged) {
    updateDbPedCategoryCache(id, after.categoryKey);
  }

  if (nameChanged) {
    const aliases = await repos.pedAliases.listByPed(id);
    const primary = aliases.find((a) => a.isPrimary);
    if (primary) {
      const oldNormalized = primary.normalizedAlias;
      const updatedAlias = await repos.pedAliases.updateAliasText(primary.id, after.canonicalName);
      if (updatedAlias && updatedAlias.normalizedAlias !== oldNormalized) {
        removeDbAliasCache(oldNormalized);
        updateDbAliasCache(updatedAlias.normalizedAlias, id, after.categoryKey);
      }
    }
  }

  if (categoryChanged || nameChanged) {
    try {
      const aliases = await repos.pedAliases.listByPed(id);
      for (const alias of aliases) {
        if (after.categoryKey) {
          await promotePedMappingOverride(repos.pedMappingOverrides, alias.aliasText, after.categoryKey, performedBy);
        } else {
          await unmapPedMappingOverride(repos.pedMappingOverrides, alias.aliasText, performedBy);
        }
      }
      // A rename also orphans the OLD canonical name's legacy mapping —
      // unmap it explicitly in case it differs from every current alias text.
      if (nameChanged) {
        await unmapPedMappingOverride(repos.pedMappingOverrides, before.canonicalName, performedBy);
      }
    } catch (err) {
      console.error("Failed to re-sync PED update into legacy mapping overrides:", err);
    }
  }

  return after;
}

/** Deletes a PED and every one of its aliases, removing each from the
 * runtime cache and unmapping each from the legacy mirror. Returns the
 * pre-delete row (there is nothing left to read afterwards) or `undefined`
 * if the PED didn't exist. */
export async function deletePedRow(repos: Repos, id: number, performedBy: string): Promise<PedRepositoryRow | undefined> {
  const existing = await repos.pedRepository.get(id);
  if (!existing) return undefined;

  const aliases = await repos.pedAliases.listByPed(id);
  await repos.pedAliases.deleteByPed(id);
  await repos.pedRepository.delete(id);

  for (const alias of aliases) {
    removeDbAliasCache(alias.normalizedAlias);
    try {
      await unmapPedMappingOverride(repos.pedMappingOverrides, alias.aliasText, performedBy);
    } catch (err) {
      console.error("Failed to unmap deleted PED's alias from legacy mapping overrides:", err);
    }
  }

  return existing;
}

export interface AddAliasInput {
  pedId: number;
  aliasText: string;
  isVisible?: boolean;
  addedBy: string;
}

/**
 * Adds a new alias to an existing PED. Throws the DB's unique-constraint
 * error untouched if `normalizedAlias` already belongs to a different PED —
 * callers must catch and surface that as an Alias Collision (see the
 * `/api/ped-repository/:id/aliases` route), never silently overwrite it.
 */
export async function addAliasToPed(repos: Repos, input: AddAliasInput): Promise<PedAliasRow> {
  const ped = await repos.pedRepository.get(input.pedId);
  const alias = await repos.pedAliases.create({
    pedId: input.pedId,
    aliasText: input.aliasText,
    isPrimary: false,
    isVisible: input.isVisible ?? true,
    addedBy: input.addedBy,
  });
  updateDbAliasCache(alias.normalizedAlias, input.pedId, ped?.categoryKey ?? null);

  if (ped?.categoryKey) {
    try {
      await promotePedMappingOverride(repos.pedMappingOverrides, alias.aliasText, ped.categoryKey, input.addedBy);
    } catch (err) {
      console.error("Failed to mirror new alias into legacy mapping overrides:", err);
    }
  }

  return alias;
}

export interface UpdateAliasInput {
  aliasText?: string;
  isVisible?: boolean;
  isPrimary?: boolean;
}

/**
 * Edits an existing alias. Visibility toggles never touch matching or the
 * legacy mirror (governance layer only — see ped_aliases.isVisible's doc
 * comment in schema.ts). A text edit re-derives `normalizedAlias` and moves
 * the cache/legacy-mirror entries from the old key to the new one.
 */
export async function updateAliasRow(
  repos: Repos,
  aliasId: number,
  patch: UpdateAliasInput,
  performedBy: string
): Promise<PedAliasRow | undefined> {
  const before = await repos.pedAliases.get(aliasId);
  if (!before) return undefined;

  let after: PedAliasRow | undefined = before;

  if (patch.aliasText !== undefined && normalizeDictionaryKey(patch.aliasText) !== before.normalizedAlias) {
    const ped = await repos.pedRepository.get(before.pedId);
    const updated = await repos.pedAliases.updateAliasText(aliasId, patch.aliasText);
    if (updated) {
      after = updated;
      removeDbAliasCache(before.normalizedAlias);
      updateDbAliasCache(updated.normalizedAlias, before.pedId, ped?.categoryKey ?? null);
      try {
        await unmapPedMappingOverride(repos.pedMappingOverrides, before.aliasText, performedBy);
        if (ped?.categoryKey) {
          await promotePedMappingOverride(repos.pedMappingOverrides, updated.aliasText, ped.categoryKey, performedBy);
        }
      } catch (err) {
        console.error("Failed to re-sync renamed alias into legacy mapping overrides:", err);
      }
    }
  }

  if (patch.isVisible !== undefined) {
    const updated = await repos.pedAliases.setVisibility(aliasId, patch.isVisible);
    if (updated) after = updated;
  }

  if (patch.isPrimary === true) {
    const updated = await repos.pedAliases.setPrimaryExclusive(before.pedId, aliasId);
    if (updated) after = updated;
  }

  return after;
}

/** Deletes an alias, removing it from the runtime cache and unmapping it
 * from the legacy mirror. Returns the pre-delete row, or `undefined` if it
 * didn't exist. Callers should prevent deleting a PED's last remaining
 * alias — that's a UI/route-level guard, not enforced here. */
export async function deleteAliasRow(repos: Repos, aliasId: number, performedBy: string): Promise<PedAliasRow | undefined> {
  const before = await repos.pedAliases.get(aliasId);
  if (!before) return undefined;

  await repos.pedAliases.delete(aliasId);
  removeDbAliasCache(before.normalizedAlias);
  try {
    await unmapPedMappingOverride(repos.pedMappingOverrides, before.aliasText, performedBy);
  } catch (err) {
    console.error("Failed to unmap deleted alias from legacy mapping overrides:", err);
  }

  return before;
}
