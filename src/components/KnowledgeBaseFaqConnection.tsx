/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unlink } from "lucide-react";

interface KnowledgeBaseFaqConnectionProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
}

interface FaqConnectionStatus {
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: string | null;
  resource: {
    status: "processing" | "active" | "error" | "archived";
    lastFetchedAt: string | null;
    errorMessage: string | null;
    totalRecords: number;
    answerableCount: number;
    incompleteCount: number;
    conflictingCount: number;
    healthProductCount: number;
    operationsHealthCount: number;
  } | null;
}

/**
 * "Health FAQ" connection panel — Connections page, alongside the Product
 * Playbook's own card (KnowledgeBasePlaybook.tsx). Connect/disconnect the
 * FAQ Sheet's own Google OAuth grant (separate from the Playbook's — see
 * server.ts's /api/kb/faq/* routes and
 * src/server/knowledgeBase/faqIngest.ts) and trigger a manual resync,
 * mirroring KnowledgeBasePlaybook.tsx's card structure exactly.
 */
export function KnowledgeBaseFaqConnection({ theme, effectiveTier }: KnowledgeBaseFaqConnectionProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Platform Admin" || effectiveTier === "Developer";

  const [status, setStatus] = useState<FaqConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMessage, setResyncMessage] = useState<string | null>(null);

  const refreshStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/kb/faq/connection-status");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setStatus(body);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not load the Health FAQ's connection status.");
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
      const res = await fetch("/api/kb/faq/connection", { method: "DELETE" });
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
      const res = await fetch("/api/kb/faq/resync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Resync failed (HTTP ${res.status}).`);
      const parts: string[] = [];
      if (body.skipped) {
        parts.push("No changes since the last sync.");
      } else {
        parts.push(`Synced ${body.totalRecords} FAQ record${body.totalRecords === 1 ? "" : "s"}.`);
        if (body.conflictingCount > 0) parts.push(`${body.conflictingCount} flagged for review (conflicting duplicate answers).`);
        if (body.incompleteCount > 0) parts.push(`${body.incompleteCount} incomplete (no answer yet).`);
      }
      setResyncMessage(parts.join(" "));
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
            Health FAQ — Google Sheets
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
          Ditto's own official FAQ — the team's authoritative position on operational questions (what Ditto can/does
          facilitate), equal in authority to the Product Playbook. Reads the Sheet read-only as whoever connects
          below — no Workspace admin action or service account required.
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
                href="/api/kb/faq/connect-google"
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
                    {status.resource.healthProductCount} Health Product · {status.resource.operationsHealthCount} Operations Health
                    {status.resource.incompleteCount > 0 && <span> · {status.resource.incompleteCount} incomplete</span>}
                    {status.resource.conflictingCount > 0 && (
                      <span className={dark ? "text-amber-300" : "text-amber-700"}> · {status.resource.conflictingCount} flagged for review</span>
                    )}
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
