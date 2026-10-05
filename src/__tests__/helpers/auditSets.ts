/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlanConfig, PlanRestriction } from "../../types";

/** The restriction scenarios the Zero Regression Audit runs on every plan (shared with the fixture that froze the expected outcomes). */
export const diabetesAndGrowthPattern = /diabet|insulin|sugar|glyc|polyp|cyst|tumou?r|growth|lipoma|benign|neoplasm|prediab/i;
export const restrictionSets: Array<{ name: string; restrictions: PlanRestriction[]; flags?: PlanConfig["overrides"] }> = [
{ name: "diabetes requires keywords", restrictions: [{ categoryKey: "diabetes", mode: "require_keywords", keywords: ["type 1", "insulin", "blindness"], explanation: "Diabetes is limited to insulin / type 1 on this plan.", isActive: true }] },
{ name: "diabetes excludes keywords", restrictions: [{ categoryKey: "diabetes", mode: "exclude_keywords", keywords: ["prediabetes", "borderline"], explanation: "Prediabetes is not covered.", isActive: true }] },
{ name: "benign growth blocked", restrictions: [{ categoryKey: "benign_growth", mode: "block_category", keywords: [], explanation: "Benign growths go to Others.", isActive: true }] },
{ name: "legacy plan flags (no restriction rows)", restrictions: [], flags: { requiresInsulinForDiabetes: true, excludePrediabetes: true, bypassBenignTumors: true } },
{ name: "inactive restriction is ignored", restrictions: [{ categoryKey: "diabetes", mode: "block_category", keywords: [], explanation: "x", isActive: false }] },
];
