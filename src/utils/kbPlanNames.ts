/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Some insurer categories' Knowledge Base plan roster (kb_categories.
 * planNames) includes a pseudo-entry like "Add-on" / "Add-ons" — a bucket
 * for standalone rider documents that aren't tied to one specific base
 * plan, added the same way a real plan name would be (via the "+ Add Plan"
 * input in KnowledgeBaseResourceManagement.tsx). It's a real, useful roster
 * entry for TAGGING documents, but it isn't a plan a advisor would ever
 * pick as "the plan I'm asking about" — so anywhere the roster is used to
 * mean "the insurer's actual plans" (a plan count, a plan picker), it needs
 * to be filtered out first via this helper. Anywhere it's used purely as a
 * tagging suggestion (e.g. the KB admin's plan-tag quick-add chips) it's
 * fine to leave in, since a document genuinely can be tagged "Add-on".
 *
 * Matches by normalized value (trimmed, lowercased, punctuation/whitespace
 * stripped) rather than substring, so a real plan whose name happens to
 * contain "add-on" somewhere isn't wrongly excluded — only an exact
 * "add-on"/"add-ons"/"addon"/"addons"-shaped entry matches.
 */
export function isAddOnPlanName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "addon" || normalized === "addons";
}

/** Filters a plan-name roster down to real, selectable plans — see
 * isAddOnPlanName's comment above for why "Add-on"/"Add-ons" is excluded. */
export function realPlanNames(planNames: string[]): string[] {
  return planNames.filter(p => !isAddOnPlanName(p));
}
