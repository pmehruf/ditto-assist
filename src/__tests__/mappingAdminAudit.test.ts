/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Phase 3B-ii audit: rule / category administration is access-controlled, goes through the impact gate, and there is
 * exactly one writer of routing_rules / categories outside scripts (no competing admin path).
 */

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const server = read("server.ts");

function routeBlocks(src: string): Array<{ route: string; body: string }> {
  const re = /^app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/gm;
  const starts: Array<{ route: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ route: `${m[1].toUpperCase()} ${m[2]}`, index: m.index });
  return starts.map((s, i) => ({ route: s.route, body: src.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : src.length) }));
}

const adminRoutes = routeBlocks(server).filter((b) => /\/api\/(routing-rules|mapping-categories|mapping-trace)/.test(b.route));

describe("Phase 3B-ii: rule / category administration", () => {
  it("the complete set of rule / category / trace routes is the known inventory", () => {
    expect(adminRoutes.map((b) => b.route).sort()).toEqual(
      [
        "GET /api/routing-rules",
        "POST /api/routing-rules/validate",
        "POST /api/routing-rules",
        "PATCH /api/routing-rules/:ruleKey",
        "POST /api/routing-rules/:ruleKey/move",
        "DELETE /api/routing-rules/:ruleKey",
        "GET /api/mapping-categories",
        "POST /api/mapping-categories",
        "PATCH /api/mapping-categories/:categoryKey",
        "DELETE /api/mapping-categories/:categoryKey",
        "POST /api/mapping-trace",
      ].sort()
    );
  });

  it("every write needs Editor access to plan_scope; every read needs Viewer access to a mapping feature", () => {
    for (const b of adminRoutes) {
      const registration = b.body.split("\n")[0];
      expect(registration, b.route).toContain("requireAuth");
      if (b.route.startsWith("GET ") || b.route === "POST /api/mapping-trace") expect(b.body, b.route).toContain("canViewMappingControl(req)");
      else if (b.route === "POST /api/routing-rules/validate") expect(b.body, b.route).toContain('requireFeatureAccess(req, res, "plan_scope", "Editor"');
      else {
        expect(registration, b.route).toContain("mappingGate(");
        expect(registration, b.route).toContain('adminWrite("plan_scope"');
      }
    }
  });

  it("the shared write wrapper checks access first and bumps the version only on success", () => {
    const i = server.indexOf("const adminWrite =");
    const wrapper = server.slice(i, i + 1000);
    expect(wrapper.indexOf("requireFeatureAccess")).toBeLessThan(wrapper.indexOf("run(createRepositories"));
    expect(wrapper).toContain("op.status < 400");
  });

  it("only the admin ops module writes routing_rules and categories (outside scripts and repositories)", () => {
    const files = (readdirSync(new URL("src/server/", root), { recursive: true }) as string[]).map((f) => f.replace(/\\/g, "/")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("db/repositories/"));
    const strip = (t: string) => t.replace(/\/\/.*$/gm, "");
    for (const writer of ["routingRules.upsert", "routingRules.delete", "categories.upsert", "categories.update", "categories.delete"]) {
      const hits = files.filter((f) => strip(read(`src/server/${f}`)).includes(writer));
      expect(hits, writer).toEqual(["mappingAdminOps.ts"]);
      expect(strip(server).includes(writer), `server.ts must not call ${writer} directly`).toBe(false);
    }
  });
});
