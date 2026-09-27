/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { formatPlaybookResyncMessage, type PlaybookResyncMessageBody } from "./playbookResyncMessage.js";

describe("formatPlaybookResyncMessage", () => {
  const body = (overrides: Partial<PlaybookResyncMessageBody>): PlaybookResyncMessageBody => ({
    skipped: false,
    planFactCount: 10,
    narrativeChunkCount: 5,
    previousPlanFactCount: 10,
    previousNarrativeChunkCount: 5,
    plansAdded: 0,
    plansRemoved: 0,
    plansChanged: 0,
    ...overrides,
  });

  it("reports no changes for a skipped (hash-unchanged) sync", () => {
    expect(formatPlaybookResyncMessage(body({ skipped: true }))).toBe("No changes since the last sync.");
  });

  it("reports plain totals with no parenthetical breakdown when nothing changed but the sync still ran (e.g. after a prior error)", () => {
    expect(formatPlaybookResyncMessage(body({}))).toBe(
      "Synced 10 plans and 5 reference excerpts — previously 10 plans and 5 reference excerpts."
    );
  });

  it("reports added/updated/removed plan counts and a chunk delta", () => {
    const msg = formatPlaybookResyncMessage(
      body({ planFactCount: 12, previousPlanFactCount: 10, plansAdded: 2, plansChanged: 1, narrativeChunkCount: 7, previousNarrativeChunkCount: 5 })
    );
    expect(msg).toBe("Synced 12 plans (2 new, 1 updated) and 7 reference excerpts (+2) — previously 10 plans and 5 reference excerpts.");
  });

  it("reports a removal and a shrinking chunk count with a negative delta", () => {
    const msg = formatPlaybookResyncMessage(
      body({ planFactCount: 9, previousPlanFactCount: 10, plansRemoved: 1, narrativeChunkCount: 3, previousNarrativeChunkCount: 5 })
    );
    expect(msg).toBe("Synced 9 plans (1 removed) and 3 reference excerpts (-2) — previously 10 plans and 5 reference excerpts.");
  });

  it("uses singular wording for a count of exactly 1", () => {
    const msg = formatPlaybookResyncMessage(
      body({ planFactCount: 1, previousPlanFactCount: 0, plansAdded: 1, narrativeChunkCount: 1, previousNarrativeChunkCount: 0 })
    );
    expect(msg).toBe("Synced 1 plan (1 new) and 1 reference excerpt (+1) — previously 0 plans and 0 reference excerpts.");
  });
});
