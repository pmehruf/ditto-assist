/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DisclosureMap from "../components/DisclosureMap";

interface ResourcesPageProps {
  theme: "light" | "dark";
}

/**
 * "Declaration Map" resources tab content. Extracted verbatim from App.tsx
 * (Phase 1.3). Note: the `activeTab === "resources" && (...)` condition and
 * the wrapping `<motion.div key="resources">` deliberately stay in App.tsx
 * (see the AnimatePresence block there) rather than moving in here — moving
 * them into this component would make them invisible to the parent
 * `<AnimatePresence>`, silently breaking the tab's exit animation (framer
 * motion only detects a child's removal when that child is a *direct* child
 * of AnimatePresence; an always-mounted wrapper component that internally
 * renders null does not count as a removal).
 */
export function ResourcesPage({ theme }: ResourcesPageProps) {
  return (
    <>
      {/* PAGE-LEVEL HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>Declaration Map</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Comprehensive visual guide to medical declaration rules and payout mapping structures.
          </p>
        </div>
      </div>

      <div className="space-y-5 pb-6">
        <DisclosureMap theme={theme} />
      </div>
    </>
  );
}
