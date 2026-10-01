/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getMatchTierInfo } from "../utils/matchTier";
import { IMPACT_THRESHOLDS } from "../mapping/impact";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { fixtureDump } from "./helpers/mappingTestDb";

/**
 * Phase 3B: the Constitution's P0 -> P1 -> P2 -> P3 definitions and impact thresholds
 * must describe what the code actually does (documentation-only change; any drift fails here).
 */

const constitution = readFileSync(new URL("../../MASTER_CONSTITUTION.md", import.meta.url), "utf8");

describe("Constitution v1.4 matches the implemented model", () => {
  it("is version 1.4 and records the ladder, the gate and the change-control fields", () => {
    expect(constitution).toMatch(/\*\*Version:\*\* 1\.4/);
    expect(constitution).toContain("Match priority ladder P0");
    expect(constitution).toContain("Impact gate for admin mapping writes");
    expect(constitution).toContain("Change-control fields for admin mapping changes");
    expect(constitution).toMatch(/v1\.4 {2}\(2026-10-02\)/);
  });

  it("the user-facing levels are exactly P0=1, P1=2, P2=2 (same display), FALLBACK=3", () => {
    expect(getMatchTierInfo("P0").level).toBe(1);
    expect(getMatchTierInfo("P1").level).toBe(2);
    expect(getMatchTierInfo("P2").level).toBe(2);
    expect(getMatchTierInfo("P2").label).toBe(getMatchTierInfo("P1").label);
    expect(getMatchTierInfo("FALLBACK").level).toBe(3);
    expect(getMatchTierInfo("NON_AILMENT").level).toBeNull();
  });

  it("the deterministic engine never produces P2 (it is AI-only) across every alias and plan", () => {
    const snapshot = snapshotFromDump(fixtureDump);
    const plans = planConfigsFromDump(fixtureDump);
    const seen = new Set<string>();
    for (const { planName, config } of plans) {
      for (const alias of snapshot.aliases.keys()) {
        const { result } = runDeterministicPipeline(alias, planName, config, snapshot);
        if (result) seen.add(result.match_type);
      }
    }
    expect(seen.has("P2")).toBe(false);
    expect(seen.has("P0")).toBe(true);
    expect(seen.has("P1")).toBe(true);
    expect(seen.has("FALLBACK")).toBe(true);
  }, 120_000);

  it("the thresholds documented in the Constitution are the ones in code", () => {
    const t = IMPACT_THRESHOLDS;
    expect(constitution).toContain(`<= ${t.lowMaxPairs} changed lookups`);
    expect(constitution).toContain(`< ${t.elevatedAdvisorLookups} advisor lookups`);
    expect(constitution).toContain(`>= ${t.highMinPairs} changed lookups`);
    expect(constitution).toContain(`>= ${t.highAdvisorLookups} advisor lookups`);
  });
});
