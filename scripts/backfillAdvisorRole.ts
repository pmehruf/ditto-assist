/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME BACKFILL — users.advisor_role <- master_advisors column F
 *
 * Seeds the new, directly-editable `advisor_role` column (see
 * drizzle/0024_add_advisor_role.sql) from the QA Google Sheet's current
 * Health/Term/Both classification, so existing advisors start with a
 * sensible value instead of every row showing "Unassigned" on day one.
 * "Manager" has no equivalent in the sheet and is never set by this script —
 * that's assigned manually, by an Admin/Developer, in the User Management UI.
 *
 * SAFETY
 *  - Only ever WRITES to a user row whose advisor_role is currently NULL.
 *    Re-running this (or running it after someone has already started
 *    manually assigning roles) never overwrites a real assignment, manual
 *    or otherwise — idempotent by construction, not just by accident.
 *  - Matches users to advisors by TACT ID (trimmed, case-insensitive). A
 *    user row with no matching "Currently Employed" advisor in the sheet is
 *    left untouched (stays unassigned) — that's expected for Admin/
 *    Developer accounts with no advisor record, not an error.
 *  - Read-only against the QA Google Sheet; writes only to this app's own
 *    `users` table.
 *
 * USAGE
 *   npx tsx scripts/backfillAdvisorRole.ts           # dry run, prints a summary
 *   npx tsx scripts/backfillAdvisorRole.ts --commit  # actually writes
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { getAllAdvisors } from "../src/server/qaDashboard/qaDataEngine.js";

// Same as migrate.ts — this runs standalone, outside the server process, so
// DATABASE_URL (and the QA Sheets service-account env vars) have to be
// loaded from .env here.
dotenv.config();

const COMMIT = process.argv.includes("--commit");

// Raw sheet value (column F, lowercased/trimmed) -> the fixed advisor_role
// label. Anything not in this map is left unassigned and reported, rather
// than guessed at.
const SKILL_DOMAIN_TO_ROLE: Record<string, string> = {
  health: "Health advisor",
  term: "Term advisor",
  both: "Both advisor",
};

async function main() {
  const db = getDb();
  const { users: usersRepo } = createRepositories(db);

  console.log("Reading master_advisors (Currently Employed only)...");
  const advisors = await getAllAdvisors();
  console.log(`Found ${advisors.length} Currently Employed advisors.`);

  const allUsers = await usersRepo.list();
  const userByTactId = new Map(allUsers.map((u) => [String(u.tactId).trim().toLowerCase(), u]));

  let matched = 0;
  let alreadySet = 0;
  let unrecognizedSkillDomain = 0;
  let noUserMatch = 0;
  const toUpdate: { email: string; role: string }[] = [];

  for (const advisor of advisors) {
    const user = userByTactId.get(String(advisor.tactId).trim().toLowerCase());
    if (!user) {
      noUserMatch++;
      continue;
    }
    if (user.advisorRole) {
      alreadySet++; // Never overwrite — manual or prior-run assignment stands.
      continue;
    }
    const rawSkillDomain = (advisor.skillDomain || "").trim().toLowerCase();
    const role = SKILL_DOMAIN_TO_ROLE[rawSkillDomain];
    if (!role) {
      if (rawSkillDomain) unrecognizedSkillDomain++;
      continue;
    }
    matched++;
    toUpdate.push({ email: user.email, role });
  }

  console.log("\n--- Summary ---");
  console.log(`Advisors matched to a directory user with no advisor_role yet, ready to set: ${matched}`);
  console.log(`Directory users already had an advisor_role (left untouched): ${alreadySet}`);
  console.log(`Advisors with an unrecognized column-F value (neither Health/Term/Both): ${unrecognizedSkillDomain}`);
  console.log(`Advisors with no matching directory user by TACT ID: ${noUserMatch}`);

  if (!COMMIT) {
    console.log("\nDry run only — no writes made. Re-run with --commit to apply.");
    if (toUpdate.length) {
      console.log("Would set:");
      for (const u of toUpdate) console.log(`  ${u.email} -> ${u.role}`);
    }
    return;
  }

  console.log(`\nWriting ${toUpdate.length} update(s)...`);
  for (const u of toUpdate) {
    await usersRepo.updateUser(u.email, { advisorRole: u.role });
  }
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
