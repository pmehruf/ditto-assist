/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Link2,
  Link as LinkIcon,
  PlayCircle,
  RefreshCw,
  Unlink,
  Upload,
  Users,
} from "lucide-react";
import { ConnectionRowCard } from "../components/connections/ConnectionRowCard";
import { ConnectionsRow, ConnectionsSection, ConnectionsSummaryCard, type ConnectionHealth } from "../components/connections/ConnectionsTableUI";
import { iconColorFor } from "../components/connections/connectionIconColors";
import { KnowledgeBasePlaybook } from "../components/KnowledgeBasePlaybook";
import { KnowledgeBaseTermPlaybook } from "../components/KnowledgeBaseTermPlaybook";
import { KnowledgeBaseFaqConnection } from "../components/KnowledgeBaseFaqConnection";
import { KnowledgeBaseTermFaqConnection } from "../components/KnowledgeBaseTermFaqConnection";

interface ConnectionsPageProps {
  theme: "light" | "dark";
  /** Same resolveAccess()-backed evaluator every other governed feature's
   * page uses — see App.tsx's hasAccess(). Every row on this page (Data
   * Sources connect/disconnect/resync, Advisor Directory Sync, Product
   * Assist Log Export) is gated on the "connections" governed feature —
   * no longer a hardcoded Developer-only exception as of 2026-09, so a
   * Developer can reassign it from the Permissions tab like any other
   * feature (see featurePermissions.ts). */
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

type ConnEntry = { connected: boolean; attention: boolean };
type ConnKey = "qa" | "playbook" | "termPlaybook" | "faq" | "termFaq" | "productAssistLog";

/** Runs `work`, then waits (if needed) until at least `minMs` has elapsed
 * since it started — used so a fast "Refresh All" doesn't just flash past
 * before the user can register that anything happened (task feedback #10).
 * Declared at module scope (not inside the component) so its Date.now()/
 * setTimeout usage isn't analyzed as part of the component's render purity
 * — same reasoning as relativeTime() below. */
async function withMinDuration<T>(work: () => Promise<T>, minMs: number): Promise<T> {
  const start = Date.now();
  const result = await work();
  const elapsed = Date.now() - start;
  if (elapsed < minMs) await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
  return result;
}

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Connections — Developer Zone. The single home for this app's Google
 * Sheets integrations, redesigned 2026-09 into a "Data Sources" table (the
 * read-only Sheets this app reads from — QA Dashboard, Product Playbook,
 * Health FAQ, Term FAQ, all rendered via the shared ConnectionRowCard) and a
 * "Syncs & Exports" table (Advisor Directory Sync, which reuses the QA
 * connection with no OAuth grant of its own, and the temporary Product
 * Assist Log Export, which writes rather than reads), plus a summary stat
 * bar and one "Refresh All" that re-checks every Data Sources row at once.
 * None of the six connections' underlying functionality changed in this
 * redesign, only the shell around them — see ConnectionRowCard.tsx and
 * ConnectionsTableUI.tsx for the shared mechanics/presentation this page and
 * the three Knowledge Base connection components now share.
 *
 * 2026-09 follow-up (user feedback on the first redesign pass): every row
 * now click-to-expands into a plain-language "Used by" / "Refresh schedule"
 * FYI plus its full sync detail, health reflects the actual last Sheets
 * call rather than just whether a grant is on file (see getQaSheetsHealth /
 * getProductAssistLogExportHealth), Advisor Directory Sync's last run is
 * fetched from change_logs on load instead of only ever knowing about a run
 * from this browser session, and "Refresh All" now visibly shows its own
 * progress instead of appearing to do nothing.
 */
export function ConnectionsPage({ theme, hasAccess }: ConnectionsPageProps) {
  const dark = theme === "dark";
  const canManage = hasAccess("connections", "Editor");

  // Aggregated connected/attention state for the four Data Sources rows
  // that report in via ConnectionRowCard's onStatusChange — drives the
  // summary stat bar. Product Assist Log Export (hand-rolled below, not a
  // ConnectionRowCard) folds its own state in via the same shape.
  const [statusMap, setStatusMap] = useState<Partial<Record<ConnKey, ConnEntry>>>({});
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);

  const reportStatus = useCallback((key: ConnKey, info: ConnEntry) => {
    setStatusMap((prev) => ({ ...prev, [key]: info }));
    setLastCheckedAt(new Date());
  }, []);
  const onQaStatus = useCallback((info: ConnEntry) => reportStatus("qa", info), [reportStatus]);
  const onPlaybookStatus = useCallback((info: ConnEntry) => reportStatus("playbook", info), [reportStatus]);
  const onTermPlaybookStatus = useCallback((info: ConnEntry) => reportStatus("termPlaybook", info), [reportStatus]);
  const onFaqStatus = useCallback((info: ConnEntry) => reportStatus("faq", info), [reportStatus]);
  const onTermFaqStatus = useCallback((info: ConnEntry) => reportStatus("termFaq", info), [reportStatus]);

  // Advisor Directory Sync has no OAuth grant/connection of its own (see
  // this page's doc comment) — its health mirrors the QA Dashboard
  // connection's, since that's what it actually depends on.
  const advisorSyncEntry: ConnEntry = statusMap.qa ?? { connected: false, attention: false };

  // Cheap enough (5-6 element map+filter) to skip useMemo entirely —
  // avoids the object-identity churn a memoized advisorSyncEntry fallback
  // would otherwise need to guard against.
  const summaryEntries: (ConnEntry | undefined)[] = [
    statusMap.qa,
    statusMap.playbook,
    statusMap.termPlaybook,
    statusMap.faq,
    statusMap.termFaq,
    statusMap.productAssistLog,
    advisorSyncEntry,
  ];

  const totalConnections = 7;
  const connectedCount = summaryEntries.filter((e) => e?.connected).length;
  const attentionCount = summaryEntries.filter((e) => e && e.attention).length;

  // "Refresh All" now visibly reacts (task feedback #10): the button shows
  // a spinning icon + "Refreshing…" for at least a short floor duration
  // (so a near-instant response doesn't just flash), then "Refreshed" with
  // a checkmark for a couple seconds. refreshSignal itself still drives
  // every ConnectionRowCard's refetch as before.
  const refreshAll = async () => {
    setRefreshing(true);
    setJustRefreshed(false);
    setRefreshSignal((n) => n + 1);
    await withMinDuration(() => Promise.all([refreshQalConnection(), loadAdvisorSyncLastRun()]), 700);
    setRefreshing(false);
    setJustRefreshed(true);
    setTimeout(() => setJustRefreshed(false), 2500);
  };

  // ── Product Assist Log Export (see product_assist_logs's schema comment
  // in schema.ts — a permanent record as of 2026-09, this export is now a
  // periodic COPY rather than a move-and-clear). The only connection here
  // that WRITES (appends rows) rather than reads, plus an "Export Now"
  // action (not a resync) and a pending-rows count — different enough from
  // the Data Sources pattern that it's hand-built here rather than through
  // ConnectionRowCard, using the same ConnectionsRow shell. ─────────────
  interface QalResource {
    status?: "processing" | "active" | "error" | "archived";
    lastFetchedAt?: string | null;
    errorMessage?: string | null;
  }
  const [qalConnection, setQalConnection] = useState<{
    connected: boolean;
    connectedEmail?: string;
    connectedAt?: string | null;
    pendingCount: number;
    sheetUrl?: string | null;
    resource?: QalResource | null;
  } | null>(null);
  const [qalConnectionError, setQalConnectionError] = useState<string | null>(null);
  const [qalDisconnecting, setQalDisconnecting] = useState(false);
  const [qalExporting, setQalExporting] = useState(false);
  const [qalExportMessage, setQalExportMessage] = useState<string | null>(null);
  const [qalExpanded, setQalExpanded] = useState(false);

  const refreshQalConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/product-assist-logs/connection-status");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setQalConnection(body);
      setQalConnectionError(null);
      // A stored grant whose last real export attempt actually failed
      // (resource.status === "error", from the backend's passive health
      // tracking) needs attention even though the grant itself is present
      // — this is the exact bug flagged: the pill used to say "Connected"
      // right next to "Export failed: ...".
      setStatusMap((prev) => ({
        ...prev,
        productAssistLog: { connected: !!body.connected, attention: !!body.connected && body.resource?.status === "error" },
      }));
      setLastCheckedAt(new Date());
    } catch (err) {
      setQalConnectionError(err instanceof Error ? err.message : "Could not load the Product Assist Log Export's Sheets connection status.");
      setStatusMap((prev) => ({ ...prev, productAssistLog: { connected: false, attention: true } }));
    }
  }, []);

  useEffect(() => {
    refreshQalConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        body.skipped ? "Nothing to export — no logs are queued right now." : `Exported ${body.exportedCount} log row(s) to the Sheet.`
      );
      await refreshQalConnection();
    } catch (err) {
      setQalConnectionError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setQalExporting(false);
    }
  };

  // True health: a real export failure outranks "connected" or "queued" —
  // same fix as the QA Dashboard row already got for free via
  // ConnectionRowCard's generic health calc, applied here by hand since
  // this row isn't a ConnectionRowCard.
  const qalHealth: ConnectionHealth = qalConnectionError
    ? "attention"
    : !qalConnection?.connected
      ? "not_connected"
      : qalConnection.resource?.status === "error"
        ? "attention"
        : qalConnection.pendingCount > 0
          ? "queued"
          : "connected";
  const qalHealthLabel = qalConnectionError
    ? undefined
    : qalConnection?.connected && qalConnection.resource?.status !== "error" && qalConnection.pendingCount > 0
      ? `${qalConnection.pendingCount} queued`
      : undefined;

  // ── Advisor Directory Sync (2026-08) — master_advisors -> users.department/
  // team/role/tags, via the SAME QA Dashboard Sheets connection above (no
  // separate connect/disconnect of its own). See server.ts's
  // /api/qa-dashboard/advisor-directory-sync and advisorDirectorySync.ts. ──
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
  const [advisorSyncExpanded, setAdvisorSyncExpanded] = useState(false);
  const [advisorSyncLoaded, setAdvisorSyncLoaded] = useState(false);

  // Real last-run info, fetched on load — replaces the old "Not yet synced
  // this session" placeholder (which reset on every refresh even though a
  // sync genuinely ran earlier) with the actual persisted last run, read
  // back from change_logs.snapshot (see server.ts's GET
  // /api/qa-dashboard/advisor-directory-sync/last-run).
  const loadAdvisorSyncLastRun = useCallback(async () => {
    try {
      const res = await fetch("/api/qa-dashboard/advisor-directory-sync/last-run");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      if (body.result) setAdvisorSyncResult(body.result);
    } catch {
      // Non-fatal — the row just falls back to "Not yet synced" if this
      // fails; the Sync Now action itself is unaffected.
    } finally {
      setAdvisorSyncLoaded(true);
    }
  }, [setAdvisorSyncResult, setAdvisorSyncLoaded]);

  useEffect(() => {
    loadAdvisorSyncLastRun();
  }, [loadAdvisorSyncLastRun]);

  const runAdvisorDirectorySync = async () => {
    setAdvisorSyncRunning(true);
    setAdvisorSyncError(null);
    try {
      const res = await fetch("/api/qa-dashboard/advisor-directory-sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Sync failed (HTTP ${res.status}).`);
      setAdvisorSyncResult(body);
      setAdvisorSyncExpanded(true);
      if (body.errors?.length) setAdvisorSyncError(body.errors.join(" "));
    } catch (err) {
      setAdvisorSyncError(err instanceof Error ? err.message : "Advisor Directory Sync failed.");
    } finally {
      setAdvisorSyncRunning(false);
    }
  };

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Connections</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">External systems and data flows this app uses.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${dark ? "text-stone-400" : "text-stone-500"}`}>
            <Clock className="w-3.5 h-3.5" />
            Last checked {relativeTime(lastCheckedAt)}
          </span>
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-[11px] font-bold cursor-pointer disabled:cursor-not-allowed ${
              justRefreshed
                ? dark
                  ? "border-emerald-500/40 text-emerald-300"
                  : "border-emerald-300 text-emerald-700 bg-emerald-50"
                : dark
                  ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06] disabled:opacity-60"
                  : "border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            }`}
          >
            {justRefreshed ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Refreshed
              </>
            ) : (
              <>
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing…" : "Refresh All"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Summary stat bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ConnectionsSummaryCard
          dark={dark}
          icon={<LinkIcon className="w-4 h-4" />}
          iconColor={{ bg: dark ? "#38BDF81A" : "#0EA5E91A", fg: dark ? "#38BDF8" : "#0284C7" }}
          value={totalConnections}
          label="Total Connections"
        />
        <ConnectionsSummaryCard
          dark={dark}
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconColor={{ bg: dark ? "#34D3991A" : "#0596691A", fg: dark ? "#34D399" : "#059669" }}
          value={connectedCount}
          label="Connected"
        />
        <ConnectionsSummaryCard
          dark={dark}
          icon={<AlertTriangle className="w-4 h-4" />}
          iconColor={{ bg: dark ? "#FBBF241A" : "#D977061A", fg: dark ? "#FBBF24" : "#B45309" }}
          value={attentionCount}
          label="Needs Attention"
        />
        <ConnectionsSummaryCard
          dark={dark}
          icon={<Clock className="w-4 h-4" />}
          iconColor={{ bg: dark ? "#A78BFA1A" : "#7C3AED1A", fg: dark ? "#A78BFA" : "#7C3AED" }}
          value={relativeTime(lastCheckedAt)}
          label="Last Checked"
        />
      </div>

      {/* DATA SOURCES — every read-only Google Sheet this app reads from. */}
      <ConnectionsSection
        dark={dark}
        icon={<Database className="w-4 h-4" />}
        title="Data Sources"
        description="Google Sheets connections used by platform features. Click a row for details."
      >
        <ConnectionRowCard
          dark={dark}
          icon={<LinkIcon className="w-4 h-4" />}
          iconColor={iconColorFor("sky", dark)}
          title="QA Dashboard"
          purpose="Lets the QA Dashboard page read the QA team's Google Sheet read-only, as whoever connects — no Workspace admin action or service account required."
          usedBy="The QA Dashboard page, for every advisor's live QA scores."
          syncCadence="Refreshes automatically every 5 minutes while the QA Dashboard page is open."
          statusEndpoint="/api/qa-dashboard/connection-status"
          connectHref="/api/qa-dashboard/connect-google"
          disconnectEndpoint="/api/qa-dashboard/connection"
          loadErrorFallback="Could not load the QA Dashboard's Sheets connection status."
          gateByTier={{ canManage }}
          refreshSignal={refreshSignal}
          onStatusChange={onQaStatus}
        />
        <KnowledgeBasePlaybook theme={theme} hasAccess={hasAccess} refreshSignal={refreshSignal} onStatusChange={onPlaybookStatus} />
        <KnowledgeBaseTermPlaybook theme={theme} hasAccess={hasAccess} refreshSignal={refreshSignal} onStatusChange={onTermPlaybookStatus} />
        <KnowledgeBaseFaqConnection theme={theme} hasAccess={hasAccess} refreshSignal={refreshSignal} onStatusChange={onFaqStatus} />
        <KnowledgeBaseTermFaqConnection theme={theme} hasAccess={hasAccess} refreshSignal={refreshSignal} onStatusChange={onTermFaqStatus} />
      </ConnectionsSection>

      {/* SYNCS & EXPORTS — operations that move data into the app or out of
          it, rather than a page reading a Sheet live. */}
      <ConnectionsSection
        dark={dark}
        icon={<RefreshCw className="w-4 h-4" />}
        title="Syncs & Exports"
        description="Operations that sync data into the app or export data out. Click a row for details."
      >
        <ConnectionsRow
          dark={dark}
          health={advisorSyncError ? "attention" : advisorSyncEntry.connected ? "ready" : "not_connected"}
          healthLabel={advisorSyncError ? "Attention" : advisorSyncEntry.connected ? "Ready" : "Needs QA connection"}
          icon={<Users className="w-4 h-4" />}
          iconColor={iconColorFor("rose", dark)}
          name="Advisor Directory Sync"
          subtitle="Google Sheets → App"
          purpose={
            'Matches every "Currently Employed" roster row to a directory user by email (falling back to TACT ID), then sets Business Unit, Department, Role, and Health/Term tags. Never creates or deletes users.' +
            (canManage ? "" : " Read-only — Admin clearance is required to run this sync.")
          }
          details={
            advisorSyncError ? (
              <span className={`flex items-start gap-1 ${dark ? "text-red-300" : "text-red-600"}`}>
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                {advisorSyncError}
              </span>
            ) : advisorSyncResult ? (
              <>
                Last synced {new Date(advisorSyncResult.syncedAt).toLocaleString()} · {advisorSyncResult.usersMatched} advisors matched
              </>
            ) : advisorSyncLoaded ? (
              "Not yet synced"
            ) : (
              "Loading…"
            )
          }
          actions={
            canManage ? (
              <button
                type="button"
                onClick={runAdvisorDirectorySync}
                disabled={advisorSyncRunning}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                  dark ? "border-sky-500/40 text-sky-300 hover:bg-sky-500/10" : "border-sky-300 text-sky-700 hover:bg-sky-50"
                }`}
              >
                <PlayCircle className={`w-3.5 h-3.5 ${advisorSyncRunning ? "animate-spin" : ""}`} />
                {advisorSyncRunning ? "Syncing…" : "Sync Now"}
              </button>
            ) : null
          }
          expanded={advisorSyncExpanded}
          onToggleExpanded={setAdvisorSyncExpanded}
          expandedContent={
            <div className={`text-[11px] font-semibold leading-relaxed space-y-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <p>
                <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Used by: </span>
                Keeping every advisor's Business Unit, Department, Role, and Health/Term tags current across the app.
              </p>
              <p>
                <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Refresh schedule: </span>
                Manual only — click Sync Now to run it. It does not run on any automatic schedule.
              </p>
              {advisorSyncResult && advisorSyncResult.errors.length === 0 && (
                <div className={`rounded-lg border p-3 ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"}`}>
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
                      <div key={label as string} className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
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
          }
        />

        <ConnectionsRow
          dark={dark}
          health={qalHealth}
          healthLabel={qalHealthLabel}
          icon={<Upload className="w-4 h-4" />}
          iconColor={iconColorFor("indigo", dark)}
          name="Product Assist Log Export"
          subtitle="App → Google Sheets · Temporary"
          purpose={
            "Appends logged Product Assist questions/answers to a Sheet you create, then clears them from the database. Turn off entirely by setting PRODUCT_ASSIST_LOG_ENABLED=false once enough data is collected." +
            (canManage ? "" : " Read-only — Admin clearance is required to connect, disconnect, or export.")
          }
          details={
            qalConnectionError ? (
              <span className={`flex items-start gap-1 ${dark ? "text-red-300" : "text-red-600"}`}>
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                {qalConnectionError}
              </span>
            ) : qalConnection?.connected ? (
              qalConnection.resource?.status === "error" ? (
                <span className={`flex items-start gap-1 ${dark ? "text-red-300" : "text-red-600"}`}>
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  Export failed: {qalConnection.resource.errorMessage}
                </span>
              ) : (
                <>
                  {qalConnection.connectedEmail}
                  {qalExportMessage && <div className={dark ? "text-emerald-300" : "text-emerald-600"}>{qalExportMessage}</div>}
                </>
              )
            ) : (
              "Not connected"
            )
          }
          actions={
            <>
              {qalConnection?.sheetUrl && (
                <a
                  href={qalConnection.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                    dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Open Sheet
                </a>
              )}
              {qalConnection?.connected && canManage && (
                <button
                  type="button"
                  onClick={exportAndClearQalLogs}
                  disabled={qalExporting || !qalConnection.pendingCount}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                    dark ? "border-sky-500/40 text-sky-300 hover:bg-sky-500/10" : "border-sky-300 text-sky-700 hover:bg-sky-50"
                  }`}
                >
                  <Download className="w-3 h-3" />
                  {qalExporting ? "Exporting…" : "Export Now"}
                </button>
              )}
              {canManage &&
                (qalConnection?.connected ? (
                  <button
                    type="button"
                    onClick={disconnectQalSheets}
                    disabled={qalDisconnecting}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                      dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"
                    }`}
                  >
                    {qalDisconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : (
                  // Shared --action-navy token (2026-09) instead of the old
                  // bg-blue-600 family.
                  <a
                    href="/api/product-assist-logs/connect-google"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer whitespace-nowrap"
                  >
                    <Link2 className="w-3 h-3" />
                    Connect
                  </a>
                ))}
            </>
          }
          expanded={qalExpanded}
          onToggleExpanded={setQalExpanded}
          expandedContent={
            <div className={`text-[11px] font-semibold leading-relaxed space-y-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <p>
                <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Used by: </span>
                Copying Product Assist Q&A history to a Sheet outside the app — nothing in the live app reads from it. Rows also stay
                available here for review under AI Usage & Limits.
              </p>
              <p>
                <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Refresh schedule: </span>
                Manual (Export Now), or an optional monthly export if a Cloud Scheduler job is configured for it.
              </p>
              {qalConnection?.connected && (
                <p>
                  <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Connected: </span>
                  {qalConnection.connectedEmail}
                  {qalConnection.connectedAt && <> · since {new Date(qalConnection.connectedAt).toLocaleString()}</>} ·{" "}
                  {qalConnection.pendingCount} row{qalConnection.pendingCount === 1 ? "" : "s"} currently queued
                </p>
              )}
            </div>
          }
        />
      </ConnectionsSection>

      <p className={`flex items-center gap-1.5 text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
        <Unlink className="w-3 h-3" />
        Disconnecting a Data Sources row only revokes this app's read access — it never modifies or deletes anything in the
        underlying Google Sheet itself.
      </p>
    </div>
  );
}
