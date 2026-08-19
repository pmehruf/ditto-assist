/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unlink } from "lucide-react";

interface KnowledgeBasePlaybookProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
}

interface PlaybookConnectionStatus {
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: string | null;
  resource: {
    status: "processing" | "active" | "error" | "archived";
    lastFetchedAt: string | null;
    errorMessage: string | null;
    planFactCount: number;
    narrativeChunkCount: number;
  } | null;
}

/**
 * "Product Playbook" panel — Knowledge Base Management's third sub-tab.
 * Connect/disconnect the Playbook Sheet's own Google OAuth grant (separate
 * from the QA Dashboard's — see server.ts's /api/kb/playbook/* routes and
 * src/server/knowledgeBase/playbookIngest.ts) and trigger a manual resync,
 * mirroring the "Connect Google Sheets" card pattern already used for the
 * QA Dashboard in Developer Controls (OwnerControlsPage.tsx).
 */
export function KnowledgeBasePlaybook({ theme, effectiveTier }: KnowledgeBasePlaybookProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Platform Admin" || effectiveTier === "Developer";

  const [status, setStatus] = useState<PlaybookConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMessage, setResyncMessage] = useState<string | null>(null);

  const refreshStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/kb/playbook/connection-status");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setStatus(body);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not load the Product Playbook's connection status.");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/kb/playbook/connection", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to disconnect (HTTP ${res.status}).`);
      await refreshStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setDisconnecting(false);
    }
  };

  const resync = async () => {
    setResyncing(true);
    setResyncMessage(null);
    try {
      const res = await fetch("/api/kb/playbook/resync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Resync failed (HTTP ${res.status}).`);
      setResyncMessage(
        body.skipped
          ? "No changes since the last sync."
          : `Synced ${body.planFactCount} plan${body.planFactCount === 1 ? "" : "s"} and ${body.narrativeChunkCount} reference excerpt${body.narrativeChunkCount === 1 ? "" : "s"}.`
      );
      await refreshStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Resync failed.");
    } finally {
      setResyncing(false);
    }
  };

  const cardClass = `rounded-2xl border ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"}`;

  return (
    <div className="space-y-5">
      <div className={`p-5 ${cardClass}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
          <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
            Product Playbook — Google Sheets
          </h3>
          <button
            type="button"
            onClick={refreshStatus}
            title="Refresh"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <p className={`text-[10.5px] mb-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
          The internal team's own plan-by-plan reference — takes precedence over general documents whenever it names
          exactly which sub-feature/variant applies to a plan (e.g. which bonus type is actually inbuilt). Reads the
          Sheet read-only as whoever connects below — no Workspace admin action or service account required.
          {canManage ? "" : " Read-only — Admin clearance is required to connect, disconnect, or resync."}
        </p>

        {statusError && (
          <div
            className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${
              dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{statusError}</span>
          </div>
        )}

        <div
          className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${
            dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {status?.connected ? (
              <>
                <CheckCircle2 className={`w-4 h-4 shrink-0 ${dark ? "text-emerald-300" : "text-emerald-600"}`} />
                <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>Connected as {status.connectedEmail}</span>
              </>
            ) : (
              <>
                <Unlink className={`w-4 h-4 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                <span className={`text-xs font-bold ${dark ? "text-stone-300" : "text-stone-600"}`}>Not connected</span>
              </>
            )}
          </div>

          {canManage &&
            (status?.connected ? (
              <button
                type="button"
                onClick={disconnect}
                disabled={disconnecting}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"
                }`}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <a
                href="/api/kb/playbook/connect-google"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
              >
                <Link2 className="w-3 h-3" />
                Connect Google Sheets
              </a>
            ))}
        </div>

        {status?.connected && (
          <div
            className={`mt-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${
              dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"
            }`}
          >
            <div className="text-[10.5px] space-y-0.5">
              {status.resource ? (
                <>
                  <p className={dark ? "text-stone-300" : "text-stone-600"}>
                    Last synced:{" "}
                    <span className="font-bold">
                      {status.resource.lastFetchedAt ? new Date(status.resource.lastFetchedAt).toLocaleString() : "never"}
                    </span>
                  </p>
                  <p className={dark ? "text-stone-400" : "text-stone-500"}>
                    {status.resource.planFactCount} plan{status.resource.planFactCount === 1 ? "" : "s"} · {status.resource.narrativeChunkCount}{" "}
                    reference excerpt{status.resource.narrativeChunkCount === 1 ? "" : "s"}
                    {status.resource.status === "error" && (
                      <span className={dark ? "text-red-300" : "text-red-600"}> · last sync failed: {status.resource.errorMessage}</span>
                    )}
                  </p>
                </>
              ) : (
                <p className={dark ? "text-stone-400" : "text-stone-500"}>Never synced yet.</p>
              )}
              {resyncMessage && <p className={dark ? "text-emerald-300" : "text-emerald-600"}>{resyncMessage}</p>}
            </div>
            {canManage && (
              <button
                type="button"
                onClick={resync}
                disabled={resyncing}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                  dark ? "border-white/[0.12] text-white hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"
                }`}
              >
                <RefreshCw className={`w-3 h-3 ${resyncing ? "animate-spin" : ""}`} />
                {resyncing ? "Syncing…" : "Resync now"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
