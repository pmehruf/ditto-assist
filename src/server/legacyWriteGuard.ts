/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin write-path integrity (Phase 3A). With MAPPING_ENGINE=db the live
 * engine never reads `ped_mapping_overrides`, so any action that writes only
 * that table would report success for a change that does nothing. Such
 * actions are retired in db mode: they answer 410 with a clear message and
 * change nothing. In legacy mode (the rollback path) they keep working
 * exactly as before.
 */

export const RETIRED_ACTION_MESSAGE = "This action is no longer available. Make mapping changes in the PED Library — they take effect straight away.";

/** True when a legacy-only mapping write must be refused for this engine mode. */
export function legacyOnlyWriteBlocked(engine: "legacy" | "db"): boolean {
  return engine === "db";
}
