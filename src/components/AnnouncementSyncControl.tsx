/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ClippedButton } from "./ClippedButton";

/** Fired on `window` after a sync finishes, so every announcements view (the
 * Home carousel, the acknowledge popup, both tables) can reload itself. */
export const ANNOUNCEMENTS_SYNCED_EVENT = "announcements-synced";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/**
 * "Sync" button for the QA Google Sheet feed. Shows when the announcements were
 * last synced. The server also syncs automatically once a day (see
 * maybeAutoSyncAnnouncements in server.ts) — this is the manual "fetch new
 * announcements right now" button.
 */
export function AnnouncementSyncControl({ theme }: { theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const [busy, setBusy] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [isError, setIsError] = useState(false);

  const loadStatus = useCallback(() => {
    fetch("/api/announcements/sync-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s) setLastSuccessAt(s.lastSuccessAt ?? null); })
      .catch(() => { /* status is cosmetic */ });
  }, []);

  useEffect(() => {
    loadStatus();
    const onSynced = () => loadStatus();
    window.addEventListener(ANNOUNCEMENTS_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(ANNOUNCEMENTS_SYNCED_EVENT, onSynced);
  }, [loadStatus]);

  const run = async () => {
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/announcements/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.message || body.error || `Sync failed (HTTP ${res.status}).`);
      setMessage(body.added ? `${body.added} new announcement${body.added === 1 ? "" : "s"} added.` : body.throttled ? body.message : "Already up to date.");
      window.dispatchEvent(new Event(ANNOUNCEMENTS_SYNCED_EVENT));
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span
        className={`text-[10px] font-mono ${isError ? (dark ? "text-red-400" : "text-red-600") : "text-content-muted"}`}
        title="Announcements also sync automatically once a day"
      >
        {message || `Last synced ${timeAgo(lastSuccessAt)}`}
      </span>
      <ClippedButton
        onClick={run}
        disabled={busy}
        size="sm"
        title="Fetch new announcements from the QA sheet now"
        className="shrink-0 gap-1.5 pl-2 pr-2.5 py-1.5 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb]"
      >
        <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${busy ? "animate-spin" : ""}`} />
        <span>{busy ? "Syncing…" : "Sync"}</span>
      </ClippedButton>
    </div>
  );
}
