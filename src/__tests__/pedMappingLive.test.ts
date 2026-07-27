/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TOP_PED_DICTIONARY, type PlanConfig } from "../types";
import { classifyDeterministic } from "../engine";
import {
  ensurePedOverridesLoaded,
  promotePedMappingOverride,
  unmapPedMappingOverride,
  inferCategoryKeyForQuestion,
  UNMAPPED_OVERRIDE_SENTINEL,
  __resetPedOverridesLoadedForTests,
} from "../server/pedMappingLive";

/**
 * Regression tests for the 2026-07-22 "PED Repository live effect" batch
 * (see the PED Library / AI Mapping Review live-wiring work): PED Library
 * category edits and AI Mapping Review approvals now actually change what
 * classifyDeterministic returns, via ped_mapping_overrides. These tests
 * cover the shared module (src/server/pedMappingLive.ts) that both write
 * paths call into, with a fake in-memory repository standing in for the DB.
 *
 * classifyDeterministic is exercised directly (not through /api/match, which
 * needs an Express app + DB) using a nonsense PED term ("zzqx testpromo...")
 * that can't accidentally match any real regex section or shield — so a
 * resolved/unresolved result can only be explained by the dictionary-routing
 * stage picking up (or not picking up) the override this test wrote.
 */

// In-memory stand-in for PedMappingOverridesRepository, matching only the
// methods pedMappingLive.ts actually calls.
function fakeRepo() {
  const rows = new Map<string, string>(); // normalized pedText -> category
  const upsertCalls: Array<{ pedText: string; category: string; addedBy: string }> = [];
  const deleteCalls: string[] = [];
  return {
    rows,
    upsertCalls,
    deleteCalls,
    async asDictionary() {
      return Object.fromEntries(rows);
    },
    async upsert(pedText: string, category: string, addedBy: string) {
      const key = pedText.trim().toLowerCase();
      rows.set(key, category);
      upsertCalls.push({ pedText: key, category, addedBy });
      return { id: 1, pedText: key, category, addedBy, createdAt: new Date() };
    },
    async deleteByPedText(pedText: string) {
      const key = pedText.trim().toLowerCase();
      rows.delete(key);
      deleteCalls.push(key);
    },
  };
}

const NONSENSE_TERM = "zzqx testpromo nonsense condition";
const NONSENSE_KEY = NONSENSE_TERM.toLowerCase();
const TEST_CATEGORY_KEY = "__test_promo_category__";

const fakePlanConfig: PlanConfig = {
  questions: ["Q_TARGET_FOR_TEST_CATEGORY"],
  anyOther: "Any other condition",
  hasUmbrella: false,
  umbrellaQuestions: [],
  categoryMap: { [TEST_CATEGORY_KEY]: 0 },
};

describe("pedMappingLive", () => {
  afterEach(() => {
    // Never leave a nonsense test key lingering in the shared, module-level
    // TOP_PED_DICTIONARY object — it's mutated in place by design, so tests
    // must clean up after themselves.
    delete TOP_PED_DICTIONARY[NONSENSE_KEY];
    __resetPedOverridesLoadedForTests();
  });

  describe("ensurePedOverridesLoaded", () => {
    it("merges the repo's overrides into TOP_PED_DICTIONARY", async () => {
      const repo = fakeRepo();
      await repo.upsert(NONSENSE_TERM, TEST_CATEGORY_KEY, "Tester");
      // Loaded independently of promotePedMappingOverride, simulating a
      // fresh process picking up a pre-existing DB row.
      expect(TOP_PED_DICTIONARY[NONSENSE_KEY]).toBeUndefined();
      await ensurePedOverridesLoaded(repo);
      expect(TOP_PED_DICTIONARY[NONSENSE_KEY]).toBe(TEST_CATEGORY_KEY);
    });

    it("only loads once per process (a second call is a no-op even against a changed repo)", async () => {
      const repo = fakeRepo();
      await ensurePedOverridesLoaded(repo);
      await repo.upsert(NONSENSE_TERM, TEST_CATEGORY_KEY, "Tester");
      // Second call: latch is already set, so this new row is NOT re-synced
      // by ensurePedOverridesLoaded alone (promotePedMappingOverride handles
      // that case itself by also writing directly into TOP_PED_DICTIONARY).
      await ensurePedOverridesLoaded(repo);
      expect(TOP_PED_DICTIONARY[NONSENSE_KEY]).toBeUndefined();
    });
  });

  describe("promotePedMappingOverride / unmapPedMappingOverride via the real engine", () => {
    it("promoting a term makes classifyDeterministic route it to its category's live question", async () => {
      const repo = fakeRepo();
      expect(classifyDeterministic(NONSENSE_TERM, "Fake Plan", fakePlanConfig)).toBeNull();

      await promotePedMappingOverride(repo, NONSENSE_TERM, TEST_CATEGORY_KEY, "Tester");

      const output = classifyDeterministic(NONSENSE_TERM, "Fake Plan", fakePlanConfig);
      expect(output?.matched_question).toBe("Q_TARGET_FOR_TEST_CATEGORY");
    });

    it("unmapping a promoted term makes classifyDeterministic stop resolving it via the dictionary again", async () => {
      const repo = fakeRepo();
      await promotePedMappingOverride(repo, NONSENSE_TERM, TEST_CATEGORY_KEY, "Tester");
      expect(classifyDeterministic(NONSENSE_TERM, "Fake Plan", fakePlanConfig)?.matched_question).toBe(
        "Q_TARGET_FOR_TEST_CATEGORY"
      );

      await unmapPedMappingOverride(repo, NONSENSE_TERM, "Tester");

      // The sentinel category is truthy but resolves to no question in any
      // categoryMap, so the dictionary stage falls through; nonsense text
      // matches nothing downstream either, so the overall result is null —
      // proving the dictionary stage was actually skipped, not just routed
      // to a different (still-live) answer.
      expect(classifyDeterministic(NONSENSE_TERM, "Fake Plan", fakePlanConfig)).toBeNull();
    });
  });

  describe("unmapPedMappingOverride — static vs override-only origin", () => {
    const STATIC_TERM = "diabetes"; // a real, hardcoded TOP_PED_DICTIONARY key
    let originalStaticValue: string;

    beforeEach(() => {
      originalStaticValue = TOP_PED_DICTIONARY[STATIC_TERM];
    });

    afterEach(() => {
      TOP_PED_DICTIONARY[STATIC_TERM] = originalStaticValue;
    });

    it("pins an explicit unmapped-sentinel override for a term baked into the static dictionary, instead of deleting", async () => {
      const repo = fakeRepo();
      await unmapPedMappingOverride(repo, STATIC_TERM, "Tester");

      expect(repo.deleteCalls).toHaveLength(0);
      expect(repo.upsertCalls).toContainEqual({ pedText: STATIC_TERM, category: UNMAPPED_OVERRIDE_SENTINEL, addedBy: "Tester" });
      expect(TOP_PED_DICTIONARY[STATIC_TERM]).toBe(UNMAPPED_OVERRIDE_SENTINEL);
    });

    it("deletes the override row outright for a term that only ever existed via an override", async () => {
      const repo = fakeRepo();
      await promotePedMappingOverride(repo, NONSENSE_TERM, TEST_CATEGORY_KEY, "Tester");

      await unmapPedMappingOverride(repo, NONSENSE_TERM, "Tester");

      expect(repo.deleteCalls).toContain(NONSENSE_KEY);
      expect(TOP_PED_DICTIONARY[NONSENSE_KEY]).toBeUndefined();
    });
  });

  describe("inferCategoryKeyForQuestion", () => {
    const cfg: PlanConfig = {
      questions: ["Question A", "Question B", "Question C"],
      anyOther: "Other",
      hasUmbrella: false,
      umbrellaQuestions: [],
      categoryMap: { cat_unique: 0, cat_ambig_1: 1, cat_ambig_2: 1 },
    };

    it("returns the single categoryKey that resolves to the given question", () => {
      expect(inferCategoryKeyForQuestion(cfg, "Question A")).toBe("cat_unique");
    });

    it("returns null when more than one categoryKey resolves to the same question (ambiguous)", () => {
      expect(inferCategoryKeyForQuestion(cfg, "Question B")).toBeNull();
    });

    it("returns null when no categoryKey resolves to the given question", () => {
      expect(inferCategoryKeyForQuestion(cfg, "Question Z — never mapped")).toBeNull();
    });

    it("returns null for empty question text or a plan with no categoryMap", () => {
      expect(inferCategoryKeyForQuestion(cfg, "")).toBeNull();
      expect(inferCategoryKeyForQuestion({ ...cfg, categoryMap: {} }, "Question A")).toBeNull();
    });
  });
});
