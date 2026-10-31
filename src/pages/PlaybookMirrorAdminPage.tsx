/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PLAYBOOK SYNC (admin) — keeps the advisor "Product Playbook" page in step
 * with the Google Sheet. Platform Admins only (product_playbook_admin; every
 * action is also checked on the server). The page answers three questions in
 * plain words: what advisors see now, whether anything needs attention, and
 * what happened in recent updates. Updates that pass the automatic checks go
 * live on their own; an earlier version can be brought back if needed.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Link2, RefreshCw, RotateCcw } from "lucide-react";

interface Props {
  theme: "light" | "dark";
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

interface Update {
  id: number;
  at: string;
  trigger: string;
  status: string;
  layoutChanged: boolean;
  layoutChanges: string[];
  reason: string | null;
}
interface Summary {
  connectedEmail: string | null;
  /** False on a new environment until the sheet's layout is set up once. */
  layoutReady: boolean;
  lastCheckedAt: string | null;
  stale: boolean | null;
  live: { snapshotId: number; sheetAsOf: string | null; since: string } | null;
  updates: Update[];
  notes: { id: number; tabTitle: string; a1: string; description: string }[];
}
interface FetchResult {
  ok: boolean;
  skipped?: boolean;
  snapshotId?: number;
  status?: string;
  published?: boolean;
  error?: string;
}

// "9:28 PM, 30 Oct 2026"
const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}, ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
};
// "manual:name@x.in (any note)" → "name@x.in"; anything else was automatic.
const who = (trigger: string) => (trigger.startsWith("manual:") ? trigger.slice("manual:".length).trim().split(/\s/)[0] : "Automatic");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } } : undefined);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Something went wrong (code ${res.status}).`);
  return body as T;
}

/** What happened to an update, in plain words. */
function outcome(u: Update, liveId: number | null, layoutReady: boolean): { label: string; tone: "good" | "muted" | "warn" } {
  if (u.id === liveId) return { label: "Live now", tone: "good" };
  if (!layoutReady && u.status === "fetched") return { label: "Waiting for setup", tone: "warn" };
  if (u.status === "published" || u.status === "superseded") return { label: "Shown earlier", tone: "muted" };
  if (u.status === "verified") return { label: "Checked, not shown", tone: "muted" };
  if (u.status === "rejected" && u.reason?.startsWith("Rejected by")) return { label: "Withdrawn", tone: "muted" };
  if (u.layoutChanged) return { label: "Held back: sheet layout changed", tone: "warn" };
  if (u.status === "rejected") return { label: "Held back: didn't match the sheet", tone: "warn" };
  return { label: "Not shown", tone: "muted" };
}

function Card({ title, dark, children }: { title: string; dark: boolean; children: ReactNode }) {
  return (
    <section className={`rounded-xl border p-4 space-y-3 ${dark ? "bg-[#102236] border-[#1e3e5c]" : "bg-white border-[#D3DAE5]"}`}>
      <h2 className={`text-sm font-bold ${dark ? "text-[#F5F7FA]" : "text-[#1E293B]"}`}>{title}</h2>
      {children}
    </section>
  );
}

export function PlaybookMirrorAdminPage({ theme, hasAccess }: Props) {
  const dark = theme === "dark";
  const canEdit = hasAccess("product_playbook_admin", "Editor");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Summary>("/api/playbook-mirror/overview"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  // Load once when the page opens (async fetch; state is set after the request resolves).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ tone: "good" | "warn"; text: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage({ tone: "warn", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const updateNow = () =>
    run(async () => {
      const r = await api<FetchResult>("/api/playbook-mirror/fetch", { method: "POST" }).catch((e: Error) => ({ ok: false, error: e.message }) as FetchResult);
      if (!r.ok) return { tone: "warn", text: `Couldn't read the Google Sheet. Please try again in a few minutes. (${r.error ?? "no details"})` };
      if (r.skipped) return { tone: "good", text: "Nothing has changed in the sheet since the last update." };
      if (r.published) return { tone: "good", text: "Done. Advisors now see the latest Playbook." };
      return { tone: "warn", text: "This update was held back, so advisors still see the previous version. See \"Needs attention\" below." };
    });

  // One-time setup on a new environment: learn the sheet's layout from the latest copy
  // (reading the sheet first if there's none), run the usual checks, then show it.
  const setUp = () => {
    if (!window.confirm("Set up the Playbook from the Google Sheet now? The app learns which column is which plan and which row is which feature, checks the copy, and then shows the Playbook to advisors.")) return;
    void run(async () => {
      const latest = data?.updates[0];
      let id = latest?.status === "fetched" ? latest.id : null;
      if (!id) {
        const r = await api<FetchResult>("/api/playbook-mirror/fetch", { method: "POST" });
        if (!r.ok || !r.snapshotId) return { tone: "warn", text: `Couldn't read the Google Sheet. Please try again in a few minutes. (${r.error ?? "no details"})` };
        if (r.status !== "fetched") return { tone: "warn", text: "The sheet couldn't be read cleanly, so setup didn't finish. Please try again. If it keeps happening, tell the tech team." };
        id = r.snapshotId;
      }
      await api("/api/playbook-mirror/structure/accept", { method: "POST", body: JSON.stringify({ snapshotId: id }) });
      const check = await api<{ state: string }>(`/api/playbook-mirror/snapshots/${id}/check-structure`, { method: "POST" });
      if (check.state !== "passed") return { tone: "warn", text: "The layout was saved, but the copy didn't pass the checks, so nothing was shown to advisors. Please tell the tech team." };
      const v = await api<{ outcome: string }>(`/api/playbook-mirror/snapshots/${id}/verify`, { method: "POST" });
      if (v.outcome !== "verified") return { tone: "warn", text: "The layout was saved, but the copy didn't match the sheet exactly, so nothing was shown to advisors. Click \"Update now\" to try again." };
      await api(`/api/playbook-mirror/snapshots/${id}/publish`, { method: "POST", body: JSON.stringify({ confirmSnapshotId: id }) });
      return { tone: "good", text: "All set. Advisors now see the Playbook, and \"Update now\" will keep it current." };
    });
  };

  const showAgain = (u: Update) => {
    if (!window.confirm(`Show advisors the Playbook as it was at ${when(u.at)}?`)) return;
    const url = u.status === "verified" ? `/api/playbook-mirror/snapshots/${u.id}/publish` : `/api/playbook-mirror/snapshots/${u.id}/rollback`;
    void run(async () => {
      await api(url, { method: "POST", body: JSON.stringify({ confirmSnapshotId: u.id }) });
      return { tone: "good", text: `Advisors now see the Playbook as it was at ${when(u.at)}.` };
    });
  };

  // Colours set per theme (the app's global theme rules restyle stone-* utilities).
  const c = dark
    ? { card: "bg-[#102236] border-[#1e3e5c]", text: "text-[#F5F7FA]", muted: "text-[#A9C0DC]", line: "border-[#1e3e5c]", primary: "bg-[#0891B2] hover:bg-[#0E7490] text-white", secondary: "border-[#1e3e5c] text-[#DCEAFB] hover:bg-[#143B61]" }
    : { card: "bg-white border-[#D3DAE5]", text: "text-[#1E293B]", muted: "text-[#4C5A72]", line: "border-[#D3DAE5]", primary: "bg-[#0754B7] hover:bg-[#06469A] text-white", secondary: "border-[#8A9BB0] text-[#1E293B] bg-white hover:bg-[#E1EAF7]" };
  const toneClass = {
    good: dark ? "bg-emerald-900/40 text-emerald-200" : "bg-emerald-50 text-emerald-800",
    muted: dark ? "bg-[#0B2A44] text-[#A9C0DC]" : "bg-[#EEF1F5] text-[#4C5A72]",
    warn: dark ? "bg-amber-900/40 text-amber-200" : "bg-amber-50 text-amber-900",
  };

  // Things an admin should act on, most important first.
  const attention: { text: string; details?: string[]; action?: ReactNode }[] = [];
  const latest = data?.updates[0];
  const sinceText = data?.live?.sheetAsOf ? ` Advisors still see the version from ${when(data.live.sheetAsOf)}.` : "";
  if (data) {
    if (!data.connectedEmail) {
      attention.push({
        text: "The Google Sheet isn't connected, so the Playbook can't be updated.",
        action: canEdit ? (
          <a href="/api/playbook-mirror/connect-google" className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${c.primary}`}>
            <Link2 className="w-3.5 h-3.5" /> Connect Google Sheet
          </a>
        ) : undefined,
      });
    }
    if (data.connectedEmail && !data.layoutReady) {
      attention.push({
        text: "The Playbook hasn't been set up here yet. This is a one-time step: the app learns the sheet's layout (which column is which plan, which row is which feature), and then advisors can see the Playbook.",
        action: canEdit ? (
          <button disabled={busy} onClick={setUp} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${c.primary}`}>
            <CheckCircle2 className="w-3.5 h-3.5" /> {busy ? "Setting up…" : "Set up from the Google Sheet"}
          </button>
        ) : undefined,
      });
    } else if (!data.live) attention.push({ text: "Advisors can't see the Playbook yet. Click \"Update now\" to load it." });
    if (latest && latest.id !== data.live?.snapshotId && latest.status === "rejected" && !latest.reason?.startsWith("Rejected by")) {
      attention.push(
        latest.layoutChanged
          ? {
              text: `The Playbook sheet's layout has changed (for example, a plan was added, renamed or moved), so the latest update was held back.${sinceText} Ask the tech team to update the Playbook setup.`,
              details: latest.layoutChanges,
            }
          : { text: `The latest update was held back because the copy didn't match the sheet exactly.${sinceText} Try "Update now" again. If it keeps happening, tell the tech team.` }
      );
    }
    if (data.stale) attention.push({ text: "The Playbook hasn't been updated in the last 24 hours. Click \"Update now\" to bring it up to date." });
  }
  const healthy = data && attention.length === 0;

  return (
    <div className="space-y-4 text-left max-w-4xl">
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b ${c.line}`}>
        <div>
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" style={{ color: dark ? "#00D3F3" : "#0754B7" }} />
            <h1 className={`text-lg font-bold ${c.text}`}>Playbook Sync</h1>
          </div>
          <p className={`text-xs mt-1 font-semibold ${c.muted}`}>Keeps the Product Playbook page in step with the Google Sheet. The sheet itself is never changed.</p>
        </div>
        {canEdit && (
          <button disabled={busy || !data?.connectedEmail} onClick={() => void updateNow()}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${c.primary}`}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> {busy ? "Updating…" : "Update now"}
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/30 p-3 text-xs text-red-800 dark:text-red-200">Couldn't load this page. {error}</div>}
      {message && (
        <div className={`flex items-start gap-2 rounded-lg p-3 text-xs font-semibold ${toneClass[message.tone]}`}>
          {message.tone === "good" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {message.text}
        </div>
      )}

      {data && (
        <>
          <Card title="What advisors see" dark={dark}>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${healthy ? toneClass.good : toneClass.warn}`}>
                {healthy ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {healthy ? "Up to date" : "Needs attention"}
              </span>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <dt className={`font-semibold ${c.muted}`}>Playbook shown to advisors</dt>
                <dd className={`mt-0.5 font-semibold ${c.text}`}>{data.live ? `As of ${when(data.live.sheetAsOf)}` : "Nothing yet"}</dd>
              </div>
              <div>
                <dt className={`font-semibold ${c.muted}`}>Last checked against the sheet</dt>
                <dd className={`mt-0.5 font-semibold ${c.text}`}>{when(data.lastCheckedAt)}</dd>
              </div>
              <div>
                <dt className={`font-semibold ${c.muted}`}>Reads the sheet as</dt>
                <dd className={`mt-0.5 font-semibold break-all ${c.text}`}>{data.connectedEmail ? `${data.connectedEmail} (view only)` : "Not connected"}</dd>
              </div>
            </dl>
          </Card>

          {attention.length > 0 && (
            <Card title="Needs attention" dark={dark}>
              <ul className="space-y-3">
                {attention.map((a, i) => (
                  <li key={i} className={`rounded-lg p-3 text-xs space-y-2 ${toneClass.warn}`}>
                    <div className="flex items-start gap-2 font-semibold"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{a.text}</span></div>
                    {a.details && a.details.length > 0 && (
                      <details className="pl-6">
                        <summary className="cursor-pointer font-semibold">What changed in the sheet</summary>
                        <ul className="list-disc pl-4 mt-1 space-y-0.5 font-normal">{a.details.map((d, j) => <li key={j}>{d}</li>)}</ul>
                      </details>
                    )}
                    {a.action && <div className="pl-6">{a.action}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.notes.length > 0 && (
            <Card title="Good to know" dark={dark}>
              <ul className="space-y-1.5 text-xs">
                {data.notes.map((n) => (
                  <li key={n.id} className={`flex items-start gap-2 ${c.text}`}>
                    <Info className={`w-4 h-4 shrink-0 ${c.muted}`} />
                    <span>Cell {n.a1} on "{n.tabTitle}" has a picture that can't be copied. Advisors see a note there asking them to check the Playbook directly.</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Recent updates" dark={dark}>
            {data.updates.length === 0 ? (
              <p className={`text-xs ${c.muted}`}>No updates yet.</p>
            ) : (
              <ul className={`divide-y text-xs ${dark ? "divide-[#1e3e5c]" : "divide-[#D3DAE5]"}`}>
                {data.updates.map((u) => {
                  const o = outcome(u, data.live?.snapshotId ?? null, data.layoutReady);
                  const canShow = canEdit && u.id !== data.live?.snapshotId && (u.status === "superseded" || u.status === "verified");
                  return (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <div className={`font-semibold ${c.text}`}>{when(u.at)}</div>
                        <div className={c.muted}>{who(u.trigger) === "Automatic" ? "Automatic update" : `Updated by ${who(u.trigger)}`}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${toneClass[o.tone]}`}>{o.label}</span>
                        {canShow && (
                          <button disabled={busy} onClick={() => showAgain(u)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold disabled:opacity-50 ${c.secondary}`}>
                            <RotateCcw className="w-3 h-3" /> Show this version
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
