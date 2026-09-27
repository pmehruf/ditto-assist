/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether `ownerEmail` is a valid choice given the CURRENT Owner pool (the
 * users eligible under whatever Owner Department is presently selected in
 * GroupEditorModal). An empty `ownerEmail` ("no owner selected") is always
 * valid -- it's Owner Department + a *chosen* Owner that must agree with
 * each other, not "some owner must always be chosen."
 *
 * Pulled out of GroupEditorModal.tsx as its own tiny, dependency-free module
 * (2026-09, post-Phase-B health-check fix) so it's the single source of
 * truth the component's Owner-Department revalidation effect AND its
 * defensive pre-save check both call -- and so it's unit-testable without
 * rendering the modal itself. See groupOwnerValidation.test.ts for the
 * regression this closes: selecting an Owner, then changing Owner
 * Department to one that excludes that Owner, no longer leaves the stale,
 * now-invalid email sitting in state ready to be silently submitted.
 */
export function isOwnerValidForPool(ownerEmail: string, ownerPool: { email: string }[]): boolean {
  if (!ownerEmail) return true;
  return ownerPool.some((u) => u.email === ownerEmail);
}
