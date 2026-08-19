/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { MASTER_ILLNESSES, matchSpecificIllness } from "../specificIllnessEngine";
import { getSmokeTestCases } from "../engine";

/**
 * Regression safety net (added ahead of the Phase 1 architectural refactor).
 *
 * See engine.baseline.test.ts for the rationale. This covers the separate
 * specific-illness waiting-period matching system (Specific Illness Ledger
 * feature), which has its own independent condition database and matching
 * logic from engine.ts.
 */
describe("specificIllnessEngine.ts matching (regression baseline)", () => {
  it("every master illness entry resolves to itself by its own parent name", () => {
    const selfMatchSummary = MASTER_ILLNESSES.map((illness) => {
      const results = matchSpecificIllness(illness.parent_illness);
      const top = results[0];
      return {
        id: illness.id,
        parent_illness: illness.parent_illness,
        top_match_type: top?.match_type,
        top_matched_illness: top?.matched_listed_illness,
      };
    });

    expect(selfMatchSummary).toMatchSnapshot();
  });

  it("produces stable results across the shared smoke-test PED list", () => {
    // Reuse the same PED list engine.baseline.test.ts uses, so both engines
    // are checked against one shared, already-curated dataset instead of a
    // second hand-picked list.
    const cases = getSmokeTestCases(["Optima Secure"]); // plan is irrelevant here; only ped is used
    const uniquePeds = [...new Set(cases.map((c) => c.ped))];

    const results = uniquePeds.map((ped) => {
      const matches = matchSpecificIllness(ped);
      const top = matches[0];
      return {
        ped,
        top_match_type: top?.match_type ?? "no_match",
        top_matched_illness: top?.matched_listed_illness ?? null,
      };
    });

    expect(results).toMatchSnapshot();
  });
});
