/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { legacyOnlyWriteBlocked, RETIRED_ACTION_MESSAGE } from "../server/legacyWriteGuard";

/**
 * Phase 3A write-path audit (docs/MAPPING_CONTROL_PLAN.md, "admin write-path
 * integrity"). With MAPPING_ENGINE=db the live engine does not read
 * ped_mapping_overrides, so no admin action may write only that table and still
 * report success. This test pins the complete inventory of writers: a NEW writer
 * of the old table, or a retired route that loses its guard, fails here.
 */

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const server = read("server.ts");

/** Splits server.ts into route blocks: [routeLine, body]. */
function routeBlocks(src: string): Array<{ route: string; body: string }> {
  const re = /^app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/gm;
  const starts: Array<{ route: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ route: `${m[1].toUpperCase()} ${m[2]}`, index: m.index });
  return starts.map((s, i) => ({ route: s.route, body: src.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : src.length) }));
}

const WRITES_OLD_TABLE = /promotePedMappingOverride\(|unmapPedMappingOverride\(|pedMappingOverrides\.(upsert|deleteByPedText)\(|pedOverridesRepo\.(upsert|deleteByPedText)\(/;

describe("legacy-only writers are retired in db mode (no silent no-op)", () => {
  const writers = routeBlocks(server).filter((b) => WRITES_OLD_TABLE.test(b.body));

  it("the complete set of routes that write ped_mapping_overrides is exactly the known inventory", () => {
    expect(writers.map((w) => w.route).sort()).toEqual(
      [
        "POST /api/add-ped-mapping",
        "POST /api/ped-suggestions",
        "PUT /api/ped-suggestions/:id",
        "DELETE /api/ped-suggestions/:id",
        "PATCH /api/ai-memory/:id/status",
      ].sort()
    );
  });

  it("every retired route refuses to run in db mode (410, nothing changed) via the shared guard", () => {
    for (const w of writers.filter((x) => x.route !== "PATCH /api/ai-memory/:id/status")) {
      expect(w.body, w.route).toContain("LEGACY_ONLY_WRITE_GUARD");
      expect(w.body, w.route).toContain("legacyOnlyWriteBlocked(MAPPING_ENGINE)");
      expect(w.body, w.route).toContain("status(410)");
      // the guard must come before any write
      expect(w.body.indexOf("LEGACY_ONLY_WRITE_GUARD"), w.route).toBeLessThan(w.body.search(WRITES_OLD_TABLE));
    }
  });

  it("the guard refuses in db mode and allows the legacy rollback path", () => {
    expect(legacyOnlyWriteBlocked("db")).toBe(true);
    expect(legacyOnlyWriteBlocked("legacy")).toBe(false);
    expect(RETIRED_ACTION_MESSAGE).toMatch(/PED Library/);
  });

  it("AI Mapping Review writes the old table ONLY in its legacy branch, never in the db branch", () => {
    const block = writers.find((w) => w.route === "PATCH /api/ai-memory/:id/status")!.body;
    const dbStart = block.indexOf('if (MAPPING_ENGINE === "db") {');
    const legacyStart = block.indexOf('} else if (status === "approved") {');
    expect(dbStart).toBeGreaterThan(-1);
    expect(legacyStart).toBeGreaterThan(dbStart);
    const dbBranch = block.slice(dbStart, legacyStart);
    expect(dbBranch).not.toMatch(WRITES_OLD_TABLE);
    expect(dbBranch).toContain("applyAiApproval(");
    expect(dbBranch).toContain("revertAiApproval(");
    expect(block.slice(legacyStart)).toMatch(WRITES_OLD_TABLE); // legacy rollback path intact
  });
});

describe("no new code writes the old table (no parallel source of truth)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const p = `${dir}${e.name}`;
      if (e.isDirectory()) walk(`${p}/`);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk("src/");
  walk("scripts/");

  it("only the legacy helpers, the PED Library mirror and the dead repository wrapper reference the write helpers", () => {
    const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const users = files.filter((f) => /promotePedMappingOverride|unmapPedMappingOverride/.test(code(f))).sort();
    expect(users).toEqual(["src/server/pedMappingLive.ts", "src/server/pedRepositoryLive.ts"]);
  });

  it("the new authoritative mechanism never touches ped_mapping_overrides", () => {
    for (const f of ["src/server/aiMappingPromotion.ts", "src/server/mappingSeed.ts", "src/server/mappingSnapshot.ts"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (f !== "src/server/mappingSeed.ts") expect(src, f).not.toMatch(/pedMappingOverrides|ped_mapping_overrides/); // the seed READS it once to derive legacy behaviour
    }
  });
});

describe("operational scripts that write authoritative mapping tables bump the mapping version", () => {
  const writesAuthoritative = /pedRepository\.(update|create|delete)\(|pedAliases\.(create|update|delete|setVisibility|setPrimary|reassignPed|updateAliasText)\(|planOverrides\.(upsert|delete)\(/;
  const scripts = readdirSync(new URL("scripts/", root)).filter((f) => f.endsWith(".ts") && !f.startsWith("_"));

  it("none of them writes ped_mapping_overrides", () => {
    for (const f of scripts) expect(read(`scripts/${f}`), f).not.toMatch(WRITES_OLD_TABLE);
  });

  it("every script that writes ped_repository / ped_aliases / plan_overrides calls the version bump", () => {
    const writers = scripts.filter((f) => writesAuthoritative.test(read(`scripts/${f}`)));
    expect(writers.length).toBeGreaterThan(0);
    for (const f of writers) {
      expect(read(`scripts/${f}`), f).toContain("bumpMappingVersionAfterApply");
    }
  });
});

describe("Phase 3B-i: every admin route that can change a routing result goes through the impact gate", () => {
  const WRITES_ROUTING_TABLES =
    /(planConfigs|planRestrictions|planOverrides|pedRepositoryRepo|pedAliases|pedRepository)\.(upsert|update|delete|rename|renamePlan|create|add|set\w*)\(|bumpMappingVersion\(|Ped(Row|AliasRow)\(|aliases\.(create|update|delete)|\b(createRule|patchRule|moveRule|deleteRule|createCategory|patchCategory|deleteCategory)\(/;
  const writers = routeBlocks(server).filter((b) => !b.route.startsWith("GET ") && WRITES_ROUTING_TABLES.test(b.body));

  it("the complete set of gated routes is exactly the known inventory", () => {
    expect(writers.map((w) => w.route).sort()).toEqual(
      [
        "POST /api/ped-repository",
        "PATCH /api/ped-repository/:id",
        "DELETE /api/ped-repository/:id",
        "POST /api/ped-repository/:id/aliases",
        "PATCH /api/ped-repository/aliases/:aliasId",
        "DELETE /api/ped-repository/aliases/:aliasId",
        "POST /api/plan-configs",
        "PUT /api/plan-configs/:planName",
        "DELETE /api/plan-configs/:planName",
        "POST /api/plan-restrictions/:planName",
        "PATCH /api/plan-restrictions/:id",
        "DELETE /api/plan-restrictions/:id",
        "PUT /api/plan-ped-overrides/:planName/:pedId",
        "DELETE /api/plan-ped-overrides/:planName/:pedId",
        "POST /api/routing-rules",
        "PATCH /api/routing-rules/:ruleKey",
        "POST /api/routing-rules/:ruleKey/move",
        "DELETE /api/routing-rules/:ruleKey",
        "POST /api/mapping-categories",
        "PATCH /api/mapping-categories/:categoryKey",
        "DELETE /api/mapping-categories/:categoryKey",
      ].sort()
    );
  });

  it("each one is registered behind mappingGate, after authentication and the rate limit", () => {
    for (const w of writers) {
      const registration = w.body.split("\n")[0];
      expect(registration, w.route).toContain("requireAuth");
      expect(registration, w.route).toContain("mappingGateRateLimit");
      expect(registration, w.route).toContain("mappingGate(");
      expect(registration.indexOf("requireAuth"), w.route).toBeLessThan(registration.indexOf("mappingGate("));
    }
  });

  it("the gate refuses a preview request instead of running it when switched off", () => {
    const gate = read("src/server/mappingChange.ts");
    const off = gate.slice(gate.indexOf("if (!deps.enabled())"), gate.indexOf("let control"));
    expect(off).toContain("preview_unavailable");
    expect(off.indexOf("preview_unavailable")).toBeLessThan(off.indexOf("return next()"));
  });
});
