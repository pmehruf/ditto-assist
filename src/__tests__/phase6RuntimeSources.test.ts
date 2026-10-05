/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * Phase 6 (R1/R5/R9): the database snapshot is the only source of routing. These source-level guards pin that the legacy
 * engine, its switches, its caches and the compiled plan configs are gone from the runtime.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const server = code("server.ts");
const app = code("src/App.tsx");

describe("the legacy engine and its switches are removed", () => {
  it("the legacy engine, its caches and its mirror modules no longer exist", () => {
    for (const f of ["src/engine.ts", "src/server/pedRuntimeCache.ts", "src/server/pedMappingLive.ts", "src/server/legacyWriteGuard.ts"]) {
      expect(existsSync(new URL(`../../${f}`, import.meta.url)), f).toBe(false);
    }
  });

  it("the server has no engine switch, no legacy classifier and no legacy caches", () => {
    expect(server).not.toMatch(/MAPPING_ENGINE|PED_SOURCE|classifyDeterministic|ensurePedOverridesLoaded|pedRuntimeCache|legacyOnlyWriteBlocked/);
    expect(server).not.toMatch(/applyPostGuards\(/);
  });

  it("the browser never classifies a condition; every lookup goes to the server", () => {
    expect(app).not.toMatch(/classifyDeterministic|from "\.\/engine/);
    expect(app).toContain('fetch("/api/match"');
  });

  it("the server reads plans from the database only and runs the database post-guards on AI answers", () => {
    expect(server).not.toContain("getPlanConfig");
    expect(server).toContain("applyPostGuardsFromSnapshot(parsedOutput, ped, planName, config, await getMappingSnapshot(repos)).output");
  });
});
