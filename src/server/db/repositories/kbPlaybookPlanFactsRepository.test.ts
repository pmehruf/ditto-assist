/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { KbPlaybookPlanFactsRepository, type CreateKbPlaybookPlanFactEntry } from "./kbPlaybookPlanFactsRepository.js";
import { KbResourcesRepository } from "./kbResourcesRepository.js";
import { KbCategoriesRepository } from "./kbCategoriesRepository.js";

describe("KbPlaybookPlanFactsRepository", () => {
  let db: TestDb;
  let repo: KbPlaybookPlanFactsRepository;
  let resourceId: number;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new KbPlaybookPlanFactsRepository(db);
    const categories = new KbCategoriesRepository(db);
    const category = await categories.create({ name: "General", type: "general" });
    const resources = new KbResourcesRepository(db);
    const resource = await resources.create({
      categoryId: category.id,
      type: "sheet",
      title: "Product Playbook - Health",
      sourceUrl: null,
      status: "active",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      planTags: [],
      addedBy: "tester",
    });
    resourceId = resource.id;
  });

  afterEach(async () => {
    await db.$client.close();
  });

  // notes (2026-09, Product Playbook advisor UI) — a jsonb column, separate
  // from `content`; this just confirms it round-trips through a real
  // Postgres engine (PGlite) correctly, both populated and empty.
  it("round-trips the notes column through replaceForResource / listByResource", async () => {
    await repo.replaceForResource(resourceId, [
      {
        resourceId,
        domain: "Health",
        insurerName: "HDFC Ergo",
        planName: "Optima Secure+",
        sourceTab: "Ditto's Recommended Policies",
        content: "### HDFC Ergo Optima Secure+\n\nRoom Rent: Covered",
        notes: [
          { label: "Plan", note: "Plan withdrawn from sale in some states" },
          { label: "Room Rent", note: "Only for network hospitals" },
        ],
      },
      {
        resourceId,
        domain: "Health",
        insurerName: "Niva Bupa",
        planName: "Aspire",
        sourceTab: "Ditto's Recommended Policies",
        content: "### Niva Bupa Aspire\n\nRoom Rent: No limit",
        notes: [],
      },
    ]);

    const rows = await repo.listByResource(resourceId);
    const hdfc = rows.find(r => r.insurerName === "HDFC Ergo")!;
    expect(hdfc.notes).toEqual([
      { label: "Plan", note: "Plan withdrawn from sale in some states" },
      { label: "Room Rent", note: "Only for network hospitals" },
    ]);

    const niva = rows.find(r => r.insurerName === "Niva Bupa")!;
    expect(niva.notes).toEqual([]);
  });

  it("defaults notes to an empty array when omitted entirely (backward compatible with pre-notes callers)", async () => {
    const entryWithoutNotes: Omit<CreateKbPlaybookPlanFactEntry, "notes"> = {
      resourceId,
      domain: "Health",
      insurerName: "HDFC Ergo",
      planName: "Optima Secure+",
      sourceTab: "Ditto's Recommended Policies",
      content: "### HDFC Ergo Optima Secure+\n\nRoom Rent: Covered",
    };
    await repo.replaceForResource(resourceId, [entryWithoutNotes]);
    const rows = await repo.listByResource(resourceId);
    expect(rows[0].notes).toEqual([]);
  });

  it("replaceForResource fully replaces prior rows (old notes don't linger after a resync)", async () => {
    await repo.replaceForResource(resourceId, [
      {
        resourceId,
        domain: "Health",
        insurerName: "HDFC Ergo",
        planName: "Optima Secure+",
        sourceTab: "Ditto's Recommended Policies",
        content: "v1",
        notes: [{ label: "Plan", note: "stale note" }],
      },
    ]);
    await repo.replaceForResource(resourceId, [
      {
        resourceId,
        domain: "Health",
        insurerName: "HDFC Ergo",
        planName: "Optima Secure+",
        sourceTab: "Ditto's Recommended Policies",
        content: "v2",
        notes: [],
      },
    ]);
    const rows = await repo.listByResource(resourceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("v2");
    expect(rows[0].notes).toEqual([]);
  });

  // findMatching (2026-09) — `row.planName` (derived from the Playbook
  // Google Sheet's own column header — see playbookIngest.ts) and the
  // advisor-facing plan tag it's compared against (kb_categories.planNames,
  // a separate admin-typed roster) are two independently-maintained
  // strings for the same real-world plan. These confirm the normalized
  // match tolerates realistic formatting drift between them without
  // loosening into a false-positive substring match.
  describe("findMatching", () => {
    beforeEach(async () => {
      await repo.replaceForResource(resourceId, [
        {
          resourceId,
          domain: "Health",
          insurerName: "HDFC Ergo",
          planName: "Optima Secure+",
          sourceTab: "Ditto's Recommended Policies",
          content: "### HDFC Ergo Optima Secure+\n\nRoom Rent: Covered",
          notes: [],
        },
        {
          resourceId,
          domain: "Health",
          insurerName: "HDFC Ergo",
          planName: "Optima Secure Plus",
          sourceTab: "Ditto's Recommended Policies",
          content: "### HDFC Ergo Optima Secure Plus\n\nRoom Rent: No limit",
          notes: [],
        },
        {
          resourceId,
          domain: "Term",
          insurerName: "HDFC Ergo",
          planName: "Optima Secure+",
          sourceTab: "Ditto's Recommended Policies",
          content: "### Term row that must never match a Health lookup",
          notes: [],
        },
      ]);
    });

    it("matches a byte-identical plan name (the pre-existing behavior)", async () => {
      const rows = await repo.findMatching("HDFC Ergo", ["Optima Secure+"], "Health");
      expect(rows.map(r => r.planName)).toEqual(["Optima Secure+"]);
    });

    it("tolerates extra/irregular whitespace and case differences between the two independently-typed strings", async () => {
      const rows = await repo.findMatching("HDFC Ergo", ["  optima   SECURE+ "], "Health");
      expect(rows.map(r => r.planName)).toEqual(["Optima Secure+"]);
    });

    it("tolerates punctuation drift (e.g. a trailing period or curly apostrophe) that doesn't change the underlying alphanumeric name", async () => {
      const rows = await repo.findMatching("HDFC Ergo", ["Optima Secure+."], "Health");
      expect(rows.map(r => r.planName)).toEqual(["Optima Secure+"]);
    });

    it("still requires the full normalized name to match — never a substring, so a shorter plan name never matches a longer sibling", async () => {
      const rows = await repo.findMatching("HDFC Ergo", ["Optima Secure"], "Health");
      expect(rows).toHaveLength(0);
    });

    it("keeps domain isolation intact under normalized matching (a Term row never answers a Health lookup)", async () => {
      const rows = await repo.findMatching("HDFC Ergo", ["Optima Secure+"], "Term");
      expect(rows.map(r => r.content)).toEqual(["### Term row that must never match a Health lookup"]);
    });

    it("still matches the insurer name loosely (substring, either direction) alongside the normalized plan match", async () => {
      const rows = await repo.findMatching("HDFC ERGO General Insurance", ["Optima Secure+"], "Health");
      expect(rows.map(r => r.planName)).toEqual(["Optima Secure+"]);
    });
  });

  // findAllForInsurer (2026-09 regression fix) — productAssist.ts's live bug:
  // an insurer selected via the UI (e.g. "Care Health") with no plan
  // selected or detected got zero Playbook facts, because findMatching
  // short-circuits to [] whenever planTags is empty. This is the insurer-
  // only counterpart advisor questions like "How does the restoration
  // benefit work?" (asked while scoped only to an insurer) now use instead.
  describe("findAllForInsurer", () => {
    beforeEach(async () => {
      await repo.replaceForResource(resourceId, [
        {
          resourceId,
          domain: "Health",
          insurerName: "Care",
          planName: "Care Supreme",
          sourceTab: "Ditto's Recommended Policies",
          content: "### Care Supreme\n\nRestoration: partial exhaustion",
          notes: [],
        },
        {
          resourceId,
          domain: "Health",
          insurerName: "Care",
          planName: "Care Freedom",
          sourceTab: "Ditto's Recommended Policies",
          content: "### Care Freedom\n\nRestoration: partial exhaustion",
          notes: [],
        },
        {
          resourceId,
          domain: "Health",
          insurerName: "HDFC Ergo",
          planName: "Optima Secure+",
          sourceTab: "Ditto's Recommended Policies",
          content: "### HDFC Ergo row that must never leak into a Care Health lookup",
          notes: [],
        },
        {
          resourceId,
          domain: "Term",
          insurerName: "Care",
          planName: "Care Supreme",
          sourceTab: "Ditto's Recommended Policies",
          content: "### Term row that must never match a Health lookup",
          notes: [],
        },
      ]);
    });

    it("returns every plan for the insurer, regardless of plan name, when no plan is in scope", async () => {
      const rows = await repo.findAllForInsurer("Care", "Health");
      expect(rows.map(r => r.planName).sort()).toEqual(["Care Freedom", "Care Supreme"]);
    });

    it("never leaks another insurer's plans into the result", async () => {
      const rows = await repo.findAllForInsurer("Care", "Health");
      expect(rows.some(r => r.insurerName === "HDFC Ergo")).toBe(false);
    });

    it("keeps domain isolation intact (a Term row never answers a Health lookup)", async () => {
      const rows = await repo.findAllForInsurer("Care", "Health");
      expect(rows.every(r => r.domain === "Health")).toBe(true);
    });

    it("matches the insurer name loosely (substring, either direction), same convention as findMatching", async () => {
      const rows = await repo.findAllForInsurer("Care Health", "Health");
      expect(rows.map(r => r.planName).sort()).toEqual(["Care Freedom", "Care Supreme"]);
    });

    it("returns an empty array for an insurer name that matches nothing", async () => {
      const rows = await repo.findAllForInsurer("Some Unknown Insurer", "Health");
      expect(rows).toEqual([]);
    });

    it("returns an empty array when given an empty/blank insurer name, rather than matching everything", async () => {
      const rows = await repo.findAllForInsurer("   ", "Health");
      expect(rows).toEqual([]);
    });
  });

  // deleteOrphanedForDomain (2026-09 data-integrity fix) — a live production
  // bug: rows can end up mistagged under an unrelated, legitimate resource's
  // resourceId (found for real: Care Health plan facts sitting under the
  // Health FAQ's resourceId, from a historical bug predating a title-match
  // guard in syncPlaybook). The fix must delete only the orphaned rows,
  // scoped to domain, and must NEVER touch the other resource itself or its
  // own legitimate content.
  describe("deleteOrphanedForDomain", () => {
    it("deletes a row whose resourceId doesn't match the canonical resource for this domain", async () => {
      const categories = new KbCategoriesRepository(db);
      const category = await categories.create({ name: "Health FAQ", type: "general" });
      const resources = new KbResourcesRepository(db);
      const otherResource = await resources.create({
        categoryId: category.id,
        type: "sheet",
        title: "Health FAQ",
        sourceUrl: null,
        status: "active",
        contentHash: null,
        lastFetchedAt: null,
        chunkCount: 512,
        errorMessage: null,
        planTags: [],
        addedBy: "tester",
      });
      await repo.replaceForResource(otherResource.id, [
        {
          resourceId: otherResource.id,
          domain: "Health",
          insurerName: "Care",
          planName: "Advantage", // mistagged — pre-fix stripped form
          sourceTab: "Ditto's Recommended Policies",
          content: "### Advantage — mistagged under the FAQ resource",
          notes: [],
        },
      ]);
      await repo.replaceForResource(resourceId, [
        {
          resourceId,
          domain: "Health",
          insurerName: "Care",
          planName: "Care Advantage", // correct — the real Playbook resource
          sourceTab: "Ditto's Recommended Policies",
          content: "### Care Advantage — correctly parsed",
          notes: [],
        },
      ]);

      await repo.deleteOrphanedForDomain("Health", resourceId);

      const remaining = await repo.listAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].resourceId).toBe(resourceId);
      expect(remaining[0].planName).toBe("Care Advantage");
    });

    it("never touches the other resource's own row (e.g. Term data under a different resourceId)", async () => {
      const categories = new KbCategoriesRepository(db);
      const termCategory = await categories.create({ name: "Term Playbook", type: "general", domain: "Term" });
      const resources = new KbResourcesRepository(db);
      const termResource = await resources.create({
        categoryId: termCategory.id,
        type: "sheet",
        title: "Product Playbook - Term",
        sourceUrl: null,
        status: "active",
        contentHash: null,
        lastFetchedAt: null,
        chunkCount: 0,
        errorMessage: null,
        planTags: [],
        addedBy: "tester",
      });
      await repo.replaceForResource(termResource.id, [
        {
          resourceId: termResource.id,
          domain: "Term",
          insurerName: "HDFC Life",
          planName: "Click 2 Protect Supreme",
          sourceTab: "Ditto's Recommended Policies",
          content: "### Term row — must survive a Health-domain cleanup untouched",
          notes: [],
        },
      ]);
      await repo.replaceForResource(resourceId, [
        { resourceId, domain: "Health", insurerName: "Care", planName: "Care Supreme", sourceTab: "Ditto's Recommended Policies", content: "### Care Supreme", notes: [] },
      ]);

      await repo.deleteOrphanedForDomain("Health", resourceId);

      const remaining = await repo.listAll();
      expect(remaining).toHaveLength(2);
      expect(remaining.some(r => r.domain === "Term" && r.planName === "Click 2 Protect Supreme")).toBe(true);
    });

    it("is a no-op when every row for this domain already belongs to the canonical resource", async () => {
      await repo.replaceForResource(resourceId, [
        { resourceId, domain: "Health", insurerName: "Care", planName: "Care Supreme", sourceTab: "Ditto's Recommended Policies", content: "### Care Supreme", notes: [] },
      ]);
      await repo.deleteOrphanedForDomain("Health", resourceId);
      const remaining = await repo.listAll();
      expect(remaining).toHaveLength(1);
    });
  });
});
