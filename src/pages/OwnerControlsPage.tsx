/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw, AlertTriangle } from "lucide-react";
import { DEFAULT_FEATURE_PERMISSIONS } from "../constants/featurePermissions";

/**
 * Pages that can be hidden.
 *
 * Excluded on purpose:
 *  - owner_controls  — hiding this page would be meaningless (the Developer
 *                      sees it regardless) and confusing, so it isn't offered.
 *  - clear_activity  — an action permission, not a navigable page.
 */
const NON_HIDEABLE = new Set(["owner_controls", "clear_activity"]);
const HIDEABLE_PAGES = DEFAULT_FEATURE_PERMISSIONS.filter((f) => !NON_HIDEABLE.has(f.id));

interface OwnerControlsPageProps {
  theme: "light" | "dark";
  /** Hidden feature ids, lifted to App so hasAccess() can read them. */
  hiddenPages: string[];
  setHiddenPages: (ids: string[]) => void;
  /** Same resolveAccess()-backed evaluator every other governed feature's
   * page uses — see App.tsx's hasAccess(). Toggling a page's visibility
   * requires Editor access on "owner_controls" (no longer a hardcoded
   * Developer-only exception as of 2026-09 — see featurePermissions.ts);
   * someone with only Viewer access can reach this page (nav requires just
   * Viewer) but sees the toggles disabled rather than have them silently
   * 403 on click. */
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

/**
 * Feature Visibility — page visibility kill switch (renamed from "Developer
 * Controls", then "Access Controls" — now that the QA Dashboard/Product
 * Playbook connection settings that used to also live on this page have
 * moved to their own Connections page — see ConnectionsPage.tsx — leaving
 * this page dedicated purely to page visibility).
 *
 * Purpose: let the Developer hide a page from everyone else while work on it
 * is in progress, without touching tiers or the permissions registry.
 *
 * Deliberately minimal — every page is simply Visible or Hidden. It does NOT
 * consider tiers, roles, or per-user rules; `featurePermissions` still
 * governs who MAY use a page once it's visible. The two systems are
 * independent on purpose, so hiding something temporarily can never corrupt
 * the real access model.
 *
 * HARD GUARANTEE: hiding never applies to the Developer. hasAccess() in
 * App.tsx returns true for Developer before the hidden set is consulted, so
 * the Developer always sees every page — including this one. That makes it
 * impossible to lock yourself out.
 */
export function OwnerControlsPage({ theme, hiddenPages, setHiddenPages, hasAccess }: OwnerControlsPageProps) {
  const dark = theme === "dark";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canManage = hasAccess("owner_controls", "Editor");

  const hiddenSet = new Set(hiddenPages);
  // Count only hidden rows that still correspond to a currently-registered
  // page — hiddenSet itself can carry stale entries for a feature that was
  // since removed/renamed from DEFAULT_FEATURE_PERMISSIONS (its hidden row
  // in the DB was never cleaned up), which would otherwise inflate this
  // count above the number of rows actually marked "Hidden" below.
  const visibleHiddenCount = HIDEABLE_PAGES.filter((f) => hiddenSet.has(f.id)).length;

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/page-visibility");

      // The server's SPA fallback (app.get("*") -> index.html) answers ANY
      // unmatched GET with 200 + HTML. Without this content-type check a
      // missing/stale route reads as an empty-but-successful response, so the
      // page silently shows "0 hidden" instead of telling you the API isn't
      // there — which is exactly what happened the first time this shipped.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          "The /api/page-visibility route did not respond. The server is most likely running an older build — restart it (npm run dev)."
        );
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setHiddenPages((body.entries || []).filter((e: any) => e.hidden).map((e: any) => e.featureId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load page visibility.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (featureId: string, nextHidden: boolean) => {
    setBusyId(featureId);
    try {
      const res = await fetch(`/api/page-visibility/${encodeURIComponent(featureId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: nextHidden }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) {
        // No SPA fallback exists for PUT, so an unmatched route 404s cleanly.
        // Almost always a stale server process rather than a real bug.
        throw new Error(
          "Route not found (404). The server is running an older build — restart it (npm run dev), and make sure migration 0016 has been applied (npm run db:migrate)."
        );
      }
      if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
      const next = new Set(hiddenSet);
      if (nextHidden) next.add(featureId);
      else next.delete(featureId);
      setHiddenPages([...next]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update this page.");
    } finally {
      setBusyId(null);
    }
  };

  const cardClass = `rounded-2xl border ${
    // --surface-elevated already carries its own baked-in translucency
    // (Unified Surface Philosophy) — no extra opacity modifier, or it
    // would compound past the app-wide standard.
    dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"
  }`;

  return (
    <div className="space-y-5 text-left">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            dark ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Feature Visibility</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Hide pages from everyone else while work is in progress. Hidden pages remain fully visible to you.
          </p>
        </div>
      </div>

      {/* Notice */}
      <div
        className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-xs font-semibold ${
          dark ? "bg-amber-500/10 border-amber-500/25 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-800"
        }`}
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          This only controls whether a page is shown. It does not change tiers or permissions — who <em>may</em> use a
          visible page is still governed by the Access Control Center. You will always see every page regardless of these settings.
          {!canManage && " You can view this list, but you don't have permission to change it."}
        </span>
      </div>

      {error && (
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-semibold ${
            dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Page list */}
      <div className={`p-5 ${cardClass}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
          <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
            Page Visibility
          </h3>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-mono ${dark ? "text-stone-400" : "text-stone-500"}`}>
              {visibleHiddenCount} hidden / {HIDEABLE_PAGES.length} pages
            </span>
            <button
              type="button"
              onClick={refresh}
              title="Refresh"
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {HIDEABLE_PAGES.map((feature) => {
            const isHidden = hiddenSet.has(feature.id);
            const isBusy = busyId === feature.id;
            return (
              <div
                key={feature.id}
                className={`flex items-center justify-between gap-4 p-3 rounded-lg border ${
                  dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>{feature.name}</span>
                    {isHidden && (
                      <span className="text-[8.5px] font-black uppercase tracking-wide px-1.5 py-[1px] rounded border bg-rose-500/10 text-rose-500 border-rose-500/25">
                        Hidden
                      </span>
                    )}
                  </div>
                  <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>{feature.description}</p>
                </div>

                {/* Visible / Hidden toggle.
                    The switch reads as ON = visible, so the "on" state is
                    the permissive one and the track colour matches the
                    label beside it. role="switch" + aria-checked so it is
                    announced as a toggle rather than a plain button. */}
                <div className="shrink-0 flex items-center gap-2.5">
                  <span
                    className={`text-[10px] font-black uppercase tracking-wider w-12 text-right ${
                      isHidden
                        ? dark ? "text-rose-300" : "text-rose-600"
                        : dark ? "text-emerald-300" : "text-emerald-600"
                    }`}
                  >
                    {isHidden ? "Hidden" : "Visible"}
                  </span>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={!isHidden}
                    aria-label={`${feature.name} visibility`}
                    disabled={isBusy || !canManage}
                    onClick={() => toggle(feature.id, !isHidden)}
                    title={!canManage ? "You don't have permission to change this" : isHidden ? "Show this page to everyone" : "Hide this page from everyone except you"}
                    className={`relative w-11 h-6 rounded-full border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
                      isHidden
                        ? dark
                          ? "bg-rose-500/20 border-rose-500/40"
                          : "bg-rose-100 border-rose-300"
                        : dark
                          ? "bg-emerald-500/25 border-emerald-500/45"
                          : "bg-emerald-100 border-emerald-400"
                    }`}
                  >
                    {/* Track is 44px wide with 1px borders, so the padding
                        box the knob is positioned within is 42px. An 18px
                        knob at left-1 (4px) and left-5 (20px) leaves an even
                        4px gap at either end. */}
                    <span
                      className={`absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm ${
                        isHidden ? "left-1" : "left-5"
                      } ${
                        isHidden
                          ? dark ? "bg-rose-400" : "bg-rose-500"
                          : dark ? "bg-emerald-400" : "bg-emerald-500"
                      }`}
                      style={{ width: "18px", height: "18px" }}
                    >
                      {isHidden
                        ? <EyeOff className="w-2.5 h-2.5 text-white" />
                        : <Eye className="w-2.5 h-2.5 text-white" />}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
