/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Converts a DB-stored plan_configs row (tagged questions array) into the
 * flat PlanConfig shape engine.ts expects — mirrors how the client used to
 * derive this in App.tsx's (now-retired) planConfigs merge useMemo.
 *
 * Pulled out of server.ts into its own side-effect-free module (was
 * previously a private function there) specifically so
 * scripts/validatePedMigration.ts (Phase 4) can resolve plan configs
 * exactly the same way /api/match does, without importing server.ts
 * itself — server.ts has top-level `app.listen(...)` / Vite dev-server
 * side effects that fire the moment it's imported, which is fine for the
 * actual running server but breaks any script that only wants one pure
 * helper function out of it.
 */
export function dbRowToPlanConfig(row: {
  questions: unknown;
  anyOther: string;
  hasUmbrella: boolean;
  umbrellaQuestions: unknown;
  categoryMap: unknown;
  overrides: unknown;
}) {
  const taggedQuestions = (row.questions as Array<{ text: string; tag: string }>) || [];
  // Matches the hardcoded PlanConfig shape: `questions` holds every Specific
  // + the Catch-all text (umbrella questions are tracked separately).
  const questions = taggedQuestions.filter((q) => q.tag !== "Umbrella").map((q) => q.text);
  return {
    questions,
    anyOther: row.anyOther,
    hasUmbrella: row.hasUmbrella,
    umbrellaQuestions: (row.umbrellaQuestions as string[]) || [],
    categoryMap: (row.categoryMap as Record<string, string | number>) || {},
    overrides: (row.overrides as PlanOverridesShape) || undefined,
  };
}

export type PlanOverridesShape = { excludePrediabetes?: boolean; requiresInsulinForDiabetes?: boolean; bypassBenignTumors?: boolean };
