/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Search, X, CalendarRange, Maximize2, Download } from "lucide-react";
import { QAAnnouncement } from "../types/announcements";
import { AnnouncementContent } from "../components/AnnouncementContent";
import { isoDateToDMY } from "../utils/dateFormat";
import { ratingColorClasses, teamLabel } from "../utils/announcementDisplay";
import { AnnouncementReadModal } from "../components/AnnouncementReadModal";
import { DateInputDMY } from "../components/DateInputDMY";
import { Pagination } from "../components/Pagination";
import { ClippedButton } from "../components/ClippedButton";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { downloadCSV } from "../utils/csvExport";

const PAGE_SIZE = 15;

interface AnnouncementArchivePageProps {
  theme: "light" | "dark";
  /** "YYYY-MM-DD" — when set (e.g. via the Workspace's "Open Today's
   * Announcements" CTA), the archive opens pre-filtered to announcements
   * whose *effective* date matches, instead of the normal announcement-date
   * browsing view. Shown as its own clearable chip, distinct from the
   * Announcement Date range filter below. */
  initialEffectiveDate?: string;
}

// Same raw-row -> client-shape mapping every other announcements fetch in
// the app applies (see AnnouncementLogPage.tsx's mapAnnouncementRow) — keeps
// `id` a string and `fromTeam` renamed to `from`.
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
    team: row.team === "Term" ? "Term" : row.team === "Both" ? "Both" : "Health",
  };
}

/**
 * Advisor-facing "Announcements" archive — a plain, tabular, one-row-per-
 * announcement history (Sl No / Title / Team / Severity / Announcement /
 * Announcement Date / Effective Date), deliberately NOT the Announcement
 * Manager's masonry tile gallery — this is a read-only lookup table, not a
 * management console.
 * Sits directly below Plan Reference in the nav (see App.tsx /
 * featurePermissions.ts: "announcement_archive") — visible to every tier,
 * same as Plan Reference, since it's read-only.
 *
 * The lookup page's carousel only ever surfaces the latest ~10 active
 * notices; this page is the full backlog an advisor can search or date-filter
 * when they need something older. Search is a plain server-side text filter
 * (no in-page find/highlight overlay — that's the browser's own Ctrl+F job).
 */
export function AnnouncementArchivePage({ theme, initialEffectiveDate }: AnnouncementArchivePageProps) {
  const dark = theme === "dark";

  const [entries, setEntries] = useState<QAAnnouncement[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [openItem, setOpenItem] = useState<QAAnnouncement | null>(null);
  // Separate from the Announcement Date range above — filters on
  // *effective* date instead of posted date, and only ever gets set via the
  // Workspace's "Open Today's Announcements" CTA (see initialEffectiveDate).
  const [effectiveDateFilter, setEffectiveDateFilter] = useState(initialEffectiveDate || "");
  const [exporting, setExporting] = useState(false);

  // If the CTA is clicked again with a different date while this page is
  // already mounted, pick up the new value instead of staying stuck on the
  // first one.
  useEffect(() => {
    if (initialEffectiveDate) setEffectiveDateFilter(initialEffectiveDate);
  }, [initialEffectiveDate]);

  const hasFilters = Boolean(searchInput.trim() || dateFrom || dateTo || effectiveDateFilter);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, dateFrom, dateTo, effectiveDateFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      paginated: "1",
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: "announcementDate",
      sortDir: "desc",
    });
    const trimmed = debouncedSearch.trim();
    if (trimmed) params.set("search", trimmed);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (effectiveDateFilter) {
      params.set("effectiveDateFrom", effectiveDateFilter);
      params.set("effectiveDateTo", effectiveDateFilter);
    }

    fetch(`/api/announcements?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data.entries) ? data.entries.map(mapAnnouncementRow) : []);
        setTotal(typeof data.total === "number" ? data.total : 0);
        setTotalPages(typeof data.totalPages === "number" ? data.totalPages : 1);
        if (typeof data.page === "number" && data.page !== page) setPage(data.page);
      })
      .catch((err) => {
        console.error("Failed to load announcement archive:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, debouncedSearch, dateFrom, dateTo, effectiveDateFilter]);

  // Same filters as the paginated fetch above, minus paging — matches the
  // export=1 pattern already used by search-history/users/change-logs.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ paginated: "1", pageSize: "10000", sortBy: "announcementDate", sortDir: "desc" });
      const trimmed = debouncedSearch.trim();
      if (trimmed) params.set("search", trimmed);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (effectiveDateFilter) {
        params.set("effectiveDateFrom", effectiveDateFilter);
        params.set("effectiveDateTo", effectiveDateFilter);
      }
      const res = await fetch(`/api/announcements?${params.toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to export (HTTP ${res.status}).`);
      const rows = (Array.isArray(body.entries) ? body.entries.map(mapAnnouncementRow) : []) as QAAnnouncement[];
      downloadCSV(
        rows.map((item) => ({
          Title: item.title || item.category || "",
          Team: teamLabel(item),
          Severity: item.type === "QA Announcement" ? item.rating ?? "" : "",
          Announcement: item.announcement.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
          "Announcement Date": item.announcementDate ? isoDateToDMY(item.announcementDate) : "",
          "Effective Date": item.effectiveDate ? isoDateToDMY(item.effectiveDate) : "",
        })),
        "announcements-archive.csv"
      );
    } catch (err) {
      console.error("Failed to export the announcement archive:", err);
    } finally {
      setExporting(false);
    }
  };

  const cardClass = `rounded-2xl border ${
    dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)]"
  }`;
  const inputClass = `w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border outline-none transition-colors ${
    dark
      ? "bg-white/[0.03] border-white/[0.08] text-white placeholder:text-stone-600 focus:border-white/20"
      : "bg-white border-[#D2DFEC] text-stone-900 placeholder:text-stone-400 focus:border-[#4673a9]/50"
  }`;
  // min-w-[128px] keeps the native "yyyy-mm-dd" placeholder + calendar icon
  // from clipping — the previous unconstrained width let the input shrink
  // below what its own placeholder needed, so the text overflowed the box.
  const dateInputClass = `min-w-[128px] px-2.5 py-1.5 rounded-lg text-xs border transition-colors flex items-center ${
    dark
      ? "bg-white/[0.03] border-white/[0.08] text-white"
      : "bg-white border-[#D2DFEC] text-stone-900"
  }`;
  // Header/row typography+color intentionally forked per theme below (rather
  // than sharing a base string) so dark keeps its exact pre-existing look
  // untouched while light adopts QA Dashboard's own table header pattern
  // (see QaDashboardPage.tsx's SheetTableView: plain font-bold text-xs, no
  // uppercase/tracking, bg-stone-100/border-stone-200).
  const thClass = `text-left px-3 py-2 whitespace-nowrap sticky top-0 z-10 ${
    dark
      ? "text-[9.5px] font-black uppercase tracking-wider bg-[#0c1420] text-stone-400 border-b border-white/[0.08]"
      : "text-xs font-bold bg-stone-100 text-stone-700 border-b border-stone-200"
  }`;
  const tdClass = `align-top break-words ${
    dark ? "px-3 py-2.5 text-[11.5px] text-stone-200" : "px-3 py-2 text-xs text-stone-700"
  }`;

  return (
    <div className="space-y-5 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Plan Reference /
          Coverage Projection Studio, the reference implementations). */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800 lg:shrink-0">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Announcements</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Full archive of every QA and General announcement ever posted. Available to all advisors — search or filter by date to find one that's scrolled off the lookup page.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className={`p-4 lg:shrink-0 ${cardClass}`}>
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          {/* Announcement Date range filter — leads the row: date filtering
              is the primary archive filter, search is a secondary
              refinement, matching QA Dashboard's left-to-right filter
              hierarchy (date fields before search). */}
          <div className="shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="w-3 h-3" /> Announcement Date
              </span>
            </label>
            <div className="flex items-center gap-2">
              <DateInputDMY
                value={dateFrom}
                onChange={setDateFrom}
                max={dateTo || undefined}
                displayClassName={dateInputClass}
                title="From"
              />
              <span className={`text-[10px] font-bold ${dark ? "text-stone-500" : "text-stone-400"}`}>to</span>
              <DateInputDMY
                value={dateTo}
                onChange={setDateTo}
                min={dateFrom || undefined}
                displayClassName={dateInputClass}
                title="To"
              />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Search
            </label>
            <div className="relative">
              <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${dark ? "text-stone-500" : "text-stone-400"}`} />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search announcements..."
                className={inputClass}
              />
            </div>
          </div>

          {hasFilters && (
            <ClippedButton
              type="button"
              onClick={() => {
                setSearchInput("");
                setDateFrom("");
                setDateTo("");
                setEffectiveDateFilter("");
              }}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              className={`px-3 py-1.5 text-[10.5px] font-bold flex items-center gap-1.5 shrink-0 ${dark ? "text-stone-300" : "text-stone-600"}`}
              title="Clear all filters"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </ClippedButton>
          )}
        </div>

        {/* Effective-date filter chip — only ever appears via the
            Workspace's "Open Today's Announcements" CTA; kept visually
            separate from the Announcement Date range above since it filters
            a different field. */}
        {effectiveDateFilter && (
          <div className="flex items-center gap-2 mt-3">
            <span
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[10.5px] font-bold border ${
                dark ? "bg-cyan-400/10 border-cyan-400/30 text-cyan-300" : "bg-[#0754b7]/10 border-[#0754b7]/30 text-[#0754b7]"
              }`}
            >
              Effective date: {isoDateToDMY(effectiveDateFilter)}
              <button
                type="button"
                onClick={() => setEffectiveDateFilter("")}
                className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/10 cursor-pointer"
                title="Clear effective-date filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className={`p-5 flex flex-col flex-1 min-h-0 overflow-hidden ${cardClass}`}>
        <div className="space-y-3 h-full flex flex-col min-h-0">
          <div className="flex justify-between items-center pb-2 border-b border-light-stone/5 dark:border-stone-800 shrink-0">
            <h3 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
              {hasFilters ? `Matching Announcements (${total})` : `All Announcements (${total})`}
            </h3>
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

          <div className={`flex-grow min-h-0 overflow-auto rounded-xl border ${dark ? "border-white/[0.06]" : "border-[var(--border)]"}`}>
            {entries.length === 0 ? (
              <div className="text-center py-20 text-xs italic text-stone-500 select-none">
                {loading ? "Loading…" : hasFilters ? "No announcements match your filters." : "No announcements have been posted yet."}
              </div>
            ) : (
              <table className="w-full border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: "48px" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "8%" }} />
                  <col />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "100px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className={thClass}>Sl No</th>
                    <th className={thClass}>Title</th>
                    <th className={thClass}>Team</th>
                    <th className={thClass}>Severity</th>
                    <th className={thClass}>Announcement</th>
                    <th className={thClass}>Announcement Date</th>
                    <th className={thClass}>Effective Date</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((item, idx) => (
                    <tr
                      key={item.id}
                      // 2026-09: dark theme had no row-hover at all here,
                      // while light theme did (hover:bg-stone-50, mapped to
                      // the opaque --table-row-hover token) -- added the
                      // equivalent dark-theme hover so both themes give the
                      // same feedback.
                      className={`border-b transition-colors ${dark ? "border-white/[0.06] odd:bg-white/[0.015] hover:bg-[var(--table-row-hover)]" : "border-stone-100 odd:bg-black/[0.015] hover:bg-stone-50"}`}
                    >
                      <td className={`${tdClass} font-mono font-bold text-center`}>
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td className={`${tdClass} font-bold`}>
                        {item.title || item.category || "—"}
                      </td>
                      <td className={tdClass}>
                        {teamLabel(item)}
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
                      <td className={tdClass}>
                        {/* Truncated preview — click (or Enter/Space) opens
                            the full announcement in a readability popup
                            instead of scrolling a cramped in-cell scrollbox. */}
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
                          <span className={`inline-flex items-center gap-1 mt-1 text-[9.5px] font-bold uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity ${
                            dark ? "text-cyan-300" : "text-[#0754B7]"
                          }`}>
                            <Maximize2 className="w-2.5 h-2.5" /> Read full
                          </span>
                        </button>
                      </td>
                      <td className={`${tdClass} font-mono whitespace-nowrap`}>
                        {item.announcementDate ? isoDateToDMY(item.announcementDate) : "—"}
                      </td>
                      <td className={`${tdClass} font-mono whitespace-nowrap`}>
                        {item.effectiveDate ? isoDateToDMY(item.effectiveDate) : "—"}
                      </td>
                    </tr>
                  ))}
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

      {openItem && (
        <AnnouncementReadModal item={openItem} theme={theme} onClose={() => setOpenItem(null)} />
      )}
    </div>
  );
}
