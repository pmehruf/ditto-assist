/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPlanConfig } from "../types";
import {
  classifyDeterministic,
  sanitizeOutput,
  applyPostGuards,
  finalizeOutput,
  getSmokeTestCases,
} from "../engine";

/**
 * Regression safety net (added ahead of the Phase 1 architectural refactor).
 *
 * This runs the exact same pipeline server.ts's POST /api/match route runs
 * (classifyDeterministic -> sanitizeOutput -> applyPostGuards -> finalizeOutput)
 * against the app's own built-in smoke-test dataset (getSmokeTestCases, the
 * same data already used by the "Testing Workshop" UI tab), for every
 * supported insurance plan, and snapshots the result.
 *
 * Why this exists: this test session has no browser/UI tooling available to
 * manually click through the app after a structural refactor, so this is the
 * only mechanical guard against a refactor silently changing which
 * questionnaire question a declared condition maps to. On first run this
 * creates the baseline snapshot file under __snapshots__/; any future diff
 * must be reviewed deliberately before accepting it with `vitest run -u`.
 */
describe("engine.ts deterministic classification (regression baseline)", () => {
  const planConfigs = getPlanConfig();
  const planNames = Object.keys(planConfigs);

  it("covers all known plans", () => {
    // Was hardcoded to the original four; Aspire and Reassure 2.0 were added
    // since (see MASTER_ILLNESSES / types.ts plan config work), so this list
    // needs to grow whenever a new plan is onboarded rather than silently
    // going stale.
    expect(planNames.sort()).toEqual(
      ["Activ Fit Preferred", "Activ One Max", "Aspire", "Care Supreme", "Optima Secure", "Reassure 2.0"].sort()
    );
  });

  for (const planName of planNames) {
    it(`produces stable classification for every smoke-test PED on "${planName}"`, () => {
      const config = planConfigs[planName];
      const cases = getSmokeTestCases([planName]);

      expect(cases.length).toBeGreaterThan(0);

      const results = cases.map(({ ped }) => {
        let output = classifyDeterministic(ped, planName, config);
        if (!output) {
          // Not resolved deterministically -> would fall through to the
          // Gemini AI fallback in server.ts. We can't call the live model
          // in this offline test, but recording "unresolved" is itself a
          // meaningful regression signal: if a refactor makes a previously
          // deterministic PED start requiring AI (or vice versa), this
          // snapshot will show the change.
          return { ped, resolved: false as const };
        }
        output = sanitizeOutput(output, ped, config);
        output = applyPostGuards(output, ped, planName, config);
        const finalResult = finalizeOutput(output, ped, config, config.questions);
        return {
          ped,
          resolved: true as const,
          match_type: finalResult.match_type,
          matched_question: finalResult.matched_question,
          question_number: finalResult.question_number,
        };
      });

      expect(results).toMatchSnapshot();
    });
  }
});
