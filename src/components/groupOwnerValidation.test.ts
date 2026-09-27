/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression test for the Owner <-> Owner Department desync bug identified
 * in the 2026-09 post-Phase-B health check: in GroupEditorModal.tsx, a user
 * could select an Owner, then change Owner Department to one that doesn't
 * include that Owner. The Owner picker went visually blank (its value no
 * longer matched any option in the newly filtered pool), but the underlying
 * `selectedOwnerEmail` state still held the stale email -- live enough for
 * Next to silently reassign the group's entire roster to an owner no longer
 * valid for the group's Owner Department.
 *
 * `isOwnerValidForPool` (src/components/groupOwnerValidation.ts) is now the
 * single source of truth GroupEditorModal.tsx calls both to revalidate the
 * Owner the instant Owner Department changes (clearing it if it's no longer
 * valid) and to defensively re-check the combination right before
 * saveGroupAndOwnership() acts on it. This test exercises that function
 * directly against the exact scenario the health check called out --
 * without needing to render the modal itself: this repo has no React
 * component-testing infrastructure (no @testing-library/react, no jsdom
 * environment -- vitest.config.ts's `environment: 'node'` and its
 * `src/**\/*.test.ts`-only include deliberately keep this suite to
 * pure-logic tests), so the validation logic was pulled out into its own
 * dependency-free module specifically so it could be tested this way
 * instead of standing up a whole new test environment for one modal.
 */
import { describe, expect, it } from "vitest";
import { isOwnerValidForPool } from "./groupOwnerValidation.js";

const mentorExcellence = [{ email: "owner-a@example.com" }, { email: "owner-b@example.com" }];
const salesTeam = [{ email: "owner-c@example.com" }, { email: "owner-d@example.com" }];

describe("isOwnerValidForPool — Owner / Owner Department combination validity", () => {
  it("Owner A selected while Owner Department's pool contains Owner A: valid", () => {
    expect(isOwnerValidForPool("owner-a@example.com", mentorExcellence)).toBe(true);
  });

  it("the exact regression scenario: Owner A selected, then Owner Department changed to a pool that excludes Owner A -- now invalid", () => {
    // Step 1: user picks Owner A while Owner Department is "Mentor Excellence".
    expect(isOwnerValidForPool("owner-a@example.com", mentorExcellence)).toBe(true);
    // Step 2: user changes Owner Department to "Sales Team" -- ownerPool is
    // recomputed, but `selectedOwnerEmail` (still "owner-a@example.com" until
    // something clears it) is re-checked against the NEW pool.
    expect(isOwnerValidForPool("owner-a@example.com", salesTeam)).toBe(false);
    // This is exactly the condition GroupEditorModal's revalidation effect
    // checks to decide whether to clear selectedOwnerEmail and set
    // ownerClearedByDepartmentChange, and the same condition
    // saveGroupAndOwnership defensively re-checks before ever calling the
    // reassign-owner endpoint -- so a false here is what guarantees the
    // stale owner is never silently submitted.
  });

  it("no owner selected (empty string) is always valid, regardless of pool -- there's nothing stale to reject", () => {
    expect(isOwnerValidForPool("", salesTeam)).toBe(true);
    expect(isOwnerValidForPool("", [])).toBe(true);
  });

  it("an empty pool (e.g. a department with zero eligible users) invalidates any previously-selected owner", () => {
    expect(isOwnerValidForPool("owner-a@example.com", [])).toBe(false);
  });

  it("switching back to a department that DOES contain the owner is valid again -- Owner Department changes aren't a one-way trip", () => {
    expect(isOwnerValidForPool("owner-a@example.com", salesTeam)).toBe(false);
    expect(isOwnerValidForPool("owner-a@example.com", mentorExcellence)).toBe(true);
  });

  it("is unaffected by extra fields on the pool's user objects (structural typing -- GroupEditorModal passes full UserProfile rows, not bare {email} objects)", () => {
    const richPool = [{ email: "owner-a@example.com", name: "Owner A", departmentId: 7, tactId: "T-1" }];
    expect(isOwnerValidForPool("owner-a@example.com", richPool)).toBe(true);
    expect(isOwnerValidForPool("owner-z@example.com", richPool)).toBe(false);
  });
});
