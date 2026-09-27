/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Product Assist Library — Core Resources destination config.
 *
 * The Health FAQ is an internal Ditto resource: its underlying Google Sheet
 * must never be exposed to advisors (see faqIngest.ts's title comment and
 * KnowledgeBaseFaqConnection.tsx), so the Library's "Health FAQ" item opens
 * this external destination instead of the resource's own sourceUrl the way
 * "Product Playbook" does. Kept as one named constant — imported wherever
 * the destination is needed — rather than the URL literal being retyped in
 * more than one component.
 */
export const HEALTH_FAQ_LIBRARY_URL = "https://dittohq.in/tools";

/** Term counterpart to HEALTH_FAQ_LIBRARY_URL (2026-09) — same reasoning:
 * the Term FAQ's underlying Google Sheet must stay internal, so the
 * Library's "Term FAQ" item opens this external destination instead of the
 * resource's own sourceUrl. Currently the same external "tools" page as
 * Health's — update independently here if Term ever needs a distinct
 * destination. */
export const TERM_FAQ_LIBRARY_URL = "https://dittohq.in/tools";
