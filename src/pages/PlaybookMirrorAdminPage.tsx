/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — admin review screen (Phase 1, Step 6).
 * Admin-only (product_playbook_admin; every action is ALSO checked on the
 * server). Shows sync health and warnings, snapshots and their checks, a
 * faithful grid view of a snapshot, difference reports, plan statuses
 * (provisional until the product team confirms them), source issues, and a
 * preview of exactly what the read API would give advisors right now.
 * Publishing is manual and needs the snapshot number typed as confirmation.
 */

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Eye, FileDiff, Info, RefreshCw, RotateCcw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { PlaybookGrid as GridView, type PlaybookGridData as Grid } from "../components/PlaybookGrid";

interface Props {
  theme: "light" | "dark";
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

interface SnapshotRow {
  id: number; fetchedAt: string; trigger: string; status: string; parserVersion: string; rawSha256: string;
  rejectedReason: string | null; publishedAt: string | null; publishedBy: string | null;
  structure: { state: string | null; problems: string[]; needsReview: string[] } | null;
  reconciliation: { ok: boolean; differenceCount: number | null } | null;
}
interface Plan {
  planKey: string; insurer: string; displayName: string | null; expectedHeader: string | null; status: string;
  statusConfirmedBy: string | null; statusConfirmedAt: string | null; showToAdvisors: boolean; sortOrder: number;
  /** True when the plan's column is hidden in the source sheet: its header is not sent or shown. */
  hiddenInSource: boolean;
}
interface Overview {
  connection: { email: string; scopes: string[]; connectedAt: string; connectedBy: string } | null;
  syncState: { lastAttemptAt: string | null; lastSuccessAt: string | null; lastTrigger: string | null; lastError: string | null; lastSnapshotId: number | null } | null;
  published: { snapshotId: number; updatedBy: string; updatedAt: string } | null;
  snapshots: SnapshotRow[];
  plans: Plan[];
  featureCount: number;
  issues: { id: number; issueKey: string; kind: string; status: string; tabTitle: string; a1: string; description: string; showWarning: boolean }[];
  warnings: { level: "error" | "warning" | "info"; text: string }[];
}

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } } : undefined);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  return body as T;
}

const statusTone: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  published: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  fetched: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  superseded: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

function Pill({ text, tone }: { text: string; tone?: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${tone ?? "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"}`}>{text}</span>;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-content">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PlaybookMirrorAdminPage({ theme, hasAccess }: Props) {
  const dark = theme === "dark";
  const canEdit = hasAccess("product_playbook_admin", "Editor");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [diff, setDiff] = useState<any | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api<Overview>("/api/playbook-mirror/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  // Load once when the page opens (async fetch; state is set after the request resolves).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      const r = await fn();
      setMessage(`${label}: done.${(r as { warnings?: string[] })?.warnings?.length ? " Warnings: " + (r as { warnings: string[] }).warnings.join(" ") : ""}`);
      await load();
    } catch (e) {
      setMessage(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const openGrid = async (id: number, gid = 0) => { setDiff(null); setGrid(await api<Grid>(`/api/playbook-mirror/snapshots/${id}/grid?gid=${gid}`)); };
  const openDiff = async (id: number) => { setGrid(null); setDiff(await api(`/api/playbook-mirror/snapshots/${id}/diff`)); };

  const typed = (verb: string, id: number) => {
    const v = window.prompt(`${verb} snapshot #${id}? This changes what advisors could be shown once advisor access exists. Type ${id} to confirm.`);
    return v !== null && Number(v.trim()) === id;
  };


  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" style={{ color: dark ? "#00D3F3" : "#4673a9" }} />
            <h1 className="text-lg font-bold text-content">Playbook Mirror (Admin)</h1>
            <Pill text="Staging review" tone="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" />
          </div>
          <p className="text-xs mt-1 font-semibold text-content-muted">Exact, read-only copy of the Product Playbook sheet. Nothing here changes the sheet or Product Assist.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {canEdit && (
            <button disabled={!!busy} onClick={() => void act("Fetch now", () => api("/api/playbook-mirror/fetch", { method: "POST" }))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone-900 text-white dark:bg-white dark:text-stone-900 disabled:opacity-50">
              <Upload className="w-3.5 h-3.5 rotate-180" /> {busy === "Fetch now" ? "Fetching…" : "Fetch now"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/30 p-3 text-xs text-red-800 dark:text-red-200">{error}</div>}
      {message && <div className="rounded-lg border border-stone-300 bg-stone-50 dark:bg-stone-800 p-3 text-xs">{message}</div>}

      {data && (
        <>
          <Section title="Health and warnings">
            <ul className="space-y-1.5">
              {data.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {w.level === "error" ? <XCircle className="w-4 h-4 text-red-600 shrink-0" /> : w.level === "warning" ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> : <Info className="w-4 h-4 text-sky-600 shrink-0" />}
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div><div className="text-content-muted font-semibold">Google access</div>{data.connection ? <>{data.connection.email}<br /><Pill text="read-only" tone={statusTone.verified} /></> : "Not connected"}</div>
              <div><div className="text-content-muted font-semibold">Last successful fetch</div>{fmt(data.syncState?.lastSuccessAt)}</div>
              <div><div className="text-content-muted font-semibold">Published</div>{data.published ? `Snapshot #${data.published.snapshotId} (${fmt(data.published.updatedAt)})` : "Nothing published"}</div>
              <div><div className="text-content-muted font-semibold">Structure</div>{data.plans.length} plans · {data.featureCount} categories</div>
            </div>
          </Section>

          <Section title="Snapshots">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-content-muted">
                  <th className="py-1 pr-3">#</th><th className="pr-3">Fetched</th><th className="pr-3">Status</th><th className="pr-3">Structure</th><th className="pr-3">Reconciliation</th><th className="pr-3">Actions</th>
                </tr></thead>
                <tbody>
                  {data.snapshots.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="border-t border-stone-200 dark:border-stone-800 align-top">
                        <td className="py-1.5 pr-3 font-bold">{s.id}</td>
                        <td className="pr-3">{fmt(s.fetchedAt)}<div className="text-[10px] text-content-muted">{s.trigger}</div></td>
                        <td className="pr-3"><Pill text={s.status} tone={statusTone[s.status]} /></td>
                        <td className="pr-3">{s.structure?.state ?? "not checked"}{s.structure?.needsReview.length ? <div className="text-amber-700">{s.structure.needsReview.join(" ")}</div> : null}</td>
                        <td className="pr-3">{s.reconciliation ? (s.reconciliation.ok ? "0 differences" : `${s.reconciliation.differenceCount} differences`) : "—"}</td>
                        <td className="pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            <button className="inline-flex items-center gap-1 underline" onClick={() => void openGrid(s.id)}><Eye className="w-3 h-3" />View</button>
                            <button className="inline-flex items-center gap-1 underline" onClick={() => void openDiff(s.id)}><FileDiff className="w-3 h-3" />Differences</button>
                            {canEdit && s.status === "fetched" && s.structure?.state === "passed" && (
                              <button className="inline-flex items-center gap-1 underline" onClick={() => void act(`Verify #${s.id}`, () => api(`/api/playbook-mirror/snapshots/${s.id}/verify`, { method: "POST" }))}><ShieldCheck className="w-3 h-3" />Verify</button>
                            )}
                            {canEdit && s.status === "verified" && (
                              <button className="inline-flex items-center gap-1 underline text-sky-700 dark:text-sky-400" onClick={() => { if (typed("Publish", s.id)) void act(`Publish #${s.id}`, () => api(`/api/playbook-mirror/snapshots/${s.id}/publish`, { method: "POST", body: JSON.stringify({ confirmSnapshotId: s.id }) })); }}><CheckCircle2 className="w-3 h-3" />Publish…</button>
                            )}
                            {canEdit && s.status === "superseded" && (
                              <button className="inline-flex items-center gap-1 underline" onClick={() => { if (typed("Roll back to", s.id)) void act(`Roll back to #${s.id}`, () => api(`/api/playbook-mirror/snapshots/${s.id}/rollback`, { method: "POST", body: JSON.stringify({ confirmSnapshotId: s.id }) })); }}><RotateCcw className="w-3 h-3" />Roll back…</button>
                            )}
                            {canEdit && (s.status === "fetched" || s.status === "verified") && (
                              <button className="inline-flex items-center gap-1 underline text-red-700 dark:text-red-400" onClick={() => { const reason = window.prompt(`Reason for rejecting snapshot #${s.id}?`); if (reason) void act(`Reject #${s.id}`, () => api(`/api/playbook-mirror/snapshots/${s.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })); }}><XCircle className="w-3 h-3" />Reject…</button>
                            )}
                          </div>
                          {s.rejectedReason && <div className="text-red-700 dark:text-red-300 mt-1">{s.rejectedReason}</div>}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {grid && (
            <Section title={`Snapshot #${grid.snapshotId} — ${grid.tab.title}`} right={
              <div className="flex gap-1.5">
                {grid.tabs.map((t) => (
                  <button key={t.sheetGid} onClick={() => void openGrid(grid.snapshotId, t.sheetGid)} className={`px-2 py-1 rounded text-[11px] font-semibold border ${t.sheetGid === grid.tab.sheetGid ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900" : "border-stone-300 dark:border-stone-700"}`}>{t.title}</button>
                ))}
              </div>
            }>
              <p className="text-[11px] text-content-muted">Admin view of the configured range. Rows and columns hidden in the source sheet are not displayed. Text, formatting, links and notes are shown exactly as stored; notes are always visible.</p>
              <GridView grid={grid} />
            </Section>
          )}

          {diff && (
            <Section title={`Differences — snapshot #${diff.targetSnapshotId} vs ${diff.baseSnapshotId ? `#${diff.baseSnapshotId} (${diff.baseline})` : "nothing (no published snapshot)"}`}>
              {diff.notes?.map((n: string, i: number) => <p key={i} className="text-xs text-amber-800 dark:text-amber-300">{n}</p>)}
              <p className="text-xs">{diff.baseline === "none" ? "Nothing is published yet, so there is no baseline to compare against." : diff.identical ? "Identical." : `Changes: ${JSON.stringify(diff.counts)}`}</p>
              {[...(diff.merges ?? []), ...(diff.hidden ?? [])].map((m: string, i: number) => <p key={i} className="text-xs">{m}</p>)}
              {diff.cells?.length > 0 && (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-content-muted"><th>Cell</th><th>Plan</th><th>Category</th><th>Change</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>{diff.cells.map((c: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <tr key={i} className="border-t border-stone-200 dark:border-stone-800 align-top"><td>{c.a1}</td><td>{c.plan ?? "—"}</td><td>{c.feature ?? "—"}</td><td>{c.kind}</td><td className="whitespace-pre-wrap">{c.before ?? "∅"}</td><td className="whitespace-pre-wrap">{c.after ?? "∅"}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Section>
          )}

          <Section title={`Plans (${data.plans.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-content-muted"><th className="py-1 pr-3">Key</th><th className="pr-3">Header (exactly as in the sheet)</th></tr></thead>
                <tbody>
                  {data.plans.map((p) => (
                    <tr key={p.planKey} className="border-t border-stone-200 dark:border-stone-800 align-top">
                      <td className="py-1.5 pr-3 font-mono">{p.planKey}</td>
                      <td className="pr-3 whitespace-pre-wrap">{p.hiddenInSource || p.expectedHeader === null ? <span className="italic text-content-muted">Column hidden in the source sheet — not displayed</span> : JSON.stringify(p.expectedHeader).slice(1, -1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Source issues">
            <ul className="space-y-1.5 text-xs">
              {data.issues.map((i) => (
                <li key={i.id} className="flex items-start gap-2">
                  {i.showWarning ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> : <Info className="w-4 h-4 text-sky-600 shrink-0" />}
                  <span><b>{i.a1}</b> ({i.kind}, {i.status}): {i.description}</span>
                </li>
              ))}
            </ul>
          </Section>

        </>
      )}
    </div>
  );
}
