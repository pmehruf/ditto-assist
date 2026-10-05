/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operational scripts that write the authoritative mapping tables
 * (ped_repository / ped_aliases / plan_overrides) must bump the mapping
 * version afterwards. Without it, running servers on the database-backed engine keep
 * their cached snapshot and never see the change (a silent no-op).
 */
export async function bumpMappingVersionAfterApply(repos: { mappingState: { bump: () => Promise<number> } }): Promise<void> {
  try {
    const version = await repos.mappingState.bump();
    console.log(`Mapping version bumped to ${version} — running servers pick this change up on their next lookup.`);
  } catch (err) {
    console.warn(
      "WARNING: could not bump the mapping version (is migration 0085 applied?). Servers running MAPPING_ENGINE=db will NOT see these changes until it is bumped.",
      err
    );
  }
}
