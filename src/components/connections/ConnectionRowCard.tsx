/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Link2, RefreshCw, ExternalLink } from "lucide-react";
import { ConnectionsRow, type ConnectionHealth } from "./ConnectionsTableUI";

/** Minimum shape every one of this card's callers' status responses share —
 * each caller's own richer interface (extra resource fields for its own
 * stats line) extends this. */
export interface BaseConnectionStatus {
  connected: boolean;
  connectedEmail?: string | null;
  sheetUrl?: string | null;
  resource?: {
    status?: "processing" | "active" | "error" | "archived";
    lastFetchedAt?: string | null;
    errorMessage?: string | null;
  } | null;
}

/** One flagged (conflicting-answer) record, as returned by
 * GET /api/kb/faq/records?hasConflict=true and the Term FAQ equivalent —
 * both faq_records and term_faq_records share this shape. */
interface FlaggedRecord {
  id: number;
  question: string;
  category?: string;
}

interface ConnectionRowCardProps<TStatus extends BaseConnectionStatus> {
  dark: boolean;
  icon: ReactNode;
  /** Distinct per-connection icon tint — see iconColorFor() in
   * ConnectionsTableUI.tsx. */
  iconColor?: { bg: string; fg: string };
  title: string;
  subtitle?: string;
  purpose: string;
  /** Plain-language "who actually uses this" line, shown as an FYI in the
   * expanded detail rather than left for users to guess or ask about. */
  usedBy: string;
  /** Plain-language refresh cadence, e.g. "Refreshes automatically every 5
   * minutes while in use." Also shown in the expanded detail. */
  syncCadence: string;
  statusEndpoint: string;
  connectHref: string;
  disconnectEndpoint: string;
  /** Omit for a read-only-and-nothing-else connection (none of the current
   * ones qualify, but keeps the card usable for a future simple case). */
  resyncEndpoint?: string;
  loadErrorFallback: string;
  /** When true, Connect/Disconnect/Resync require Admin+ (canManage) — the
   * standard note is appended to `purpose` when a non-manager views it.
   * Omit entirely (as QA Dashboard's row does) to match that row's existing,
   * ungated behavior. */
  gateByTier?: { canManage: boolean };
  /** Resource-specific stats line, rendered in the expanded detail panel.
   * Only called when connected. */
  renderDetails?: (status: TStatus) => ReactNode;
  /** GET endpoint returning `{ entries: FlaggedRecord[] }` — the specific
   * records behind a "N flagged for review" count (Health FAQ / Term FAQ
   * only). Fetched lazily, only once the row is expanded and only when
   * canManage (the endpoint itself is Admin/Developer-gated), so a
   * read-only viewer sees an explanatory note instead of a failed fetch. */
  flaggedEndpoint?: string;
  /** Parsed JSON resync response body; each caller's own resync endpoint has
   * a different shape (see e.g. KnowledgeBasePlaybook.tsx's planFactCount
   * vs. KnowledgeBaseFaqConnection.tsx's conflictingCount), same as how the
   * rest of this file already treats `await res.json()` results. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatResyncMessage?: (body: any) => string;
  /** Bump to force a refetch — Connections page's "Refresh All". */
  refreshSignal?: number;
  onStatusChange?: (info: { connected: boolean; attention: boolean }) => void;
}

const READ_ONLY_NOTE = " Read-only — Admin clearance is required to connect, disconnect, or resync.";

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * One "Data Sources" table row — connect/disconnect a read-only Google
 * Sheets grant, with an optional manual resync, plain-language "used by" /
 * sync-cadence copy, and a resource-specific stats line, all revealed by
 * clicking anywhere on the row (see ConnectionsRow's click-to-expand shell).
 * Used by ConnectionsPage.tsx directly (QA Dashboard) and by the three
 * Knowledge Base connection components (Playbook/Health FAQ/Term FAQ), which
 * were near-identical copies of this same connect/disconnect/resync/stats
 * pattern before the 2026-09 redesign — this is that pattern, extracted
 * once, with each caller supplying only what actually differs (endpoints,
 * copy, and its own resource fields via renderDetails/formatResyncMessage).
 */
export function ConnectionRowCard<TStatus extends BaseConnectionStatus>({
  dark,
  icon,
  iconColor,
  title,
  subtitle = "Google Sheets",
  purpose,
  usedBy,
  syncCadence,
  statusEndpoint,
  connectHref,
  disconnectEndpoint,
  resyncEndpoint,
  loadErrorFallback,
  gateByTier,
  renderDetails,
  flaggedEndpoint,
  formatResyncMessage,
  refreshSignal,
  onStatusChange,
}: ConnectionRowCardProps<TStatus>) {
  const [status, setStatus] = useState<TStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMessage, setResyncMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState<FlaggedRecord[] | null>(null);
  const [flaggedError, setFlaggedError] = useState<string | null>(null);
  const [flaggedLoading, setFlaggedLoading] = useState(false);

  // Kept current via an effect (never mutated during render) so the mount/
  // refresh effect below can call the latest onStatusChange without needing
  // it as a dependency — the caller's callback identity often isn't stable
  // across renders (see e.g. ConnectionsPage.tsx's inline handlers), and
  // depending on it directly would refetch on every parent render.
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Shared by the mount/refresh effect, post-disconnect, and post-resync —
  // all three re-GET the status endpoint rather than trusting a mutation
  // endpoint's own response body, matching the original (pre-redesign)
  // per-connector components' refreshStatus() behavior exactly.
  const loadStatus = async (): Promise<boolean> => {
    try {
      const res = await fetch(statusEndpoint);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setStatus(body);
      setStatusError(null);
      onStatusChangeRef.current?.({
        connected: !!body.connected,
        attention: !!body.connected && body.resource?.status === "error",
      });
      return true;
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : loadErrorFallback);
      onStatusChangeRef.current?.({ connected: false, attention: true });
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // loadStatus() itself only ever sets state on the current instance —
      // fine to await unconditionally and ignore its result if this effect
      // was already superseded by the time it resolves. The `cancelled`
      // check exists for future callers that might act on the return value;
      // no state write here needs guarding beyond what loadStatus already
      // does per-call.
      if (!cancelled) await loadStatus();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusEndpoint, refreshSignal]);

  const canManage = gateByTier ? gateByTier.canManage : true;

  // Flagged-records detail (Health FAQ / Term FAQ only, via flaggedEndpoint)
  // — fetched lazily the first time the row is expanded, not on mount, so
  // rows without an open conflict (or without canManage) never make the
  // call. The route itself requires Admin/Developer, matching every other
  // write-adjacent action on this row.
  useEffect(() => {
    if (!expanded || !flaggedEndpoint || !canManage || flagged !== null || flaggedLoading) return;
    // setFlaggedLoading(true) is inside this nested async function (not a
    // direct statement in the effect body) so it runs as part of the fetch
    // itself rather than synchronously during the effect's commit.
    (async () => {
      setFlaggedLoading(true);
      try {
        const res = await fetch(flaggedEndpoint);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
        setFlagged(body.entries ?? []);
        setFlaggedError(null);
      } catch (err) {
        setFlaggedError(err instanceof Error ? err.message : "Could not load the flagged records.");
      } finally {
        setFlaggedLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, flaggedEndpoint, canManage]);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch(disconnectEndpoint, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to disconnect (HTTP ${res.status}).`);
      await loadStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setDisconnecting(false);
    }
  };

  const resync = async () => {
    if (!resyncEndpoint) return;
    setResyncing(true);
    setResyncMessage(null);
    try {
      const res = await fetch(resyncEndpoint, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Resync failed (HTTP ${res.status}).`);
      setResyncMessage(formatResyncMessage ? formatResyncMessage(body) : "Synced.");
      setFlagged(null); // stale after a resync — refetched next time the panel is (re)opened
      await loadStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Resync failed.");
      // Best-effort re-check even on failure (2026-09 — a live report: the
      // Playbook's own sync is the slowest of these connections (it fetches
      // several sheet tabs and runs embeddings), so it's the one most likely
      // to outlast a dropped client connection or an intermediary proxy
      // timeout — the fetch() above can fail from OUR end while the sync
      // keeps running server-side to a successful finish, uninterrupted.
      // Without this, the row is stuck showing the pre-resync status/"last
      // synced" time — indistinguishable from an actual failure — until
      // something else happens to refetch it (e.g. Connections page's
      // "Refresh All", or a page reload). This re-check can't recover the
      // lost resync summary message (formatResyncMessage never runs), but
      // it does mean the status/timestamp shown stops being stale the
      // moment this fires, rather than staying wrong indefinitely.
      void loadStatus();
    } finally {
      setResyncing(false);
    }
  };

  // True connection health rather than just "is a grant on file" — a stored
  // grant whose most recent real Sheets call failed (resource.status ===
  // "error", set by the backend's passive health tracking) shows as
  // "Attention", not "Connected", even though the OAuth grant itself is
  // still present.
  const health: ConnectionHealth = !status?.connected ? "not_connected" : status.resource?.status === "error" ? "attention" : "connected";

  // Compact, always-visible summary — full detail (stats, flagged records,
  // resync result, used-by/cadence FYI) only appears once the row is
  // expanded, per the click-to-expand redesign.
  const summary = statusError ? (
    <span className={`flex items-start gap-1 ${dark ? "text-red-300" : "text-red-600"}`}>
      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
      {statusError}
    </span>
  ) : status?.connected ? (
    <span className={dark ? "text-stone-300" : "text-stone-600"}>
      {status.connectedEmail} · Last synced {relativeTime(status.resource?.lastFetchedAt)}
    </span>
  ) : (
    "Not connected"
  );

  const conflictCount = flagged?.length ?? null;

  const expandedContent = (
    <div className={`text-[11px] font-semibold leading-relaxed space-y-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>
      <p>
        <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Used by: </span>
        {usedBy}
      </p>
      <p>
        <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Refresh schedule: </span>
        {syncCadence}
      </p>
      {status?.connected && renderDetails && (
        <div>
          <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Latest sync: </span>
          {renderDetails(status)}
        </div>
      )}
      {resyncMessage && <p className={dark ? "text-emerald-300" : "text-emerald-600"}>{resyncMessage}</p>}
      {flaggedEndpoint && status?.connected && status.resource?.status !== "error" && (
        <div>
          <span className={`font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>Flagged for review: </span>
          {!canManage ? (
            "Ask an Admin to review these — flagged record details are restricted."
          ) : flaggedLoading ? (
            "Loading…"
          ) : flaggedError ? (
            <span className={dark ? "text-red-300" : "text-red-600"}>{flaggedError}</span>
          ) : conflictCount === 0 ? (
            "None right now."
          ) : conflictCount !== null ? (
            <ul className="mt-1 space-y-1 list-disc list-inside">
              {flagged!.slice(0, 10).map((r) => (
                <li key={r.id} className={dark ? "text-stone-300" : "text-stone-700"}>
                  {r.question}
                </li>
              ))}
              {flagged!.length > 10 && <li className="list-none">…and {flagged!.length - 10} more.</li>}
            </ul>
          ) : (
            "—"
          )}
        </div>
      )}
    </div>
  );

  const actions = (
    <>
      {status?.sheetUrl && (
        <a
          href={status.sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer whitespace-nowrap ${
            dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"
          }`}
        >
          <ExternalLink className="w-3 h-3" />
          Open Sheet
        </a>
      )}
      {resyncEndpoint && status?.connected && canManage && (
        <button
          type="button"
          onClick={resync}
          disabled={resyncing}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
            dark ? "border-sky-500/40 text-sky-300 hover:bg-sky-500/10" : "border-sky-300 text-sky-700 hover:bg-sky-50"
          }`}
        >
          <RefreshCw className={`w-3 h-3 ${resyncing ? "animate-spin" : ""}`} />
          {resyncing ? "Syncing…" : "Resync"}
        </button>
      )}
      {canManage &&
        (status?.connected ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={disconnecting}
            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
              dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"
            }`}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          // Shared --action-navy token (2026-09) instead of the old
          // bg-blue-600 family.
          <a
            href={connectHref}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer whitespace-nowrap"
          >
            <Link2 className="w-3 h-3" />
            Connect
          </a>
        ))}
    </>
  );

  return (
    <ConnectionsRow
      dark={dark}
      health={health}
      icon={icon}
      iconColor={iconColor}
      name={title}
      subtitle={subtitle}
      purpose={purpose + (gateByTier && !gateByTier.canManage ? READ_ONLY_NOTE : "")}
      details={summary}
      actions={actions}
      expandedContent={expandedContent}
      expanded={expanded}
      onToggleExpanded={setExpanded}
    />
  );
}
