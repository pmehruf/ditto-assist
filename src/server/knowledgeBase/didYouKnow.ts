/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DID YOU KNOW — combined Health + Term FAQ feed for the Home Dashboard's
 * "Did you know!?" card (see server.ts's GET /api/did-you-know and
 * src/components/DidYouKnowCard.tsx). Replaces the old admin-authored
 * "Insight" announcement type entirely — this card is no longer controlled
 * through the Announcement Manager; its content is sourced live from
 * whichever FAQ sheet(s) are connected (see faqIngest.ts / termFaqIngest.ts).
 *
 * VISIBILITY: driven by the caller's `team` (Health-tagged -> Health only,
 * Term-tagged -> Term only, both/neither -> both — same
 * teamForTags semantics server.ts already uses for announcements).
 *
 * DAILY ROTATION: ITEMS_PER_CATEGORY items per included category, replaced
 * once a day (UTC calendar day — simplest, unambiguous "same day"
 * definition for a server-side deterministic pick with no per-user
 * timezone stored). Within a category, a day-seeded window of
 * ITEMS_PER_CATEGORY is picked from the eligible pool (in the order the
 * repository returns it — no longer sorted shortest-first by explicit
 * request, now that the card has room to show longer FAQs comfortably), so
 * a given day's picks stay stable across repeated requests but move on to
 * a different window the next day, rotating back to the start once the
 * pool is exhausted.
 */

import type { Repositories } from "../db/repositories/index.js";

export interface DidYouKnowItem {
  id: string;
  source: "Health" | "Term";
  question: string;
  answer: string;
}

const ITEMS_PER_CATEGORY = 15;

/** UTC calendar day number — deterministic across servers/requests, no
 * per-user timezone needed since this is a shared daily rotation, not a
 * personalized one. */
function currentDayIndex(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

/** Picks this day's window of `count` items from a pool (in the repository's
 * own returned order), advancing the starting offset by `count` each day and
 * wrapping around once the pool is exhausted — so every FAQ eventually
 * rotates through, always in the same relative order. */
function pickDailyWindow<T>(pool: T[], count: number, dayIndex: number): T[] {
  if (pool.length === 0) return [];
  if (pool.length <= count) return pool;
  const start = (dayIndex * count) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[(start + i) % pool.length]);
  }
  return out;
}

/**
 * Builds the caller's Did You Know feed. `team` mirrors server.ts's
 * `teamForTags` return value: "Health" -> Health FAQs only, "Term" -> Term
 * FAQs only, undefined -> both, genuinely ALTERNATING Health/Term one at a
 * time (Health, Term, Health, Term, ...) rather than every Health item
 * followed by every Term item, so a mixed-audience caller's browsing
 * actually mixes the two categories instead of front-loading one of them.
 */
export async function getDidYouKnowFeed(repos: Repositories, team: "Health" | "Term" | undefined): Promise<DidYouKnowItem[]> {
  const dayIndex = currentDayIndex();

  if (team === "Health") {
    const pool = await repos.faqRecords.listAnswerableActive();
    const picked = pickDailyWindow(pool, ITEMS_PER_CATEGORY, dayIndex);
    return picked.map(r => ({ id: `health-${r.id}`, source: "Health" as const, question: r.question, answer: r.answer }));
  }

  if (team === "Term") {
    const pool = await repos.termFaqRecords.listAnswerableActive();
    const picked = pickDailyWindow(pool, ITEMS_PER_CATEGORY, dayIndex);
    return picked.map(r => ({ id: `term-${r.id}`, source: "Term" as const, question: r.question, answer: r.answer }));
  }

  const healthPool = await repos.faqRecords.listAnswerableActive();
  const healthPicked = pickDailyWindow(healthPool, ITEMS_PER_CATEGORY, dayIndex);
  const termPool = await repos.termFaqRecords.listAnswerableActive();
  const termPicked = pickDailyWindow(termPool, ITEMS_PER_CATEGORY, dayIndex);

  const items: DidYouKnowItem[] = [];
  const maxLen = Math.max(healthPicked.length, termPicked.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < healthPicked.length) {
      const r = healthPicked[i];
      items.push({ id: `health-${r.id}`, source: "Health", question: r.question, answer: r.answer });
    }
    if (i < termPicked.length) {
      const r = termPicked[i];
      items.push({ id: `term-${r.id}`, source: "Term", question: r.question, answer: r.answer });
    }
  }
  return items;
}
