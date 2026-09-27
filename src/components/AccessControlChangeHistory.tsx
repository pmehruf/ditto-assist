/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Search, Download, Clock } from "lucide-react";
import { ChangeLogEntry } from "../types/changeLog";
import { CustomSelect } from "./CustomSelect";
import { SortableTh } from "./SortableTh";
import { Pagination } from "./Pagination";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useServerSort } from "../hooks/useServerSort";
import { downloadCSV } from "../utils/csvExport";

const PAGE_SIZE = 25;

interface PaginatedChangeLogResponse {
  entries: ChangeLogEntry[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * "Change History" sub-tab of the Access Control Center — Access Control
 * Center Phase 5 (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). A read-only,
 * pre-filtered view of the same change_logs table the app-wide Activity
 * Log's "Modification History" sub-tab reads (AuditPage.tsx), scoped
 * server-side to Access Control Center actionTypes via
 * `GET /api/change-logs?scope=access-control` (see
 * ACCESS_CONTROL_CHANGE_LOG_CATEGORIES in server.ts). No new table, no new
 * write path — every Access Control Center route already durably logs its
 * own changes; this just gives admins a way to see that history without
 * leaving the page, and without wading through unrelated PED
 * Repository/Announcement/Plan activity on the global Activity Log page.
 *
 * Includes Directory (user add/edit/remove/bulk-edit) activity — server.ts's
 * describeUserAccessChanges() logs a durable entry whenever a User Directory
 * mutation actually changes an access-control-relevant field (tier, status,
 * tags, department, team, or role). A single-row edit that only touches
 * name/TACT ID produces no entry, since those aren't access-relevant.
 */
export function AccessControlChangeHistory({ theme }: { theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const thBg = dark ? "bg-[#132c46] text-stone-300 border-stone-800" : "bg-[var(--table-header-bg)] text-[#111827] border-stone-200";

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const { sort, toggleSort } = useServerSort({ key: "timestamp", direction: "desc" });

  const [entries, setEntries] = useState<ChangeLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const buildParams = (forExport: boolean) => {
    const params = new URLSearchParams({ paginated: "1", scope: "access-control" });
    if (!forExport) params.set("page", String(page));
    params.set("pageSize", forExport ? "10000" : String(PAGE_SIZE));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (category) params.set("category", category);
    if (sort) {
      params.set("sortBy", sort.key);
      params.set("sortDir", sort.direction);
    }
    return params;
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, category, sort?.key, sort?.direction]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/change-logs?${buildParams(false).toString()}`)
      .then(async (res) => {
        const body: PaginatedChangeLogResponse = await res.json();
        if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
        if (cancelled) return;
        setEntries(body.entries || []);
        setTotal(body.total ?? 0);
        setTotalPages(body.totalPages ?? 1);
        if (typeof body.page === "number" && body.page !== page) setPage(body.page);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load change history.");
        console.error("Failed to load Access Control Center change history:", err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, category, sort?.key, sort?.direction]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/change-logs?${buildParams(true).toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const rows: ChangeLogEntry[] = Array.isArray(body.entries) ? body.entries : [];
      downloadCSV(
        rows.map((log) => ({
          Timestamp: log.timestamp,
          User: log.userName,
          Role: log.role,
          "Action Event": log.actionType,
          Description: log.description,
        })),
        `access_control_change_history_${new Date().toISOString().split("T")[0]}.csv`
      );
    } catch (err: any) {
      console.error("Failed to export Access Control Center change history:", err);
      setError(err.message || "Failed to export change history.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
        dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
      }`}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2 select-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search change history..."
              className={`w-full sm:w-64 pl-10 pr-4 py-2 text-xs rounded-xl outline-none focus:border-[#117FDA] font-semibold border ${
                dark ? "bg-[#060a12] border-stone-800 text-stone-200" : "bg-white border-stone-200 text-stone-800"
              }`}
            />
          </div>
          <div className="w-auto min-w-[180px]">
            <CustomSelect
              theme={dark ? "dark" : "light"}
              value={category}
              onChange={setCategory}
              triggerClassName={`w-full flex items-center justify-between gap-2 pl-3.5 pr-8 py-2 rounded-xl text-xs font-bold border cursor-pointer relative ${
                dark ? "bg-stone-950 border-stone-850 text-stone-300" : "bg-white border-stone-200 text-stone-800"
              }`}
              options={[
                { value: "", label: "All Changes" },
                { value: "directory", label: "Directory" },
                { value: "permissions", label: "Permissions" },
                { value: "teams", label: "Business Unit" },
                { value: "departments", label: "Departments" },
                { value: "roles", label: "Roles" },
                { value: "access_rules", label: "Access Rules" },
                { value: "relationships", label: "Groups" },
                { value: "custom_grants", label: "Custom Grants" },
                { value: "qa_access", label: "QA Dashboard Access" },
              ]}
            />
          </div>
        </div>

        <button
          onClick={exportCsv}
          disabled={exporting || total === 0}
          className="w-full md:w-auto px-4 py-2 border border-blue-500/40 text-blue-400 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md select-none disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" /> {exporting ? "Exporting..." : "Export"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-semibold px-4 py-2.5">
          {error}
        </div>
      )}

      <div className={`rounded-2xl border overflow-hidden ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <SortableTh label="Timestamp" sortKey="timestamp" activeSort={sort} onSort={toggleSort} className={`py-3.5 px-5 w-44 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${thBg}`} />
                <SortableTh label="User" sortKey="userName" activeSort={sort} onSort={toggleSort} className={`py-3.5 px-5 w-44 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${thBg}`} />
                <SortableTh label="Role" sortKey="role" activeSort={sort} onSort={toggleSort} className={`py-3.5 px-5 w-28 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${thBg}`} />
                <SortableTh label="Action Event" sortKey="actionType" activeSort={sort} onSort={toggleSort} className={`py-3.5 px-5 w-52 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${thBg}`} />
                <SortableTh label="Description" sortKey="description" activeSort={sort} onSort={toggleSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${thBg}`} />
              </tr>
            </thead>
            <tbody className={`divide-y font-semibold ${dark ? "divide-stone-800 text-stone-300" : "divide-stone-200 text-stone-900"}`}>
              {loading ? (
                <tr><td colSpan={5} className="p-16 text-center text-stone-500 font-bold font-sans">Loading change history...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} className="p-16 text-center text-stone-500 font-bold font-sans">
                  {search || category ? "No matching changes found." : "No changes recorded yet."}
                </td></tr>
              ) : (
                entries.map((log) => {
                  const isCreated = log.actionType.includes("Created") || log.actionType.includes("Granted") || log.actionType.includes("Changed") || log.actionType.includes("Added");
                  const isEdited = log.actionType.includes("Edited");
                  const isDeleted = log.actionType.includes("Deleted") || log.actionType.includes("Revoked") || log.actionType.includes("Removed");
                  return (
                    <tr key={log.id} className="hover:bg-stone-500/5 transition-colors">
                      <td className="py-3 px-5 text-[11px] whitespace-nowrap font-sans font-medium">
                        <span className={`flex items-center gap-1.5 ${dark ? "text-stone-400" : "text-stone-550"}`}>
                          <Clock className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                          {new Date(log.timestamp).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>
                      </td>
                      <td className="py-3 px-5 font-extrabold">{log.userName}</td>
                      <td className="py-3 px-5">
                        <span className={`px-2 py-0.5 rounded text-[8.5px] uppercase font-black ${
                          log.role === "Developer" || log.role === "Owner"
                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                            : log.role === "Platform Admin"
                            ? "bg-violet-500/10 text-violet-400 border border-violet-500/20"
                            : log.role === "Admin"
                            ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                            : "bg-sky-500/10 text-sky-455 border border-sky-500/10"
                        }`}>
                          {log.role || "Admin"}
                        </span>
                      </td>
                      <td className="py-3 px-5">
                        <span className={`px-2 py-0.5 rounded text-[8.5px] uppercase font-black ${
                          isDeleted
                            ? "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                            : isEdited
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : isCreated
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-stone-500/10 text-stone-400 border border-stone-500/20"
                        }`}>
                          {log.actionType}
                        </span>
                      </td>
                      <td className="py-3 px-5 leading-relaxed font-sans font-medium opacity-95 whitespace-normal">{log.description}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10.5px] font-semibold text-content-muted">
            Showing {(page - 1) * PAGE_SIZE + 1}
            {"–"}
            {Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} entries.
          </p>
          <Pagination theme={theme} page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
