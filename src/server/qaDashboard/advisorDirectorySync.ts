/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ADVISOR DIRECTORY SYNC — master_advisors -> users (2026-08)
 * ---------------------------------------------------------------
 * Syncs Department/Team/Role assignment and Health/Term skill-domain tags
 * for every directory user who matches a "Currently Employed" row in the
 * QA Dashboard's master_advisors sheet. Reuses the exact same Sheets
 * connection and read path every other QA Dashboard feature already uses
 * (see sheetsClient.ts/qaDataEngine.ts) — this file adds no new
 * connection, no new OAuth scope, no new spreadsheet.
 *
 * WHAT THIS TOUCHES
 *   - users.departmentId / orgTeamId / roleId — set to the existing
 *     Advisory/Bliss/Advisor catalog rows (looked up by name at sync time,
 *     never hardcoded IDs, never auto-created — see resolveAdvisorCatalogIds
 *     below).
 *   - users.tags — Health/Term membership only, derived from master_advisors
 *     column "Product" (Health -> Health, Term -> Term, Both -> both). Any
 *     non-Health/Term tag value is preserved untouched (future-proofing;
 *     ADVISOR_TAG_VALUES is Health/Term only today, so this is currently a
 *     no-op distinction).
 *   - advisor_directory_sync_state — one row per user this sync has ever
 *     written to, recording exactly what it applied so a later run can
 *     both no-op an already-correct user and safely revert ONLY its own
 *     prior assignment (never a value a human has since changed) — see
 *     schema.ts's table comment for the full reasoning.
 *
 * WHAT THIS NEVER TOUCHES
 *   - name, tactId, tier, status, email — untouched on every matched user.
 *   - Users are NEVER created or deleted here — a "Currently Employed" row
 *     with no matching directory user is reported as skipped/not found,
 *     never provisioned.
 *   - Product Assist retrieval, credit calculation, or the quota evaluator
 *     itself (productAssistQuota.ts) — setting departmentId/orgTeamId/
 *     roleId/tags on a matching user is enough for resolveQuotaBucket() to
 *     recognize them automatically, IF an admin has separately configured
 *     "AI Usage & Limits" Settings to point eligibleDepartmentId/
 *     eligibleOrgTeamId/eligibleRoleId at these same Advisory/Bliss/Advisor
 *     rows — that configuration step is unchanged and untouched by this file.
 */

import type { Repositories } from "../db/repositories/index.js";
import type { UserRow } from "../db/schema.js";
import type { AdvisorDirectorySyncStateRow } from "../db/schema.js";
import { getMasterAdvisorsRowsForSync, isEmployedStatus, invalidateQaSheetCache, type MasterAdvisorsRow } from "./qaDataEngine.js";

// Same mapping the two prior one-time backfill scripts each independently
// defined (scripts/assignAdvisorTagsFromCsv.ts, scripts/backfillAdvisorRole.ts)
// — kept as its own local literal here too rather than a shared import,
// matching that precedent, since it's a 3-line, unlikely-to-drift constant.
const PRODUCT_COLUMN_TO_TAGS: Record<string, string[]> = {
  health: ["Health"],
  term: ["Term"],
  both: ["Health", "Term"],
};
// Every tag value this sync is ever allowed to add/remove — see the "WHAT
// THIS TOUCHES" note above on preserving any tag outside this set.
const SYNC_OWNED_TAG_VALUES = ["Health", "Term"];

export interface AdvisorDirectorySyncNotFoundSample {
  tactId: string;
  email: string | null;
  name: string;
}

export interface AdvisorDirectorySyncResult {
  recordsRead: number;
  currentlyEmployedRecords: number;
  usersMatched: number;
  /** Directory writes for a still-employed, matched user (department/team/
   * role/tags changed to the desired state). */
  usersUpdated: number;
  /** Matched, still-employed users whose department/team/role/tags already
   * matched the desired state — no write needed. */
  usersUnchanged: number;
  /** Previously sync-owned users reverted because they're no longer
   * Currently Employed (or their row disappeared from the sheet entirely) —
   * see revertIfStillOwned's doc comment for the "still owned" guard. */
  usersReverted: number;
  usersSkippedNotFound: number;
  /** Currently Employed + matched, but the Product cell didn't resolve to
   * Health/Term/Both — tags left untouched for that user this run (see the
   * "WHAT THIS TOUCHES" note above), Department/Team/Role still applied. */
  unrecognizedProductRecords: number;
  /** First 20 Currently Employed rows with no directory match, for the
   * admin result panel — never all of them, to keep the response small. */
  notFoundSamples: AdvisorDirectorySyncNotFoundSample[];
  /** Non-empty only when the sync couldn't run at all (e.g. a required
   * catalog row is missing) — see resolveAdvisorCatalogIds. */
  errors: string[];
  syncedAt: string;
}

function emptyResult(recordsRead: number, errors: string[]): AdvisorDirectorySyncResult {
  return {
    recordsRead,
    currentlyEmployedRecords: 0,
    usersMatched: 0,
    usersUpdated: 0,
    usersUnchanged: 0,
    usersReverted: 0,
    usersSkippedNotFound: 0,
    unrecognizedProductRecords: 0,
    notFoundSamples: [],
    errors,
    syncedAt: new Date().toISOString(),
  };
}

/** Looks up the Advisory department / Bliss team / Advisor role by name —
 * reuses whatever rows already exist in the catalog (all three are
 * convenience-seeded by migrations 0038/0049, so they exist by default; an
 * admin may also have renamed or recreated them since). Never creates a
 * missing row: per spec, an admin must add it through Access Control
 * Center's own catalog-management UI first, exactly like every other
 * Department/Team/Role. */
async function resolveAdvisorCatalogIds(
  repos: Repositories
): Promise<{ departmentId: number; orgTeamId: number; roleId: number } | { errors: string[] }> {
  const [departments, orgTeams, roles] = await Promise.all([repos.departments.list(), repos.orgTeams.list(), repos.roles.list()]);
  const advisory = departments.find((d) => d.name === "Advisory");
  const bliss = orgTeams.find((t) => t.name === "Bliss");
  const advisor = roles.find((r) => r.name === "Advisor");

  const errors: string[] = [];
  if (!advisory) errors.push('The "Advisory" department does not exist — add it in Access Control Center\'s Departments tab, then re-run this sync.');
  if (!bliss) errors.push('The "Bliss" team does not exist — add it in Access Control Center\'s Teams tab, then re-run this sync.');
  if (!advisor) errors.push('The "Advisor" role does not exist — add it in Access Control Center\'s Roles tab, then re-run this sync.');
  if (errors.length > 0) return { errors };

  return { departmentId: advisory!.id, orgTeamId: bliss!.id, roleId: advisor!.id };
}

function tagSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((t) => setA.has(t));
}

/**
 * Undoes ONLY the field values this sync itself last applied to `user`, and
 * ONLY where the live value still equals what was recorded — a field a
 * human has changed since (live value != tracker.appliedX) is left exactly
 * as-is, never forced back to null. Always leaves the tracker row itself
 * reflecting currentlyEmployed=false / nothing applied, regardless of
 * whether users.* needed an actual write, since after this call the sync
 * is no longer asserting anything about this user.
 */
async function revertIfStillOwned(
  repos: Repositories,
  user: UserRow,
  tracker: AdvisorDirectorySyncStateRow,
  triggeredBy: string
): Promise<boolean> {
  const patch: { departmentId?: null; orgTeamId?: null; roleId?: null; tags?: string[] } = {};
  let userChanged = false;

  if (tracker.appliedDepartmentId !== null && user.departmentId === tracker.appliedDepartmentId) {
    patch.departmentId = null;
    userChanged = true;
  }
  if (tracker.appliedOrgTeamId !== null && user.orgTeamId === tracker.appliedOrgTeamId) {
    patch.orgTeamId = null;
    userChanged = true;
  }
  if (tracker.appliedRoleId !== null && user.roleId === tracker.appliedRoleId) {
    patch.roleId = null;
    userChanged = true;
  }
  if (tracker.appliedProductTags.length > 0) {
    const currentTags = user.tags ?? [];
    const stillOwnedTags = tracker.appliedProductTags.filter((t) => currentTags.includes(t));
    if (stillOwnedTags.length > 0) {
      patch.tags = currentTags.filter((t) => !stillOwnedTags.includes(t));
      userChanged = true;
    }
  }

  if (userChanged) {
    await repos.users.updateUser(user.email, patch);
  }

  await repos.advisorDirectorySyncState.upsert({
    userEmail: user.email,
    sheetTactId: tracker.sheetTactId,
    currentlyEmployed: false,
    appliedDepartmentId: null,
    appliedOrgTeamId: null,
    appliedRoleId: null,
    appliedProductTags: [],
    lastSyncedBy: triggeredBy,
  });

  return userChanged;
}

/**
 * Runs one full sync pass. Idempotent — re-running immediately with no
 * sheet changes reports everything as "unchanged", writes nothing new to
 * `users`, and still refreshes advisor_directory_sync_state's
 * lastSyncedAt/currentlyEmployed for every currently-matched row.
 */
export async function syncAdvisorDirectory(repos: Repositories, triggeredBy: string): Promise<AdvisorDirectorySyncResult> {
  // Force a fresh read — invalidateQaSheetCache() exists specifically for an
  // admin-triggered "Refresh"/resync action like this one, so a sync never
  // silently runs against a stale (up to 5-minute-old) cached sheet read.
  invalidateQaSheetCache();

  const { totalRows, rows } = await getMasterAdvisorsRowsForSync();

  const catalogIds = await resolveAdvisorCatalogIds(repos);
  if ("errors" in catalogIds) {
    return emptyResult(totalRows, catalogIds.errors);
  }
  const { departmentId: advisoryId, orgTeamId: blissId, roleId: advisorId } = catalogIds;

  const [allUsers, trackedRows] = await Promise.all([repos.users.list(), repos.advisorDirectorySyncState.list()]);
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
  const userByTactId = new Map(allUsers.filter((u) => u.tactId?.trim()).map((u) => [u.tactId.trim().toLowerCase(), u]));
  const trackedByEmail = new Map(trackedRows.map((t) => [t.userEmail, t]));
  const seenTrackedEmails = new Set<string>();

  let currentlyEmployedRecords = 0;
  let usersMatched = 0;
  let usersUpdated = 0;
  let usersUnchanged = 0;
  let usersReverted = 0;
  let usersSkippedNotFound = 0;
  let unrecognizedProductRecords = 0;
  const notFoundSamples: AdvisorDirectorySyncNotFoundSample[] = [];

  function resolveUser(row: MasterAdvisorsRow): UserRow | undefined {
    // Prefer email — the reliable identity field per spec. TACT ID is a
    // fallback only, for a row whose sheet email doesn't match this app's
    // login email but whose TACT ID is already recorded on the directory
    // user (same fallback order scripts/assignAdvisorTagsFromCsv.ts used).
    if (row.email) {
      const byEmail = userByEmail.get(row.email);
      if (byEmail) return byEmail;
    }
    if (row.tactId?.trim()) {
      return userByTactId.get(row.tactId.trim().toLowerCase());
    }
    return undefined;
  }

  for (const row of rows) {
    const employed = isEmployedStatus(row.statusRaw);
    if (employed) currentlyEmployedRecords++;

    const user = resolveUser(row);
    if (!user) {
      if (employed) {
        usersSkippedNotFound++;
        if (notFoundSamples.length < 20) notFoundSamples.push({ tactId: row.tactId, email: row.email, name: row.name });
      }
      continue;
    }

    const emailKey = user.email.toLowerCase();
    seenTrackedEmails.add(emailKey);
    const tracker = trackedByEmail.get(emailKey);

    if (!employed) {
      if (tracker?.currentlyEmployed) {
        if (await revertIfStillOwned(repos, user, tracker, triggeredBy)) usersReverted++;
      }
      continue;
    }

    // ── Currently Employed + matched — apply the assignment ──
    usersMatched++;
    const productKey = String(row.skillDomain ?? "").trim().toLowerCase();
    const mappedTags = PRODUCT_COLUMN_TO_TAGS[productKey];
    if (!mappedTags) {
      // Blank/unrecognized Product cell — leave tags exactly as they are
      // rather than guessing or clearing a previously-valid assignment;
      // Department/Team/Role are still applied below (unconditional per
      // spec for every matched Currently Employed row).
      if (productKey) unrecognizedProductRecords++;
    }
    const currentTags = user.tags ?? [];
    const desiredTags = mappedTags
      ? Array.from(new Set([...currentTags.filter((t) => !SYNC_OWNED_TAG_VALUES.includes(t)), ...mappedTags]))
      : currentTags;

    const needsWrite =
      user.departmentId !== advisoryId || user.orgTeamId !== blissId || user.roleId !== advisorId || !tagSetsEqual(currentTags, desiredTags);

    if (needsWrite) {
      await repos.users.updateUser(user.email, {
        departmentId: advisoryId,
        orgTeamId: blissId,
        roleId: advisorId,
        tags: desiredTags,
      });
      usersUpdated++;
    } else {
      usersUnchanged++;
    }

    await repos.advisorDirectorySyncState.upsert({
      userEmail: user.email,
      sheetTactId: row.tactId || null,
      currentlyEmployed: true,
      appliedDepartmentId: advisoryId,
      appliedOrgTeamId: blissId,
      appliedRoleId: advisorId,
      appliedProductTags: mappedTags ?? tracker?.appliedProductTags ?? [],
      lastSyncedBy: triggeredBy,
    });
  }

  // Previously sync-owned + Currently Employed users whose row vanished
  // from the sheet ENTIRELY this run (not just flipped to a non-employed
  // status) — same revert rule as the inline "!employed" branch above.
  for (const tracker of trackedRows) {
    if (!tracker.currentlyEmployed || seenTrackedEmails.has(tracker.userEmail)) continue;
    const user = userByEmail.get(tracker.userEmail);
    if (!user) continue; // user row itself no longer exists — nothing to revert
    if (await revertIfStillOwned(repos, user, tracker, triggeredBy)) usersReverted++;
  }

  return {
    recordsRead: totalRows,
    currentlyEmployedRecords,
    usersMatched,
    usersUpdated,
    usersUnchanged,
    usersReverted,
    usersSkippedNotFound,
    unrecognizedProductRecords,
    notFoundSamples,
    errors: [],
    syncedAt: new Date().toISOString(),
  };
}
