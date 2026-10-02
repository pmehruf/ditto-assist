/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Plain-language description of an ordered category fallback (R11), shared by every place a lookup is explained. */
export interface ChainTraceLike {
  configured: string[];
  selected: string | null;
  skipped: Array<{ category: string; reason: "no_question" | "catch_all" }>;
}

const pretty = (key: string) => key.replace(/_/g, " ");

export function describeCategoryChain(chain: ChainTraceLike, label: (key: string) => string = pretty): string[] {
  const lines = [`Category order for this PED: ${chain.configured.map(label).join(" → ")}.`];
  if (chain.selected) lines.push(`Used: ${label(chain.selected)}.`);
  else lines.push("None of these categories has a real question on this plan, so the normal fallback applied.");
  for (const s of chain.skipped) {
    lines.push(`Skipped ${label(s.category)} — ${s.reason === "catch_all" ? "this plan maps it to its Others question, which is not a specific question" : "this plan has no question for it"}.`);
  }
  return lines;
}
