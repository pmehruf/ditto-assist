/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shape of a Playbook resync endpoint's JSON body that this formatter
 * needs — a subset of both /api/kb/playbook/resync's and
 * /api/kb/term-playbook/resync's actual response, which additionally
 * carries `ok`/`resource`/etc. that this formatter doesn't use. See
 * playbookIngest.ts's SyncPlaybookResult (and termPlaybookIngest.ts's
 * SyncTermPlaybookResult) for where these numbers come from. */
export interface PlaybookResyncMessageBody {
  skipped: boolean;
  planFactCount: number;
  narrativeChunkCount: number;
  previousPlanFactCount: number;
  previousNarrativeChunkCount: number;
  plansAdded: number;
  plansRemoved: number;
  plansChanged: number;
}

/**
 * Turns a Playbook resync response into the advisor/admin-facing message
 * shown under the Resync button (2026-09, by request — the old message only
 * ever reported the new totals, e.g. "Synced 23 plans and 8 reference
 * excerpts", giving no way to tell whether a resync actually changed
 * anything or just re-confirmed the same Sheet content). Shared by
 * KnowledgeBasePlaybook.tsx (Health) and KnowledgeBaseTermPlaybook.tsx
 * (Term) — both endpoints return the same shape (see
 * PlaybookResyncMessageBody), so the formatting logic lives once here
 * instead of as two copies that could drift out of sync with each other.
 */
export function formatPlaybookResyncMessage(body: PlaybookResyncMessageBody): string {
  if (body.skipped) return "No changes since the last sync.";

  const planWord = (n: number) => `${n} plan${n === 1 ? "" : "s"}`;
  const excerptWord = (n: number) => `${n} reference excerpt${n === 1 ? "" : "s"}`;

  const changeParts: string[] = [];
  if (body.plansAdded > 0) changeParts.push(`${body.plansAdded} new`);
  if (body.plansChanged > 0) changeParts.push(`${body.plansChanged} updated`);
  if (body.plansRemoved > 0) changeParts.push(`${body.plansRemoved} removed`);
  const changeSummary = changeParts.length > 0 ? ` (${changeParts.join(", ")})` : "";

  const chunkDelta = body.narrativeChunkCount - body.previousNarrativeChunkCount;
  const chunkDeltaText = chunkDelta === 0 ? "" : chunkDelta > 0 ? ` (+${chunkDelta})` : ` (${chunkDelta})`;

  return `Synced ${planWord(body.planFactCount)}${changeSummary} and ${excerptWord(body.narrativeChunkCount)}${chunkDeltaText} — previously ${planWord(
    body.previousPlanFactCount
  )} and ${excerptWord(body.previousNarrativeChunkCount)}.`;
}
