/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Admin write-path audit (docs/MAPPING_CONTROL_PLAN.md, "admin write-path integrity"), after the Phase 6 removal of the
 * legacy engine: the database-backed engine reads the authoritative mapping tables only, so NOTHING may write the legacy
 * `ped_mapping_overrides` table any more. The table is kept as historical data; this pins that no code touches it.
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

describe("no admin route writes the legacy ped_mapping_overrides table", () => {
  it("none of the routes in server.ts writes it", () => {
    expect(routeBlocks(server).filter((b) => WRITES_OLD_TABLE.test(b.body)).map((b) => b.route)).toEqual([]);
  });

  it("the retired legacy routes are gone", () => {
    const routes = routeBlocks(server).map((b) => b.route);
    for (const gone of ["POST /api/add-ped-mapping", "POST /api/ped-suggestions", "PUT /api/ped-suggestions/:id", "DELETE /api/ped-suggestions/:id"]) {
      expect(routes).not.toContain(gone);
    }
  });

  it("AI Mapping Review changes the authoritative tables only", () => {
    const block = routeBlocks(server).find((b) => b.route === "PATCH /api/ai-memory/:id/status")!.body;
    expect(block).toContain("applyAiApproval(");
    expect(block).toContain("revertAiApproval(");
    expect(block).not.toMatch(WRITES_OLD_TABLE);
  });
});

describe("no code writes the old table (no parallel source of truth)", () => {
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

  it("nothing references the legacy write helpers", () => {
    const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(files.filter((f) => /promotePedMappingOverride|unmapPedMappingOverride/.test(code(f)))).toEqual([]);
  });

  it("the authoritative mechanism never touches ped_mapping_overrides", () => {
    for (const f of ["src/server/aiMappingPromotion.ts", "src/server/mappingSnapshot.ts", "src/server/pedRepositoryLive.ts"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/pedMappingOverrides|ped_mapping_overrides/);
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
