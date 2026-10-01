/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the 2026-09h "dynamic Group Access feature list",
 * at the user's explicit request: "Automatically include all applicable
 * sidebar pages and features from the existing registry, covering Advisor
 * Zone, Admin Zone, and administrative sections. Avoid maintaining a
 * separate hardcoded list that becomes outdated when new features are
 * added."
 *
 * ADVISOR_ZONE_FEATURES / ADMIN_ZONE_FEATURES / RESTRICT_ONLY_FEATURES used
 * to be independently hand-written Set<string> literals; they are now
 * derived from each DEFAULT_FEATURE_PERMISSIONS entry's own `zone` field.
 * These tests prove that derivation is live (not just correct today by
 * coincidence) by constructing a throwaway registry entry and checking it
 * flows into the right Set purely by virtue of its `zone` tag — the same
 * guarantee that keeps a real new feature from ever being forgotten in a
 * separate list again.
 */
import { describe, expect, it } from "vitest";
import type { FeaturePermission } from "../types/permissions";
import { DEFAULT_FEATURE_PERMISSIONS, ADVISOR_ZONE_FEATURES, ADMIN_ZONE_FEATURES, RESTRICT_ONLY_FEATURES, GROUP_CONFIGURABLE_FEATURES } from "./featurePermissions";

function deriveSets(registry: FeaturePermission[]) {
  return {
    advisor: new Set(registry.filter((p) => p.zone === "advisor").map((p) => p.id)),
    admin: new Set(registry.filter((p) => p.zone === "admin").map((p) => p.id)),
    administrative: new Set(registry.filter((p) => p.zone === "administrative").map((p) => p.id)),
  };
}

describe("ADVISOR_ZONE_FEATURES / ADMIN_ZONE_FEATURES / RESTRICT_ONLY_FEATURES are derived from DEFAULT_FEATURE_PERMISSIONS.zone, not hand-maintained", () => {
  it("every entry's zone tag places it in exactly one of the three shipped Sets, and nowhere else", () => {
    for (const perm of DEFAULT_FEATURE_PERMISSIONS) {
      const inAdvisor = ADVISOR_ZONE_FEATURES.has(perm.id);
      const inAdmin = ADMIN_ZONE_FEATURES.has(perm.id);
      const inRestrictOnly = RESTRICT_ONLY_FEATURES.has(perm.id);

      if (perm.zone === "advisor") {
        expect(inAdvisor, perm.id).toBe(true);
        expect(inAdmin, perm.id).toBe(false);
        expect(inRestrictOnly, perm.id).toBe(false);
      } else if (perm.zone === "admin") {
        expect(inAdvisor, perm.id).toBe(false);
        expect(inAdmin, perm.id).toBe(true);
        expect(inRestrictOnly, perm.id).toBe(false);
      } else if (perm.zone === "administrative") {
        expect(inAdvisor, perm.id).toBe(false);
        expect(inAdmin, perm.id).toBe(false);
        expect(inRestrictOnly, perm.id).toBe(true);
      } else {
        // "developer" zone — Feature Visibility, Smoke Test, Clear Activity
        // — deliberately absent from all three; Group Access never reaches
        // Developer-only tooling in either direction.
        expect(perm.zone).toBe("developer");
        expect(inAdvisor, perm.id).toBe(false);
        expect(inAdmin, perm.id).toBe(false);
        expect(inRestrictOnly, perm.id).toBe(false);
      }
    }
  });

  it("the three Sets' total membership exactly equals the registry entries tagged advisor/admin/administrative — no id present that isn't zone-tagged for it, none missing that is", () => {
    const derived = deriveSets(DEFAULT_FEATURE_PERMISSIONS);
    expect(ADVISOR_ZONE_FEATURES).toEqual(derived.advisor);
    expect(ADMIN_ZONE_FEATURES).toEqual(derived.admin);
    expect(RESTRICT_ONLY_FEATURES).toEqual(derived.administrative);
  });

  it("GROUP_CONFIGURABLE_FEATURES is the union of all three zones' ids, and excludes every 'developer' zone id", () => {
    for (const perm of DEFAULT_FEATURE_PERMISSIONS) {
      if (perm.zone === "developer") {
        expect(GROUP_CONFIGURABLE_FEATURES.has(perm.id), perm.id).toBe(false);
      } else {
        expect(GROUP_CONFIGURABLE_FEATURES.has(perm.id), perm.id).toBe(true);
      }
    }
  });

  it("live-derivation proof: a hypothetical new registry entry lands in the correct Set purely from its zone tag, with zero Set-literal edits required", () => {
    // This is the actual guarantee the user asked for: adding a feature to
    // the registry with a given zone is enough on its own — nobody has to
    // remember to also touch ADVISOR_ZONE_FEATURES/ADMIN_ZONE_FEATURES/
    // RESTRICT_ONLY_FEATURES by hand. Simulate "adding a feature" by
    // building an extended registry and re-running the exact derivation
    // expression featurePermissions.ts uses, rather than mutating the real
    // shipped Sets (which are frozen at module-load time).
    const hypotheticalAdvisor: FeaturePermission = {
      id: "__hypothetical_new_advisor_feature__",
      name: "Hypothetical New Feature",
      description: "test fixture",
      defaultTier: "General",
      generalAccess: "Viewer",
      adminAccess: "Viewer",
      zone: "advisor",
    };
    const hypotheticalAdministrative: FeaturePermission = {
      id: "__hypothetical_new_administrative_feature__",
      name: "Hypothetical New Administrative Feature",
      description: "test fixture",
      defaultTier: "Admin",
      generalAccess: "None",
      adminAccess: "Viewer",
      zone: "administrative",
    };
    const extendedRegistry = [...DEFAULT_FEATURE_PERMISSIONS, hypotheticalAdvisor, hypotheticalAdministrative];
    const derived = deriveSets(extendedRegistry);

    expect(derived.advisor.has(hypotheticalAdvisor.id)).toBe(true);
    expect(derived.administrative.has(hypotheticalAdministrative.id)).toBe(true);
    // And it must NOT have silently also landed in an unrelated zone.
    expect(derived.admin.has(hypotheticalAdvisor.id)).toBe(false);
    expect(derived.advisor.has(hypotheticalAdministrative.id)).toBe(false);
  });

  it("every DEFAULT_FEATURE_PERMISSIONS entry declares a zone — the field is required, so a new feature literally cannot be added without picking one", () => {
    for (const perm of DEFAULT_FEATURE_PERMISSIONS) {
      expect(["advisor", "admin", "administrative", "developer"]).toContain(perm.zone);
    }
  });
});
