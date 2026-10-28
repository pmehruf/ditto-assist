/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeDictionaryKey } from "../mapping/helpers.js";
import type { Repositories } from "./db/repositories/index.js";
import type { PedRepositoryRow, PedAliasRow } from "./db/schema.js";

/**
 * Write-path orchestration for `ped_repository` / `ped_aliases`. Every function here is the database write and nothing
 * else: the routing engine reads these tables through the mapping snapshot, which the mapping gate refreshes on every
 * admin change (`mapping_state.version`), so an edit is live on the very next lookup on every instance. There is no
 * in-memory dictionary cache to update and no mirror into any legacy table (both were removed in Phase 6).
 */

type Repos = Pick<Repositories, "pedRepository" | "pedAliases">;

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
  return { ped, alias };
}

export interface UpdatePedInput {
  canonicalName?: string;
  categoryKey?: string | null;
  /** Phase 4 / R11: ordered fallback categories after the primary (null / empty = none). */
  categoryChain?: string[] | null;
  status?: "draft" | "approved" | "deprecated";
  notes?: string | null;
}

/**
 * Updates a PED's own fields. A canonical-name change also renames the PED's primary alias to match, keeping the
 * "primary alias mirrors canonicalName" convention intact.
 */
export async function updatePedRow(
  repos: Repos,
  id: number,
  patch: UpdatePedInput,
  _performedBy: string
): Promise<PedRepositoryRow | undefined> {
  const before = await repos.pedRepository.get(id);
  if (!before) return undefined;

  const after = await repos.pedRepository.update(id, patch);
  if (!after) return undefined;

  const nameChanged = patch.canonicalName !== undefined && before.canonicalName !== after.canonicalName;
  if (nameChanged) {
    const aliases = await repos.pedAliases.listByPed(id);
    const primary = aliases.find((a) => a.isPrimary);
    if (primary) await repos.pedAliases.updateAliasText(primary.id, after.canonicalName);
  }

  return after;
}

/** Deletes a PED and every one of its aliases. Returns the pre-delete row (there is nothing left to read afterwards)
 * or `undefined` if the PED didn't exist. */
export async function deletePedRow(repos: Repos, id: number, _performedBy: string): Promise<PedRepositoryRow | undefined> {
  const existing = await repos.pedRepository.get(id);
  if (!existing) return undefined;

  await repos.pedAliases.deleteByPed(id);
  await repos.pedRepository.delete(id);

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
  return repos.pedAliases.create({
    pedId: input.pedId,
    aliasText: input.aliasText,
    isPrimary: false,
    isVisible: input.isVisible ?? true,
    addedBy: input.addedBy,
  });
}

export interface UpdateAliasInput {
  aliasText?: string;
  isVisible?: boolean;
  isPrimary?: boolean;
  /** Mapping-control alias controls (see schema.ts ped_aliases). */
  routingEnabled?: boolean;
  categoryKeyOverride?: string | null;
  fallbackCategoryKey?: string | null;
}

/**
 * Edits an existing alias. A text edit re-derives `normalizedAlias`; visibility toggles never affect matching
 * (governance layer only — see ped_aliases.isVisible's doc comment in schema.ts).
 */
export async function updateAliasRow(
  repos: Repos,
  aliasId: number,
  patch: UpdateAliasInput,
  _performedBy: string
): Promise<PedAliasRow | undefined> {
  const before = await repos.pedAliases.get(aliasId);
  if (!before) return undefined;

  let after: PedAliasRow | undefined = before;

  if (patch.aliasText !== undefined && normalizeDictionaryKey(patch.aliasText) !== before.normalizedAlias) {
    const updated = await repos.pedAliases.updateAliasText(aliasId, patch.aliasText);
    if (updated) after = updated;
  }

  if (patch.isVisible !== undefined) {
    const updated = await repos.pedAliases.setVisibility(aliasId, patch.isVisible);
    if (updated) after = updated;
  }

  if (patch.isPrimary === true) {
    const updated = await repos.pedAliases.setPrimaryExclusive(before.pedId, aliasId);
    if (updated) after = updated;
  }

  if (patch.routingEnabled !== undefined || patch.categoryKeyOverride !== undefined || patch.fallbackCategoryKey !== undefined) {
    const updated = await repos.pedAliases.setRoutingControls(aliasId, {
      routingEnabled: patch.routingEnabled,
      categoryKeyOverride: patch.categoryKeyOverride,
      fallbackCategoryKey: patch.fallbackCategoryKey,
    });
    if (updated) after = updated;
  }

  return after;
}

/** Deletes an alias. Returns the pre-delete row, or `undefined` if it didn't exist. Callers should prevent deleting a
 * PED's last remaining alias — that's a UI/route-level guard, not enforced here. */
export async function deleteAliasRow(repos: Repos, aliasId: number, _performedBy: string): Promise<PedAliasRow | undefined> {
  const before = await repos.pedAliases.get(aliasId);
  if (!before) return undefined;

  await repos.pedAliases.delete(aliasId);
  return before;
}
