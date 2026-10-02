/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 4 / R11 — validation of a PED's ordered category chain.
 *
 * The PED's primary category stays in `ped_repository.category_key`; the chain holds the ORDERED FALLBACKS after it
 * (secondary, tertiary, ...). The engine (src/mapping/routingEngine.ts) tries primary, then each fallback in order, and
 * uses the first one the selected plan has a real question for. A PED with no chain behaves exactly as before.
 */

export const MAX_CHAIN_LENGTH = 5;

export type ChainCheck = { ok: true; value: string[] | null } | { ok: false; error: string };

/**
 * `chain` is what the admin submitted (an array of category keys). Returns the normalised value to store: an empty list
 * becomes null (= no chain). The primary category must exist for a chain to make sense, may not repeat inside it, and
 * every entry must be a known category.
 */
export function validateCategoryChain(primary: string | null, chain: unknown, knownCategories: Set<string>): ChainCheck {
  if (chain === null || chain === undefined) return { ok: true, value: null };
  if (!Array.isArray(chain)) return { ok: false, error: "The fallback categories must be a list." };
  if (chain.length === 0) return { ok: true, value: null };
  if (!primary) return { ok: false, error: "Give the PED a primary category before adding fallback categories." };
  if (chain.length > MAX_CHAIN_LENGTH) return { ok: false, error: `A PED can have at most ${MAX_CHAIN_LENGTH} fallback categories.` };
  const seen = new Set<string>([primary]);
  for (const item of chain) {
    if (typeof item !== "string" || !item) return { ok: false, error: "Each fallback category must be a category key." };
    if (!knownCategories.has(item)) return { ok: false, error: `Unknown category "${item}".` };
    if (seen.has(item)) return { ok: false, error: item === primary ? "The primary category is already first; it cannot also be a fallback." : `"${item}" is listed twice.` };
    seen.add(item);
  }
  return { ok: true, value: chain as string[] };
}
