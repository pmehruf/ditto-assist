/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical TACT ID format used everywhere in this app: "TACT" followed
 * immediately by digits, no separator, no case variation — e.g. "TACT1500".
 *
 * Historically this was a free-text field, so the same person's ID could be
 * on file as "tact1500", "Tact1500", "Tact-1500", "tact-1500", "TACT-1500",
 * etc. — which silently broke exact-match lookups (e.g. matching directory
 * users against an external roster by TACT ID). `normalizeTactId` strips
 * every non-digit character and re-prefixes with "TACT", so any of those
 * variants collapses to the same canonical string.
 *
 * Isomorphic (no DOM/Node APIs) so both server.ts and the client components
 * (the first-time-setup form, User Management) can import it directly and
 * always agree on the same canonical form.
 */
export function normalizeTactId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits ? `TACT${digits}` : "";
}

/** Just the digit portion of a TACT ID (or of any partial/raw input) — what
 * the numeric-only entry field in TactIdInput binds to. */
export function tactIdDigits(value: string): string {
  return value.replace(/\D/g, "");
}
