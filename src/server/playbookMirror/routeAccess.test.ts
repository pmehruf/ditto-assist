/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API ACCESS REVIEW for the Playbook mirror (Step 6, condition 6: permissions
 * enforced server-side). Reads server.ts and checks EVERY /api/playbook-mirror
 * route:
 *   - uses requireAuth;
 *   - its first statement inside the handler is a server-side requireFeatureAccess check;
 *   - the user-facing read routes (/read/...) use the all-user product_playbook
 *     feature, are GET-only and Viewer: they can never change anything;
 *   - every other route (the control tools) uses product_playbook_admin, which is
 *     Platform Admin only by default; anything that changes something needs Editor.
 */

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const src = fs.readFileSync(path.join(__dirname, "../../../server.ts"), "utf8").replace(/\r\n/g, "\n");
const routeRe = /app\.(get|post|put|patch|delete)\("(\/api\/playbook-mirror[^"]*)",([^\n]*?)async \(req, res\) => \{\n([\s\S]*?)\n\}\);/g;

interface Route { method: string; path: string; middleware: string; firstCheck: string | null; level: string | null; feature: string | null }
const routes: Route[] = [];
for (const m of src.matchAll(routeRe)) {
  const body = m[4];
  const check = /if \(!\(await requireFeatureAccess\(req, res, "([^"]+)", "(Viewer|Editor)"/.exec(body);
  const firstLine = body.split("\n").map((l) => l.trim()).filter((l) => l && l !== "try {")[0] ?? "";
  routes.push({ method: m[1].toUpperCase(), path: m[2], middleware: m[3].trim(), firstCheck: firstLine, level: check?.[2] ?? null, feature: check?.[1] ?? null });
}

describe("Playbook mirror API access review", () => {
  it("finds all mirror routes", () => {
    expect(routes.length).toBe(19); // exact: a new route must be added to this review deliberately
  });

  it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))("%s is signed-in and checked server-side first", (_name, r) => {
    expect(r.middleware).toContain("requireAuth");
    expect(r.firstCheck).toMatch(/^if \(!\(await requireFeatureAccess\(req, res, "(product_playbook|product_playbook_admin)", "(Viewer|Editor)"/);
    if (r.path.startsWith("/api/playbook-mirror/read/")) {
      expect(r.feature).toBe("product_playbook");
      expect(r.method).toBe("GET");
      expect(r.level).toBe("Viewer");
    } else {
      expect(r.feature).toBe("product_playbook_admin");
      const changes = r.method !== "GET" || r.path.endsWith("/connect-google");
      if (changes) expect(r.level).toBe("Editor");
    }
  });

  it("only the GET read routes are reachable with the all-user feature", () => {
    const userRoutes = routes.filter((r) => r.feature === "product_playbook");
    expect(userRoutes.map((r) => r.path).sort()).toEqual(["/api/playbook-mirror/read/cells", "/api/playbook-mirror/read/grid", "/api/playbook-mirror/read/meta"]);
    expect(userRoutes.every((r) => r.method === "GET")).toBe(true);
  });

  it("the mirror's Google callback branch re-checks Editor access before storing anything", () => {
    const branch = src.slice(src.indexOf("const playbookMirrorExpectedState"), src.indexOf("const qaSheetsExpectedState"));
    expect(branch).toMatch(/requireFeatureAccess\(req, res, "product_playbook_admin", "Editor"/);
    expect(branch.indexOf("requireFeatureAccess")).toBeLessThan(branch.indexOf("playbookMirrorConnection.upsert"));
  });
});

export { routes as playbookMirrorRoutes };
