/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import PlanScopeManager from "../components/PlanScopeManager";

interface PlanScopePageProps {
  productionPlans: string[];
  theme: "light" | "dark";
}

/**
 * "Specific Illness Ledger" / plan scope tab content. Extracted verbatim
 * from App.tsx (Phase 1.3). The `activeTab === "plan_scope" && currentUser`
 * condition and wrapping `<motion.div key="plan_scope">` deliberately stay
 * in App.tsx (see ResourcesPage.tsx for why).
 *
 * Note (Phase 1.5): PlanScopeManager only ever reads `productionPlans` and
 * `theme` internally, so this page (and the App.tsx call site) were trimmed
 * to stop threading the unused draftPlans/setDraftPlans/currentUser/
 * changeLogs/setChangeLogs/planQuestionsState/setPlanQuestionsState/
 * insurerMetadata/setInsurerMetadata/effectiveTier/hasAccess props down to
 * it. Those values remain declared in App.tsx's own state (used by other
 * tabs) - only the pass-through to this tab was removed.
 */
export function PlanScopePage({
  productionPlans,
  theme,
}: PlanScopePageProps) {
  return (
    <PlanScopeManager
      productionPlans={productionPlans}
      theme={theme}
    />
  );
}
