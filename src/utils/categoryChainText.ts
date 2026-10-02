/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Plain-language description of a PED's Primary / Fallback categories (R11), shared by every place a lookup is explained. */
export interface ChainTraceLike {
  configured: string[];
  selected: string | null;
  skipped: Array<{ category: string; reason: "no_question" | "catch_all" }>;
}

const pretty = (key: string) => key.replace(/_/g, " ");

export function describeCategoryChain(chain: ChainTraceLike, label: (key: string) => string = pretty): string[] {
  const [primary, ...fallbacks] = chain.configured;
  const lines = [`Categories for this PED: Primary ${label(primary)}${fallbacks.map((k, i) => `, Fallback ${i + 1} ${label(k)}`).join("")}.`];
  if (chain.selected) lines.push(`Used: ${label(chain.selected)}${chain.selected === primary ? " (the Primary)" : ""}.`);
  else lines.push("None of these categories has a declaration question on this plan, so the usual fallback was used.");
  for (const s of chain.skipped) {
    lines.push(`Skipped ${label(s.category)} — ${s.reason === "catch_all" ? "this plan only has its general “Other” question for it" : "this plan has no declaration question for it"}.`);
  }
  return lines;
}
