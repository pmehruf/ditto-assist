/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Phase 6 (R1/R9): with MAPPING_ENGINE=db a lookup reads the database snapshot only. These source-level guards pin the
 * places where the legacy override table / dictionary cache used to be loaded on every request.
 */
const server = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");

describe("db-mode lookups do not touch the legacy sources", () => {
  it("the legacy ped_mapping_overrides table is loaded only when the legacy engine is selected", () => {
    const calls = server.match(/ensurePedOverridesLoaded\(pedOverridesRepo\)/g) ?? [];
    expect(calls.length).toBe(2); // /api/match and the smoke-test endpoint
    for (const m of server.matchAll(/^.*ensurePedOverridesLoaded\(pedOverridesRepo\).*$/gm)) {
      expect(m[0]).toContain('MAPPING_ENGINE !== "db"');
    }
  });

  it("the legacy dictionary cache source is never built in db mode", () => {
    expect(server).toMatch(/if \(MAPPING_ENGINE === "db" \|\| PED_SOURCE !== "db"\) return null;/);
  });
});

describe("AI answers use the database post-guard rules (batch C)", () => {
  it("the Gemini path runs the snapshot's post_guard rows in db mode", () => {
    expect(server).toContain("applyPostGuardsFromSnapshot(parsedOutput, ped, planName, config, await getMappingSnapshot(repos)).output");
  });
});

describe("plans come from the database only (batch D)", () => {
  it("the server no longer reads the compiled plan configs", () => {
    expect(server).not.toContain("getPlanConfig");
    expect(server).not.toMatch(/PLAN_CONFIG\[/);
  });
});
