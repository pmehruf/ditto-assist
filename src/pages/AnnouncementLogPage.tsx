/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Pencil, Trash2, Search, Maximize2, Download } from "lucide-react";
import { QAAnnouncementForm } from "../components/forms/QAAnnouncementForm";
import { AnnouncementContent } from "../components/AnnouncementContent";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "../components/ClippedButton";
import { Pagination } from "../components/Pagination";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { isoDateToDMY } from "../utils/dateFormat";
import { ratingColorClasses, teamLabel } from "../utils/announcementDisplay";
import { AnnouncementReadModal } from "../components/AnnouncementReadModal";
import { downloadCSV } from "../utils/csvExport";

const PAGE_SIZE = 25;

// Maps a raw server announcements-table row into this app's client-side
// QAAnnouncement shape — same mapping App.tsx's mapAnnouncementRow and
// QAAnnouncementForm.tsx's mapRow already apply to every other fetch of this
// table. This page's own paginated fetch (below) used to skip this and hand
// the raw row straight to `entries`, which left `id` as the DB's native
// number instead of the `String(row.id)` every other announcements array in
// the app uses — so clicking Edit here set `editingAnnouncementId` to a
// number that could never strictly-equal a string id in `qaAnnouncements`,
// and the form's by-id lookup silently found nothing. Also fixes `from`
// (the row's real field is `fromTeam`), which had the same "never actually
// wired up" problem for General Announcements' team field.
function mapAnnouncementRow(row: any): QAAnnouncement {
  return {
    id: String(row.id),
    announcement: row.announcement,
    effectiveDate: row.effectiveDate ?? undefined,
    category: row.category,
    addedBy: row.addedBy,
    rating: row.rating ?? undefined,
    type: row.type ?? "QA Announcement",
    validTillDate: row.validTillDate ?? undefined,
    title: row.title ?? undefined,
    from: row.fromTeam ?? undefined,
    announcementDate: row.announcementDate ?? undefined,
    team: row.team === "Term" ? "Term" : "Health",
  };
}

/** Advisor-audience badge label — distinct from teamLabel() in
 * announcementDisplay.ts, which labels the unrelated `from`/fromTeam
 * "posted from which department" field. This is who the announcement is
 * VISIBLE to (Health Advisors vs Term Advisors), not who wrote it. */
function audienceLabel(item: QAAnnouncement): string {
  return item.team === "Term" ? "Term Advisors" : "Health Advisors";
}

/**
 * Urgency accent used for the Effective Date cell's small status pill —
 * proximity of `effectiveDate` to today. Every value below is a verified
 * >=4.5:1 pairing of `text` against its own `badgeBg`, in both themes, so
 * the pill is always legible no matter which theme is active.
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
 *
 * List side is a table (not the old masonry tile gallery) — same
 * column/click-to-expand shape as the advisor-facing Announcements archive
 * (AnnouncementArchivePage.tsx), but every piece of information the old
 * tiles showed is still here: category/title, type, rating, the
 * proximity-based urgency pill, addedBy, both dates, Valid Till when set,
 * and the Edit/Delete actions with their inline "Sure?" confirm.
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
  const dark = theme === "dark";

  // Self-fetched paginated/searched view for THIS admin gallery only.
  // `qaAnnouncements` (the full, unbounded array from App.tsx) stays exactly
  // as-is and keeps feeding the carousel/banner and the edit-form's
  // by-id lookup — neither of those is touched here. This component just
  // stops rendering that full array directly and instead asks the server
  // for one page at a time (25/page, per spec).
  const [entries, setEntries] = useState<QAAnnouncement[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput);
  const [openItem, setOpenItem] = useState<QAAnnouncement | null>(null);
  // Bumped only when the create/edit form actually saves something (see
  // handleFormAnnouncementsChange below) — the signal this gallery needs to
  // refetch, decoupled from App.tsx's own one-time mount fetch of the full
  // array so we don't double-fetch on load.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      paginated: "1",
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: "announcementDate",
      sortDir: "desc",
      // This gallery is the Announcement Manager (Admin/Developer only, per
      // featurePermissions.ts) — it must show announcements for BOTH
      // advisor audiences regardless of the admin's own tags, since
      // they're managing on behalf of everyone. See teamForTags in
      // server.ts for the tier-gated bypass this triggers server-side.
      includeAllTeams: "1",
    });
    const trimmed = debouncedSearch.trim();
    if (trimmed) params.set("search", trimmed);

    fetch(`/api/announcements?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data.entries) ? data.entries.map(mapAnnouncementRow) : []);
        setTotal(typeof data.total === "number" ? data.total : 0);
        setTotalPages(typeof data.totalPages === "number" ? data.totalPages : 1);
        // Server clamps out-of-range pages (e.g. after a delete empties the
        // last page) — sync that back so Previous/Next stay consistent.
        if (typeof data.page === "number" && data.page !== page) setPage(data.page);
      })
      .catch((err) => {
        console.error("Failed to load announcements:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, debouncedSearch, refreshTick]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ paginated: "1", pageSize: "10000", sortBy: "announcementDate", sortDir: "desc", includeAllTeams: "1" });
      const trimmed = debouncedSearch.trim();
      if (trimmed) params.set("search", trimmed);
      const res = await fetch(`/api/announcements?${params.toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to export (HTTP ${res.status}).`);
      const rows = (Array.isArray(body.entries) ? body.entries.map(mapAnnouncementRow) : []) as QAAnnouncement[];
      downloadCSV(
        rows.map((item) => ({
          Title: item.title || item.category || "",
          Audience: audienceLabel(item),
          "From Team": teamLabel(item),
          Severity: item.type === "QA Announcement" ? item.rating ?? "" : "",
          Announcement: item.announcement.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
          "Announcement Date": item.announcementDate ? isoDateToDMY(item.announcementDate) : "",
          "Effective Date": item.effectiveDate ? isoDateToDMY(item.effectiveDate) : "",
          "Added By": item.addedBy || "",
        })),
        "announcement-manager.csv"
      );
    } catch (err) {
      console.error("Failed to export announcements:", err);
    } finally {
      setExporting(false);
    }
  };

  // QAAnnouncementForm updates the app-wide `qaAnnouncements` array directly
  // on create/edit — this wrapper just also nudges this gallery to refetch
  // its own current page so the change shows up here too.
  const handleFormAnnouncementsChange: Dispatch<SetStateAction<QAAnnouncement[]>> = (update) => {
    setQaAnnouncements(update);
    setRefreshTick((t) => t + 1);
  };

  const handleDelete = (item: QAAnnouncement) => {
    // NOTE (audit fix, see Production_Readiness_Audit.md Finding 3): deletes
    // now round-trip through the server (announcements table) — previously
    // this only removed the item from this browser's own localStorage, so
    // it would reappear for every other user.
    const targetId = item.id;
    setQaAnnouncements(prev => prev.filter(p => p.id !== targetId));
    setEntries(prev => prev.filter(p => p.id !== targetId));
    setTotal(prev => Math.max(0, prev - 1));
    setDeletingAnnouncementId(null);
    fetch(`/api/announcements/${targetId}`, { method: "DELETE" }).catch((err) => {
      console.error("Failed to delete announcement on the server:", err);
    });
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
  };

  const cardClass = `p-4 rounded-2xl border flex flex-col h-full min-h-0 overflow-hidden ${
    /* Light theme uses the design system's own surface tokens rather
       than one-off hex values: --surface-elevated for the primary card,
       with --border (#D2DFEC). --surface-elevated already carries its own
       baked-in translucency (Unified Surface Philosophy), so no extra
       opacity modifier here — stacking one would compound past the
       app-wide standard. Dark unchanged. */
    dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"
  }`;
  const thClass = `text-left text-[9.5px] font-black uppercase tracking-wider px-2.5 py-2 whitespace-nowrap sticky top-0 z-10 ${
    dark ? "bg-[#0c1420] text-stone-400 border-b border-white/[0.08]" : "bg-[#EBF1F7] text-stone-500 border-b border-[#D2DFEC]"
  }`;
  const tdClass = `align-top px-2.5 py-2.5 text-[11px] break-words ${dark ? "text-stone-200" : "text-stone-700"}`;

  return (
    /* Fills the app's content area on lg+ (main is lg:flex lg:flex-col
       lg:min-h-0 for this tab) so the two cards below share exactly the
       remaining height — no hardcoded viewport offsets, no page scroll.
       space-y-5 -> space-y-3 and the header's pb-3 -> pb-2 below: a small,
       deliberate trim (not a redesign) to reclaim vertical room now that
       the app-wide auto-zoom feature makes every fixed-px gap read bigger
       on a large monitor. */
    <div className="space-y-3 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2 border-b border-stone-200 dark:border-stone-800 lg:shrink-0">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            dark ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Announcement Manager</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Manage and view compliance updates, premium policy exceptions, and payment guidelines with proximity-based visual urgency triggers.
          </p>
        </div>
      </div>

      {/* Stacked, not side-by-side: form on top, Active Announcements below
          — both now get the page's full width instead of a 5/12 or 7/12
          column, which was cramping the form's fields and the table's
          columns alike. Takes the height left over after the header
          (lg:flex-1 + min-h-0) rather than a hardcoded 100vh offset, so
          the whole stack always ends exactly at the viewport edge; the
          two cards split that height roughly 42:58 (lg:flex-[5]/flex-[7],
          the same ratio their column-spans used to be) so each keeps
          scrolling internally exactly as before, just on the vertical
          axis instead of side by side. Below lg both are natural-height
          and the page flows/scrolls normally, same as before. */}
      <div className="flex flex-col gap-4 lg:flex-1 lg:min-h-0">

        {/* Form card */}
        <div className="flex flex-col min-h-0 lg:flex-[5]">
          <div className={cardClass}>
            {/* The form owns its own three-part layout (fixed header,
                scrolling fields, pinned submit footer), so it just needs the
                card's full height — no outer scroll wrapper. */}
            <QAAnnouncementForm
              theme={theme}
              // This gallery's own `entries` (fetched with includeAllTeams=1
              // above) — NOT App.tsx's `qaAnnouncements` prop — so the
              // form's by-id edit lookup finds a Term announcement even
              // though the current admin's own tags would otherwise
              // scope App.tsx's array to Health only (or vice versa).
              qaAnnouncements={entries}
              setQaAnnouncements={handleFormAnnouncementsChange}
              currentUser={currentUser}
              setChangeLogs={setChangeLogs}
              editingAnnouncementId={editingAnnouncementId}
              setEditingAnnouncementId={setEditingAnnouncementId}
            />
          </div>
        </div>

        {/* List card */}
        <div className="flex flex-col min-h-0 lg:flex-[7]">
          <div className={cardClass}>
            <div className="space-y-3 h-full flex flex-col min-h-0">
              <div className="flex justify-between items-center pb-2 border-b border-light-stone/5 dark:border-stone-800 shrink-0">
                <h3 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
                  Active Announcements ({total})
                </h3>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-content-muted">
                    Newest First
                  </span>
                  <ClippedButton
                    onClick={exportCsv}
                    disabled={exporting || total === 0}
                    size="sm"
                    title="Export the filtered announcements as a CSV file"
                    className="shrink-0 gap-1.5 pl-2 pr-2.5 py-1.5 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb]"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Export CSV</span>
                  </ClippedButton>
                </div>
              </div>

              {/* Search — server-side, across the full announcements table
                  (not just the current page). Debounced via useDebouncedValue;
                  a page-change effect resets to page 1 whenever the debounced
                  term changes. */}
              <div className="relative shrink-0">
                <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${
                  dark ? "text-stone-500" : "text-stone-400"
                }`} />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search announcements..."
                  className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border outline-none transition-colors ${
                    dark
                      ? "bg-white/[0.03] border-white/[0.08] text-white placeholder:text-stone-600 focus:border-white/20"
                      : "bg-white border-[#D2DFEC] text-stone-900 placeholder:text-stone-400 focus:border-[#4673a9]/50"
                  }`}
                />
              </div>

              {/* Table — replaces the old masonry tile gallery. Horizontally
                  scrolls on narrow viewports rather than dropping columns,
                  since every one of these fields was visible in the old
                  tiles and none of them are being cut. */}
              <div className="flex-grow min-h-0 overflow-auto rounded-lg border border-black/[0.04] dark:border-white/[0.06]">
                {entries.length === 0 ? (
                  <div className="text-center py-20 text-xs italic text-stone-500 select-none">
                    {loading
                      ? "Loading…"
                      : searchInput.trim()
                        ? "No announcements match your search."
                        : "No active announcements. Use the form on the left to add one."}
                  </div>
                ) : (
                  <table className="w-full border-collapse table-fixed">
                    <colgroup>
                      <col style={{ width: "36px" }} />
                      <col style={{ width: "17%" }} />
                      <col style={{ width: "8%" }} />
                      <col />
                      <col style={{ width: "88px" }} />
                      <col style={{ width: "108px" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "56px" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className={thClass}>#</th>
                        <th className={thClass}>Title</th>
                        <th className={thClass}>Severity</th>
                        <th className={thClass}>Announcement</th>
                        <th className={thClass}>Announced</th>
                        <th className={thClass}>Effective</th>
                        <th className={thClass}>Added By</th>
                        <th className={thClass}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((item, idx) => {
                        const diffDays = item.effectiveDate
                          ? Math.ceil((new Date(item.effectiveDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                          : null;
                        const urgency = diffDays !== null ? getUrgencyStyle(diffDays, theme) : null;

                        return (
                          <tr
                            key={item.id}
                            className={`border-b ${dark ? "border-white/[0.06] odd:bg-white/[0.015]" : "border-[#E4ECF5] odd:bg-black/[0.015]"}`}
                          >
                            <td className={`${tdClass} font-mono font-bold text-center`}>
                              {(page - 1) * PAGE_SIZE + idx + 1}
                            </td>

                            {/* Title — the category/type pill row lives here
                                too, exactly the info the old tile header
                                pills showed (category, type, team). */}
                            <td className={`${tdClass} font-bold`}>
                              <div>{item.title || item.category || "—"}</div>
                              <div className="flex items-center gap-1 flex-wrap mt-1">
                                {item.type && (
                                  <span className={`text-[8px] font-mono font-bold px-1 py-[1px] rounded border ${
                                    dark ? "bg-amber-500/10 text-amber-500 border-amber-500/25" : "bg-amber-50 text-amber-700 border-amber-200"
                                  }`}>
                                    {item.type}
                                  </span>
                                )}
                                {/* Which advisor audience this is visible to
                                    — always shown (both announcement types),
                                    since it's a new independent axis from
                                    Type/teamLabel below. */}
                                <span className={`text-[8px] font-mono font-bold px-1 py-[1px] rounded border ${
                                  item.team === "Term"
                                    ? dark ? "bg-purple-500/10 text-purple-400 border-purple-500/25" : "bg-purple-50 text-purple-700 border-purple-200"
                                    : dark ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/25" : "bg-cyan-50 text-cyan-700 border-cyan-200"
                                }`}>
                                  {audienceLabel(item)}
                                </span>
                                {/* teamLabel() returns "QA Announcement" for
                                    QA rows — identical to the Type pill right
                                    next to it, so showing both duplicated the
                                    same text. Only General Announcements have
                                    a distinct, informative team label (the
                                    "From" field), so the second pill only
                                    renders there. */}
                                {item.type === "General Announcement" && (
                                  <span className={`text-[8px] font-mono font-bold px-1 py-[1px] rounded border ${
                                    dark ? "bg-white/[0.04] text-stone-400 border-white/[0.08]" : "bg-stone-100 text-stone-600 border-stone-200"
                                  }`}>
                                    {teamLabel(item)}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className={tdClass}>
                              {item.type === "QA Announcement" && item.rating !== undefined && item.rating > 0 ? (
                                <span className={`inline-block text-[9.5px] font-mono font-bold px-1.5 py-[1px] rounded border ${ratingColorClasses(item.rating, dark)}`}>
                                  {item.rating}
                                </span>
                              ) : (
                                <span className={dark ? "text-stone-600" : "text-stone-400"}>—</span>
                              )}
                            </td>

                            {/* Announcement — truncated preview, click opens
                                the same readability popup the advisor-facing
                                archive uses. */}
                            <td className={tdClass}>
                              <button
                                type="button"
                                onClick={() => setOpenItem(item)}
                                className={`group w-full text-left rounded-md -mx-1 px-1 py-0.5 transition-colors cursor-pointer ${
                                  dark ? "hover:bg-white/[0.04]" : "hover:bg-black/[0.03]"
                                }`}
                                title="Click to read the full announcement"
                              >
                                <div className="line-clamp-2 font-normal font-sans pointer-events-none">
                                  <AnnouncementContent content={item.announcement} theme={theme} />
                                </div>
                                <span className={`inline-flex items-center gap-1 mt-1 text-[9px] font-bold uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity ${
                                  dark ? "text-cyan-300" : "text-[#0754B7]"
                                }`}>
                                  <Maximize2 className="w-2.5 h-2.5" /> Read full
                                </span>
                              </button>
                            </td>

                            <td className={`${tdClass} font-mono whitespace-nowrap`}>
                              {item.announcementDate ? isoDateToDMY(item.announcementDate) : "—"}
                            </td>

                            {/* Effective — date plus the proximity urgency
                                pill underneath, and Valid Till (if set)
                                right below that, so nothing from the old
                                metadata footer is lost. */}
                            <td className={tdClass}>
                              <div className="font-mono whitespace-nowrap">
                                {item.effectiveDate ? isoDateToDMY(item.effectiveDate) : "—"}
                              </div>
                              {urgency && (
                                <span
                                  className="inline-block mt-1 text-[7.5px] uppercase font-black px-1 py-[1px] rounded tracking-wider border whitespace-nowrap"
                                  style={{ color: urgency.text, backgroundColor: urgency.badgeBg, borderColor: urgency.badgeBorder }}
                                >
                                  {urgency.label}
                                </span>
                              )}
                              {item.validTillDate && (
                                <div className="mt-1">
                                  <span className="text-[8px] font-bold bg-red-500/10 text-red-450 dark:text-red-400 px-1 py-[1px] rounded whitespace-nowrap">
                                    Valid Till: {isoDateToDMY(item.validTillDate)}
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className={`${tdClass} truncate`}>{item.addedBy}</td>

                            {/* Actions — Edit / Delete, with the same inline
                                "Sure?" confirm the tiles used. */}
                            <td className={tdClass}>
                              {deletingAnnouncementId === item.id ? (
                                <div className="flex flex-col items-start gap-1 bg-red-500/10 border border-red-500/30 px-1.5 py-1 rounded-lg select-none">
                                  <span className="text-[8px] font-black uppercase text-red-500 tracking-wider">Sure?</span>
                                  <div className="flex items-center gap-1">
                                    <ClippedButton
                                      type="button"
                                      cornerBg={dark ? "#12151A" : "#EBF1F7"}
                                      onClick={() => handleDelete(item)}
                                      className="px-1.5 py-0.5 text-[9px] bg-red-650 hover:bg-red-700 bg-red-600 text-white font-black"
                                    >
                                      Delete
                                    </ClippedButton>
                                    <ClippedButton
                                      type="button"
                                      onClick={() => setDeletingAnnouncementId(null)}
                                      cornerBg={dark ? "#12151A" : "#EBF1F7"}
                                      className="px-1.5 py-0.5 text-[9px] bg-stone-500 hover:bg-stone-600 text-white font-black"
                                    >
                                      Cancel
                                    </ClippedButton>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-0.5">
                                  <ClippedButton
                                    type="button"
                                    onClick={() => setEditingAnnouncementId(item.id)}
                                    cornerBg={dark ? "#12151A" : "#EBF1F7"}
                                    className={`p-1 hover:text-blue-500 hover:bg-blue-500/10 ${
                                      dark ? "text-stone-400" : "text-stone-500"
                                    }`}
                                    title="Edit notice"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                  <ClippedButton
                                    type="button"
                                    onClick={() => setDeletingAnnouncementId(item.id)}
                                    cornerBg={dark ? "#12151A" : "#EBF1F7"}
                                    className={`p-1 hover:text-red-500 hover:bg-red-500/10 ${
                                      dark ? "text-stone-400" : "text-stone-500"
                                    }`}
                                    title="Delete notice"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {totalPages > 1 && (
                <Pagination
                  theme={theme}
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  className="shrink-0 pt-2 border-t border-light-stone/5 dark:border-stone-800"
                />
              )}
            </div>
          </div>
        </div>

      </div>

      {openItem && (
        <AnnouncementReadModal item={openItem} theme={theme} onClose={() => setOpenItem(null)} />
      )}
    </div>
  );
}
