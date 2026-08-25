/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unlink, Download, ExternalLink, Users, PlayCircle } from "lucide-react";
import { KnowledgeBasePlaybook } from "../components/KnowledgeBasePlaybook";
import { KnowledgeBaseFaqConnection } from "../components/KnowledgeBaseFaqConnection";

interface ConnectionsPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
}

/**
 * Connections — Developer Zone. The single home for this app's Google
 * Sheets integrations: the QA Dashboard's read-only workbook connection
 * (moved here verbatim from OwnerControlsPage.tsx, which used to host it
 * alongside page visibility), the Product Playbook's (KnowledgeBasePlaybook,
 * reused as-is — previously its own sub-tab on Knowledge Base Management),
 * and the Ditto FAQ's (KnowledgeBaseFaqConnection, added 2026-08 — same
 * pattern, own OAuth grant/table). None of these connections' underlying
 * functionality changed, only where it's surfaced — all are "backend
 * plumbing, not a permission" settings, which is exactly what this page is
 * for.
 */
export function ConnectionsPage({ theme, effectiveTier }: ConnectionsPageProps) {
  const dark = theme === "dark";

  // QA Dashboard "Connect Google Sheets" status (see server.ts
  // /api/qa-dashboard/* and src/server/qaDashboard/sheetsClient.ts).
  const [qaConnection, setQaConnection] = useState<{ connected: boolean; connectedEmail?: string; sheetUrl?: string | null } | null>(null);
  const [qaConnectionLoading, setQaConnectionLoading] = useState(false);
  const [qaConnectionError, setQaConnectionError] = useState<string | null>(null);
  const [qaDisconnecting, setQaDisconnecting] = useState(false);

  const refreshQaConnection = async () => {
    setQaConnectionLoading(true);
    try {
      const res = await fetch("/api/qa-dashboard/connection-status");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setQaConnection(body);
      setQaConnectionError(null);
    } catch (err) {
      setQaConnectionError(err instanceof Error ? err.message : "Could not load the QA Dashboard's Sheets connection status.");
    } finally {
      setQaConnectionLoading(false);
    }
  };

  useEffect(() => {
    refreshQaConnection();
  }, []);

  const disconnectQaSheets = async () => {
    setQaDisconnecting(true);
    try {
      const res = await fetch("/api/qa-dashboard/connection", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to disconnect (HTTP ${res.status}).`);
      await refreshQaConnection();
    } catch (err) {
      setQaConnectionError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setQaDisconnecting(false);
    }
  };

  // Advisor Directory Sync (2026-08) — master_advisors -> users.department/
  // team/role/tags, via the SAME QA Dashboard Sheets connection above (no
  // separate connect/disconnect of its own). See server.ts's
  // /api/qa-dashboard/advisor-directory-sync and advisorDirectorySync.ts.
  interface AdvisorSyncResult {
    recordsRead: number;
    currentlyEmployedRecords: number;
    usersMatched: number;
    usersUpdated: number;
    usersUnchanged: number;
    usersReverted: number;
    usersSkippedNotFound: number;
    unrecognizedProductRecords: number;
    notFoundSamples: { tactId: string; email: string | null; name: string }[];
    errors: string[];
    syncedAt: string;
  }
  const [advisorSyncRunning, setAdvisorSyncRunning] = useState(false);
  const [advisorSyncResult, setAdvisorSyncResult] = useState<AdvisorSyncResult | null>(null);
  const [advisorSyncError, setAdvisorSyncError] = useState<string | null>(null);

  const runAdvisorDirectorySync = async () => {
    setAdvisorSyncRunning(true);
    setAdvisorSyncError(null);
    try {
      const res = await fetch("/api/qa-dashboard/advisor-directory-sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Sync failed (HTTP ${res.status}).`);
      setAdvisorSyncResult(body);
      if (body.errors?.length) setAdvisorSyncError(body.errors.join(" "));
    } catch (err) {
      setAdvisorSyncError(err instanceof Error ? err.message : "Advisor Directory Sync failed.");
    } finally {
      setAdvisorSyncRunning(false);
    }
  };

  // Product Assist Log Export "Connect Google Sheets" status (TEMPORARY —
  // see product_assist_logs's schema comment in schema.ts). Same shape as the
  // QA Dashboard connection above, plus pendingCount (rows waiting to be
  // exported) and a manual "Export & Clear Now" action.
  const [qalConnection, setQalConnection] = useState<{ connected: boolean; connectedEmail?: string; pendingCount: number; sheetUrl?: string | null } | null>(null);
  const [qalConnectionLoading, setQalConnectionLoading] = useState(false);
  const [qalConnectionError, setQalConnectionError] = useState<string | null>(null);
  const [qalDisconnecting, setQalDisconnecting] = useState(false);
  const [qalExporting, setQalExporting] = useState(false);
  const [qalExportMessage, setQalExportMessage] = useState<string | null>(null);

  const refreshQalConnection = async () => {
    setQalConnectionLoading(true);
    try {
      const res = await fetch("/api/product-assist-logs/connection-status");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setQalConnection(body);
      setQalConnectionError(null);
    } catch (err) {
      setQalConnectionError(err instanceof Error ? err.message : "Could not load the Product Assist Log Export's Sheets connection status.");
    } finally {
      setQalConnectionLoading(false);
    }
  };

  useEffect(() => {
    refreshQalConnection();
  }, []);

  const disconnectQalSheets = async () => {
    setQalDisconnecting(true);
    try {
      const res = await fetch("/api/product-assist-logs/connection", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to disconnect (HTTP ${res.status}).`);
      await refreshQalConnection();
    } catch (err) {
      setQalConnectionError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setQalDisconnecting(false);
    }
  };

  const exportAndClearQalLogs = async () => {
    setQalExporting(true);
    setQalExportMessage(null);
    try {
      const res = await fetch("/api/product-assist-logs/export-and-clear", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Export failed (HTTP ${res.status}).`);
      setQalExportMessage(
        body.skipped ? "Nothing to export — no logs are queued right now." : `Exported and cleared ${body.exportedCount} log row(s).`
      );
      await refreshQalConnection();
    } catch (err) {
      setQalConnectionError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setQalExporting(false);
    }
  };

  const cardClass = `rounded-2xl border ${
    dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"
  }`;

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Connections</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Google Sheets integrations — the QA Dashboard and Product Playbook workbooks this app reads from, and the
            temporary Product Assist Log Export this app writes to.
          </p>
        </div>
      </div>

      {/* QA Dashboard — Google Sheets connection. See QA_DASHBOARD_SHEETS_SETUP.md:
          this is the "no admin needed" path — whoever already has access to
          the QA team's Sheet clicks Connect below and grants this app one
          extra read-only scope on top of the login it already does. No
          service account, no Workspace policy involved. */}
      <div className={`p-5 ${cardClass}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
          <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
            QA Dashboard — Google Sheets
          </h3>
          <button
            type="button"
            onClick={refreshQaConnection}
            title="Refresh"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${qaConnectionLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <p className={`text-[10.5px] mb-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
          Lets the QA Dashboard page read the QA team's Google Sheet read-only, as whoever connects below — no Workspace
          admin action or service account required.
        </p>

        {qaConnectionError && (
          <div
            className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${
              dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{qaConnectionError}</span>
          </div>
        )}

        <div
          className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${
            dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {qaConnection?.connected ? (
              <>
                <CheckCircle2 className={`w-4 h-4 shrink-0 ${dark ? "text-emerald-300" : "text-emerald-600"}`} />
                <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>
                  Connected as {qaConnection.connectedEmail}
                </span>
              </>
            ) : (
              <>
                <Unlink className={`w-4 h-4 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                <span className={`text-xs font-bold ${dark ? "text-stone-300" : "text-stone-600"}`}>Not connected</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {qaConnection?.sheetUrl && (
              <a
                href={qaConnection.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                  dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"
                }`}
              >
                <ExternalLink className="w-3 h-3" />
                Open Sheet
              </a>
            )}
            {qaConnection?.connected ? (
              <button
                type="button"
                onClick={disconnectQaSheets}
                disabled={qaDisconnecting}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"
                }`}
              >
                {qaDisconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <a
                href="/api/qa-dashboard/connect-google"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
              >
                <Link2 className="w-3 h-3" />
                Connect Google Sheets
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Advisor Directory Sync — reuses the QA Dashboard connection above (no
          separate OAuth grant). Syncs Department=Advisory / Team=Bliss /
          Role=Advisor + Health/Term tags onto every directory user matched
          against a "Currently Employed" master_advisors row. */}
      <div className={`p-5 ${cardClass}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
          <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${dark ? "text-white" : "text-stone-900"}`}>
            <Users className="w-4 h-4" />
            Advisor Directory Sync
          </h3>
          <button
            type="button"
            onClick={runAdvisorDirectorySync}
            disabled={advisorSyncRunning}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              dark ? "border-sky-500/40 text-sky-300 hover:bg-sky-500/10" : "border-sky-300 text-sky-700 hover:bg-sky-50"
            }`}
          >
            <PlayCircle className={`w-3.5 h-3.5 ${advisorSyncRunning ? "animate-spin" : ""}`} />
            {advisorSyncRunning ? "Syncing…" : "Sync Advisor Directory"}
          </button>
        </div>

        <p className={`text-[10.5px] mb-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
          Matches every "Currently Employed" master_advisors row to a directory user by email (falling back to TACT ID), then
          sets Department = Advisory, Team = Bliss, Role = Advisor, and Health/Term tags from the sheet's Product column.
          Never creates or deletes users. Safe to re-run — unchanged users are skipped, and a user who leaves "Currently
          Employed" has only this sync's own prior assignment reverted, never a value you've since changed by hand.
        </p>

        {advisorSyncError && (
          <div
            className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${
              dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{advisorSyncError}</span>
          </div>
        )}

        {advisorSyncResult && advisorSyncResult.errors.length === 0 && (
          <div className={`rounded-lg border p-3 ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"}`}>
            <div className="flex items-center gap-1.5 mb-2.5">
              <CheckCircle2 className={`w-4 h-4 shrink-0 ${dark ? "text-emerald-300" : "text-emerald-600"}`} />
              <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>
                Synced {new Date(advisorSyncResult.syncedAt).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {[
                ["Records read", advisorSyncResult.recordsRead],
                ["Currently employed", advisorSyncResult.currentlyEmployedRecords],
                ["Users matched", advisorSyncResult.usersMatched],
                ["Users updated", advisorSyncResult.usersUpdated + advisorSyncResult.usersReverted],
                ["Unchanged", advisorSyncResult.usersUnchanged],
                ["Reverted (left employment)", advisorSyncResult.usersReverted],
                ["Skipped / not found", advisorSyncResult.usersSkippedNotFound],
                ["Unrecognized Product value", advisorSyncResult.unrecognizedProductRecords],
              ].map(([label, value]) => (
                <div key={label as string} className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
                  <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>{label}</p>
                  <p className={`text-sm font-black mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{value as number}</p>
                </div>
              ))}
            </div>
            {advisorSyncResult.notFoundSamples.length > 0 && (
              <div className="mt-2">
                <p className={`text-[10px] font-black uppercase tracking-wider mb-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  Not found in the directory (first {advisorSyncResult.notFoundSamples.length})
                </p>
                <div className={`text-[10.5px] font-mono space-y-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                  {advisorSyncResult.notFoundSamples.map((s, i) => (
                    <div key={i}>
                      {s.tactId || "—"} · {s.email || "no email"} · {s.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Product Assist Log Export — Google Sheets connection. TEMPORARY (see
          product_assist_logs's schema comment in schema.ts): Product Assist
          normally keeps no server-side record of advisor conversations at
          all — this is a knowingly time-boxed exception, added to build a
          real representative test set for the optimization review. This is
          the only one of the three Google Sheets connections on this page
          that WRITES (appends rows) rather than reads. */}
      <div className={`p-5 ${cardClass}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
          <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
            Product Assist Log Export — Google Sheets
          </h3>
          <button
            type="button"
            onClick={refreshQalConnection}
            title="Refresh"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${qalConnectionLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <p className={`text-[10.5px] mb-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
          Temporary: appends logged Product Assist questions/answers to a Google Sheet you create, then clears them from the
          database — as whoever connects below, with write access to that one Sheet. Turn off entirely by setting
          PRODUCT_ASSIST_LOG_ENABLED=false once you've collected enough data.
        </p>

        {qalConnectionError && (
          <div
            className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${
              dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{qalConnectionError}</span>
          </div>
        )}

        {qalExportMessage && (
          <div
            className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${
              dark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700"
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{qalExportMessage}</span>
          </div>
        )}

        <div
          className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${
            dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {qalConnection?.connected ? (
              <>
                <CheckCircle2 className={`w-4 h-4 shrink-0 ${dark ? "text-emerald-300" : "text-emerald-600"}`} />
                <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>
                  Connected as {qalConnection.connectedEmail}
                </span>
              </>
            ) : (
              <>
                <Unlink className={`w-4 h-4 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                <span className={`text-xs font-bold ${dark ? "text-stone-300" : "text-stone-600"}`}>Not connected</span>
              </>
            )}
            {qalConnection && (
              <span className={`text-[10.5px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                · {qalConnection.pendingCount} log row{qalConnection.pendingCount === 1 ? "" : "s"} queued
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {qalConnection?.sheetUrl && (
              <a
                href={qalConnection.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                  dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"
                }`}
              >
                <ExternalLink className="w-3 h-3" />
                Open Sheet
              </a>
            )}
            {qalConnection?.connected && (
              <button
                type="button"
                onClick={exportAndClearQalLogs}
                disabled={qalExporting || !qalConnection.pendingCount}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  dark ? "border-sky-500/40 text-sky-300 hover:bg-sky-500/10" : "border-sky-300 text-sky-700 hover:bg-sky-50"
                }`}
              >
                <Download className="w-3 h-3" />
                {qalExporting ? "Exporting…" : "Export & Clear Now"}
              </button>
            )}
            {qalConnection?.connected ? (
              <button
                type="button"
                onClick={disconnectQalSheets}
                disabled={qalDisconnecting}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"
                }`}
              >
                {qalDisconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <a
                href="/api/product-assist-logs/connect-google"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
              >
                <Link2 className="w-3 h-3" />
                Connect Google Sheets
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Product Playbook — Google Sheets connection (KnowledgeBasePlaybook,
          reused verbatim; previously its own sub-tab on Knowledge Base
          Management). */}
      <KnowledgeBasePlaybook theme={theme} effectiveTier={effectiveTier} />

      {/* Ditto FAQ — Google Sheets connection (2026-08 integration). Own
          OAuth grant/table/resource, same card pattern as the Product
          Playbook above — see KnowledgeBaseFaqConnection.tsx. */}
      <KnowledgeBaseFaqConnection theme={theme} effectiveTier={effectiveTier} />
    </div>
  );
}
