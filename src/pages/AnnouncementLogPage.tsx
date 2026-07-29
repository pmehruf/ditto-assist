/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { QAAnnouncementForm } from "../components/forms/QAAnnouncementForm";
import { renderFormattedAnnouncement } from "../utils/renderFormattedAnnouncement";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "../components/ClippedButton";

/**
 * Urgency accent used for the card's left border + small status pill.
 * Replaces the old per-item full-card color wash (which forced a fixed
 * dark background on 3 hardcoded announcements regardless of theme,
 * making body text unreadable in Light mode). Every value below is a
 * verified >=4.5:1 pairing of `text` against its own `badgeBg`, in both
 * themes, so the pill is always legible no matter which theme is active.
 */
function getUrgencyStyle(diffDays: number, theme: "light" | "dark") {
  const dark = theme === "dark";
  if (diffDays === 0) {
    return {
      label: "CRITICAL TODAY",
      text: dark ? "#f87171" : "#991b1b",
      badgeBg: dark ? "rgba(239,68,68,0.14)" : "rgba(254,226,226,0.85)",
      badgeBorder: dark ? "rgba(239,68,68,0.32)" : "rgba(239,68,68,0.28)",
    };
  }
  if (diffDays === 1) {
    return {
      label: "IMMEDIATE IN 1 DAY",
      text: dark ? "#fbbf24" : "#78350f",
      badgeBg: dark ? "rgba(245,158,11,0.14)" : "rgba(254,243,199,0.85)",
      badgeBorder: dark ? "rgba(245,158,11,0.30)" : "rgba(245,158,11,0.26)",
    };
  }
  if (diffDays > 1 && diffDays <= 3) {
    return {
      label: `CRITICAL IN ${diffDays} DAYS`,
      text: dark ? "#fb923c" : "#9a3412",
      badgeBg: dark ? "rgba(249,115,22,0.14)" : "rgba(255,237,213,0.85)",
      badgeBorder: dark ? "rgba(249,115,22,0.30)" : "rgba(249,115,22,0.26)",
    };
  }
  if (diffDays > 3 && diffDays <= 7) {
    return {
      label: `UPCOMING IN ${diffDays} DAYS`,
      text: "var(--teal)",
      badgeBg: dark ? "rgba(45,212,191,0.14)" : "rgba(45,212,191,0.16)",
      badgeBorder: "rgba(45,212,191,0.30)",
    };
  }
  if (diffDays < 0) {
    const absVal = Math.abs(diffDays);
    return {
      label: `EFFECTIVE ${absVal} ${absVal === 1 ? "DAY" : "DAYS"} AGO`,
      text: dark ? "#94a3b8" : "#57534e",
      badgeBg: dark ? "rgba(148,163,184,0.12)" : "rgba(120,113,108,0.12)",
      badgeBorder: dark ? "rgba(148,163,184,0.24)" : "rgba(120,113,108,0.24)",
    };
  }
  return {
    label: `IN ${diffDays} DAYS`,
    text: "var(--accent)",
    badgeBg: "var(--accent-subtle-bg)",
    badgeBorder: "var(--accent-border)",
  };
}

interface AnnouncementLogPageProps {
  theme: "light" | "dark";
  qaAnnouncements: QAAnnouncement[];
  setQaAnnouncements: Dispatch<SetStateAction<QAAnnouncement[]>>;
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  editingAnnouncementId: string | null;
  setEditingAnnouncementId: (id: string | null) => void;
  deletingAnnouncementId: string | null;
  setDeletingAnnouncementId: (id: string | null) => void;
}

/**
 * "Announcement Manager" (qa_announcement_log) tab content. Extracted
 * verbatim from App.tsx (Phase 1.3). The `activeTab === "qa_announcement_log"`
 * condition and wrapping `<motion.div key="qa_announcement_log">`
 * deliberately stay in App.tsx (see ResourcesPage.tsx for why).
 */
export function AnnouncementLogPage({
  theme,
  qaAnnouncements,
  setQaAnnouncements,
  currentUser,
  setChangeLogs,
  editingAnnouncementId,
  setEditingAnnouncementId,
  deletingAnnouncementId,
  setDeletingAnnouncementId,
}: AnnouncementLogPageProps) {
  return (
    /* Fills the app's content area on lg+ (main is lg:flex lg:flex-col
       lg:min-h-0 for this tab) so the two cards below share exactly the
       remaining height — no hardcoded viewport offsets, no page scroll. */
    <div className="space-y-5 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800 lg:shrink-0">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>Announcement Manager</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Manage and view compliance updates, premium policy exceptions, and payment guidelines with proximity-based visual urgency triggers.
          </p>
        </div>
      </div>

      {/* Grid content split: Adder Form Left / List on Right.
          Takes the height left over after the header (lg:flex-1 + min-h-0)
          rather than a hardcoded 100vh offset, so both cards always end
          exactly at the viewport edge and each scrolls internally. Below lg
          the columns stack and flow naturally. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch lg:flex-1 lg:min-h-0">

        {/* Form card (5 cols) */}
        <div className="col-span-1 lg:col-span-5 flex flex-col min-h-0">
          <div className={`p-5 rounded-2xl border flex flex-col h-full min-h-0 overflow-hidden ${
            /* Light theme uses the design system's own surface tokens rather
               than one-off hex values: --surface-elevated (#EBF1F7, "inset
               steel-blue panels") for the primary card, with --border
               (#D2DFEC). The announcement tiles inside step down to
               --surface-inset (#D9E4F0), giving the same two-tone ice-blue
               pairing used by the Specific Illness ledger. Opaque, so no
               warm bleed-through from the page gradient. Dark unchanged. */
            theme === "dark"
              ? "bg-white/[0.03] border-white/[0.08]"
              : "bg-surface-elevated/70 border-[#D2DFEC]"
          }`}>
            {/* The form owns its own three-part layout (fixed header,
                scrolling fields, pinned submit footer), so it just needs the
                card's full height — no outer scroll wrapper. */}
            <QAAnnouncementForm
              theme={theme}
              qaAnnouncements={qaAnnouncements}
              setQaAnnouncements={setQaAnnouncements}
              currentUser={currentUser}
              setChangeLogs={setChangeLogs}
              editingAnnouncementId={editingAnnouncementId}
              setEditingAnnouncementId={setEditingAnnouncementId}
            />
          </div>
        </div>

        {/* List card (7 cols) */}
        <div className="col-span-1 lg:col-span-7 flex flex-col min-h-0">
          <div className={`p-5 rounded-2xl border flex flex-col h-full min-h-0 overflow-hidden ${
            /* Light theme uses the design system's own surface tokens rather
               than one-off hex values: --surface-elevated (#EBF1F7, "inset
               steel-blue panels") for the primary card, with --border
               (#D2DFEC). The announcement tiles inside step down to
               --surface-inset (#D9E4F0), giving the same two-tone ice-blue
               pairing used by the Specific Illness ledger. Opaque, so no
               warm bleed-through from the page gradient. Dark unchanged. */
            theme === "dark"
              ? "bg-white/[0.03] border-white/[0.08]"
              : "bg-surface-elevated/70 border-[#D2DFEC]"
          }`}>
            <div className="space-y-4 h-full flex flex-col min-h-0">
              <div className="flex justify-between items-center pb-2 border-b border-light-stone/5 dark:border-stone-800">
                <h3 className={`text-sm font-bold uppercase tracking-wider ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                  Active Announcements ({qaAnnouncements.length})
                </h3>
                <span className="text-[10px] font-mono text-content-muted">
                  Active Sort: Newest First
                </span>
              </div>

              {/* Masonry gallery.
                  The scroller and the multi-column element are deliberately
                  SEPARATE: a multi-column box with a constrained height
                  overflows sideways (spawning columns to the right) instead
                  of downward, which would break vertical scrolling. So the
                  outer div owns the fixed height + vertical scroll, and the
                  inner `columns-2` box keeps auto height and balances the
                  tiles into two independent vertical stacks — no row
                  alignment between columns. */}
              <div className="flex-grow min-h-0 overflow-y-auto overflow-x-hidden pr-2">
                <div className="columns-2 gap-4">
                {qaAnnouncements.length === 0 ? (
                  <div className="text-center py-20 text-xs italic text-stone-500 select-none">
                    No active announcements. Use the form on the left to add one.
                  </div>
                ) : (
                  // Newest first, by Announcement Date (when the notice was
                  // posted — the same date shown to advisors and used to
                  // decide which announcements they see), not proximity to
                  // today's effective date. `qaAnnouncements` already arrives
                  // from GET /api/announcements ordered newest-created-first
                  // (see announcementsRepository.ts's `orderBy(desc(createdAt))`),
                  // and Array.prototype.sort is stable, so entries sharing the
                  // same Announcement Date keep that creation-order tiebreak
                  // automatically — no separate secondary sort key needed.
                  [...qaAnnouncements]
                    .sort((a, b) => {
                      const aTime = a.announcementDate ? new Date(a.announcementDate).getTime() : 0;
                      const bTime = b.announcementDate ? new Date(b.announcementDate).getTime() : 0;
                      return bTime - aTime;
                    })
                    .map((item) => {
                      const today = new Date();
                      const diffDays = Math.ceil((new Date(item.effectiveDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      const urgency = getUrgencyStyle(diffDays, theme);

                      return (
                        <div
                          key={item.id}
                          className={`w-full max-h-[255px] break-inside-avoid mb-4 p-3.5 rounded-xl border-l-[3px] text-left transition-all relative overflow-hidden flex flex-col border ${
                            /* White tiles on the translucent ice-blue card —
                               same treatment as the form's input fields, so
                               every "content" surface on this page reads as
                               one consistent layer. */
                            theme === "dark" ? "bg-[#12151A] border-[#252A34]" : "bg-white border-[#D2DFEC]"
                          }`}
                          style={{ borderLeftColor: urgency.text }}
                        >
                          {/* Header (tags + actions) is pinned — only the
                              announcement body below scrolls, so the tile
                              keeps its exact height no matter how long the
                              content is. */}
                          <div className="shrink-0">
                            {/* Compact tag row — smaller type and tighter
                                padding than before so the tags claim as
                                little of the fixed tile height as possible,
                                leaving more room for the body. */}
                            <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
                              <div className="flex items-center gap-1 flex-wrap min-w-0">
                                {/* Uppercase removed from category/type pills below:
                                    both are open-ended, admin-entered text (e.g.
                                    "Health SOP Update - Chats/Calls/Payments") rather
                                    than a short fixed vocabulary, so forcing them into
                                    caps hurt readability on the longer real-world values.
                                    Bounded-vocabulary pills elsewhere (urgency labels,
                                    Rating:, table-header caps) are unaffected. */}
                                <span
                                  className="text-[8.5px] font-mono font-bold bg-[#3B82F6]/10 px-1.5 py-[1px] rounded border border-[#3B82F6]/25"
                                  style={{ color: "var(--accent)" }}
                                >
                                  {item.category}
                                </span>
                                {item.type && (
                                  <span className={`text-[8.5px] font-mono font-bold px-1.5 py-[1px] rounded border ${
                                    /* bg-amber-500/10 + text-amber-500 (unchanged below for
                                       dark) reads fine on a near-black card, but that exact
                                       10%-opacity amber wash is nearly invisible against a
                                       white card and amber-500 text itself is low-contrast
                                       on white — that's the "washed out" pill the light
                                       theme showed. Swapped to solid amber-50/amber-700 for
                                       light, matching the higher-contrast pairing already
                                       used by the urgency pills below. */
                                    theme === "dark"
                                      ? "bg-amber-500/10 text-amber-500 border-amber-500/25"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  }`}>
                                    {item.type}
                                  </span>
                                )}
                                {item.effectiveDate && (
                                  <span
                                    className="text-[7.5px] uppercase font-black px-1 py-[1px] rounded tracking-wider border"
                                    style={{ color: urgency.text, backgroundColor: urgency.badgeBg, borderColor: urgency.badgeBorder }}
                                  >
                                    {urgency.label}
                                  </span>
                                )}
                                {item.type === "QA Announcement" && item.rating !== undefined && item.rating > 0 && (
                                  <span className={`text-[8.5px] uppercase font-mono font-bold px-1.5 py-[1px] rounded border ${
                                    /* Same light-theme contrast fix as the type pill above. */
                                    theme === "dark"
                                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}>
                                    Rating: {item.rating}
                                  </span>
                                )}
                              </div>

                              {deletingAnnouncementId === item.id ? (
                                <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-lg select-none">
                                  <span className="text-[9px] font-black uppercase text-red-500 tracking-wider">
                                    Sure?
                                  </span>
                                  <ClippedButton
                                    type="button"
                                    cornerBg={theme === "dark" ? "#12151A" : "#EBF1F7"}
                                    onClick={() => {
                                      // NOTE (audit fix, see Production_Readiness_Audit.md
                                      // Finding 3): deletes now round-trip through the server
                                      // (announcements table) — previously this only removed
                                      // the item from this browser's own localStorage, so it
                                      // would reappear for every other user.
                                      const targetId = item.id;
                                      setQaAnnouncements(prev => prev.filter(p => p.id !== targetId));
                                      setDeletingAnnouncementId(null);
                                      fetch(`/api/announcements/${targetId}`, { method: "DELETE" }).catch((err) => {
                                        console.error("Failed to delete announcement on the server:", err);
                                      });
                                      // Log activity
                                      setChangeLogs(prev => [
                                        {
                                          id: `log-${Date.now()}`,
                                          timestamp: new Date().toISOString(),
                                          userName: currentUser?.name || "Mehruf P (Developer)",
                                          // Phase 1.4 resolution: `role` never existed on LoggedUser (only `tier`
                                          // does), so `(currentUser as any)?.role` was always `undefined` and this
                                          // always fell back to "Developer" — provably, for every possible currentUser.
                                          // Simplified to the constant it always evaluated to; this is a type-safety
                                          // cleanup only, with byte-identical runtime behavior to before.
                                          role: "Developer",
                                          actionType: "Announcement Deleted",
                                          planName: item.category,
                                          description: `Deleted "${item.type || 'QA Announcement'}" announcement: "${item.announcement.substring(0, 50)}..."`
                                        },
                                        ...prev
                                      ]);
                                    }}
                                    className="px-1.5 py-0.5 text-[9px] bg-red-650 hover:bg-red-700 bg-red-600 text-white font-black"
                                  >
                                    Delete
                                  </ClippedButton>
                                  <ClippedButton
                                    type="button"
                                    onClick={() => setDeletingAnnouncementId(null)}
                                    cornerBg={theme === "dark" ? "#12151A" : "#EBF1F7"}
                                    className="px-1.5 py-0.5 text-[9px] bg-stone-500 hover:bg-stone-600 text-white font-black"
                                  >
                                    Cancel
                                  </ClippedButton>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <ClippedButton
                                    type="button"
                                    onClick={() => setEditingAnnouncementId(item.id)}
                                    cornerBg={theme === "dark" ? "#12151A" : "#EBF1F7"}
                                    // stone-400 reads fine against the near-black dark
                                    // tile but is too pale/low-contrast against the
                                    // plain white light-theme tile — that's the
                                    // washed-out, "off" icon look. stone-500 keeps the
                                    // same restrained (non-colored) resting state while
                                    // staying legible on white.
                                    className={`p-1 hover:text-blue-500 hover:bg-blue-500/10 ${
                                      theme === "dark" ? "text-stone-400" : "text-stone-500"
                                    }`}
                                    title="Edit notice"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                  <ClippedButton
                                    type="button"
                                    onClick={() => {
                                      setDeletingAnnouncementId(item.id);
                                    }}
                                    cornerBg={theme === "dark" ? "#12151A" : "#EBF1F7"}
                                    className={`p-1 hover:text-red-500 hover:bg-red-500/10 ${
                                      theme === "dark" ? "text-stone-400" : "text-stone-500"
                                    }`}
                                    title="Delete notice"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Body — the only scrolling region inside a tile.
                              Intentionally NOT `flex-1`: with flex-basis 0 in
                              an auto-height tile it would contribute no
                              height and collapse. Natural height + min-h-0
                              lets a short announcement size the tile down,
                              while a long one is capped by the tile's
                              max-height and scrolls here instead. */}
                          <div className="min-h-0 overflow-y-auto pr-1 text-xs leading-relaxed font-normal font-sans text-stone-850 dark:text-stone-100">
                            {renderFormattedAnnouncement(item.announcement, theme)}
                          </div>

                          {/* Metadata footer — both dates are shown, since
                              they mean different things: Announced is when
                              the notice was posted (and is what decides which
                              announcements advisors see), Effective is when
                              the rule it describes takes effect. Effective
                              and Valid Till are omitted entirely when unset
                              rather than rendering an empty label. */}
                          <div className="shrink-0 flex items-center justify-between gap-3 text-[9px] font-mono text-content-muted border-t border-dashed border-stone-200/20 pt-2 mt-2 w-full animate-fade-in">
                            <span className="truncate">By: <span className="font-semibold">{item.addedBy}</span></span>
                            <div className="flex gap-2.5 shrink-0 whitespace-nowrap">
                              {item.announcementDate && (
                                <span>Announced: <span className="font-semibold">{item.announcementDate}</span></span>
                              )}
                              {item.effectiveDate && (
                                <span className="text-sky-600 dark:text-sky-400">
                                  Effective: <span className="font-semibold">{item.effectiveDate}</span>
                                </span>
                              )}
                              {item.validTillDate && (
                                <span className="text-red-450 dark:text-red-400 font-bold bg-red-500/10 px-1 rounded">Valid Till: {item.validTillDate}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
