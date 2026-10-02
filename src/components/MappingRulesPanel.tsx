/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { mappingFetch } from "../utils/mappingFetch";

/**
 * Mapping Control > Rules (Phase 3B-ii): the routing pipeline as the engine runs it, with the controls an admin
 * is allowed to use — enable/disable, reorder inside a stage, add / edit / delete custom rules — and a
 * "Test a lookup" box that shows which rule decides a result. Every write goes through the impact gate
 * (preview, confirmation, undo); the server validates every edit and refuses anything dangerous.
 */

interface Band {
  stage: string;
  min: number;
  max: number;
  allowsNew: boolean;
  group: "main" | "post_guard";
  label: string;
}
interface Rule {
  ruleKey: string;
  kind: "rule" | "primitive";
  stage: string;
  position: number;
  planScope: string | null;
  enabled: boolean;
  description: string;
  definition: unknown;
  builtIn: boolean;
  editable: boolean;
}
interface Trace {
  resolved: boolean;
  matchType: string | null;
  question: string | null;
  decidedBy: string;
  postGuard: string | null;
  dictionary: { alias: string; source: string; pedCategory: string | null; effectiveCategory: string | null } | null;
  rule: { ruleKey: string; kind: string; stage: string; position: number; description: string; builtIn: boolean } | null;
  aiMemory: { status: string; question: string | null } | null;
  snapshotVersion: number;
}

const TEMPLATE = JSON.stringify(
  {
    when: [{ t: "text", re: "\\bexample term\\b", flags: "i" }],
    clauses: [{ then: { a: "route", type: "P1", chain: ["heart"], msg: "Matched by a custom rule for {ped}." } }],
  },
  null,
  2
);

export function MappingRulesPanel({ theme, canManage }: { theme: "light" | "dark"; canManage: boolean }) {
  const dark = theme === "dark";
  const [rules, setRules] = useState<Rule[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [plans, setPlans] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ description: "", definition: "", testTerms: "" });
  const [problems, setProblems] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState({ suffix: "", stage: "shield", position: "", description: "", definition: TEMPLATE, testTerms: "" });
  const [trace, setTrace] = useState<{ term: string; plan: string; result: Trace | null; error: string | null }>({ term: "", plan: "", result: null, error: null });
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/routing-rules");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRules(body.rules);
      setBands(body.bands);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch("/api/plan-configs")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const names = (Array.isArray(list) ? list : list.plans ?? []).filter((p: any) => !p.removed).map((p: any) => p.planName as string);
        setPlans(names);
        setTrace((t) => ({ ...t, plan: t.plan || names[0] || "" }));
      })
      .catch(() => undefined);
  }, [load]);

  const byStage = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, Rule[]>();
    for (const r of rules) {
      if (needle && !(r.ruleKey.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle))) continue;
      map.set(r.stage, [...(map.get(r.stage) ?? []), r]);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [rules, filter]);

  const write = async (url: string, method: string, body: unknown, description: string, testTerms: string[] = []) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await mappingFetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, description, { testTerms });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblems(Array.isArray(json.errors) ? json.errors : []);
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setProblems([]);
      setNotice(json.mappingChange ? `Saved and live. Change #${json.mappingChange.id} can be undone from History.` : "Saved and live.");
      await load();
      return true;
    } catch (e: any) {
      setError(e.message || "Failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const terms = (s: string) => s.split("\n").map((t) => t.trim()).filter(Boolean);
  const parse = (text: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e: any) {
      return { ok: false, error: `The rule definition is not valid JSON (${e.message}).` };
    }
  };

  const validate = async (stage: string, definition: string, ruleKey?: string) => {
    const p = parse(definition);
    if (p.ok === false) return setProblems([p.error]);
    const res = await fetch("/api/routing-rules/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, definition: p.value, ruleKey }) });
    const body = await res.json().catch(() => ({}));
    setProblems(res.ok ? body.errors ?? [] : [body.error || `HTTP ${res.status}`]);
    setNotice(res.ok && body.ok ? "This rule is valid." : null);
  };

  const runTrace = async () => {
    setTrace((t) => ({ ...t, result: null, error: null }));
    const res = await fetch("/api/mapping-trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term: trace.term, planName: trace.plan }) });
    const body = await res.json().catch(() => ({}));
    setTrace((t) => (res.ok ? { ...t, result: body, error: null } : { ...t, result: null, error: body.error || `HTTP ${res.status}` }));
  };

  const card = `rounded-xl border p-4 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200"}`;
  const input = `w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-slate-900 border-slate-600 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`;
  const btn = (primary = false) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed ${primary ? "bg-blue-600 text-white hover:bg-blue-700" : dark ? "bg-white/[0.06] hover:bg-white/[0.12] text-stone-200" : "bg-stone-100 hover:bg-stone-200 text-stone-700"}`;
  const muted = dark ? "text-stone-400" : "text-stone-500";
  const orderedStages = bands.filter((b) => b.group === "main").concat(bands.filter((b) => b.group === "post_guard"));

  const startEdit = (r: Rule) => {
    setEditing(r.ruleKey);
    setDraft({ description: r.description, definition: JSON.stringify(r.definition, null, 2), testTerms: "" });
    setProblems([]);
    setNotice(null);
  };

  const saveEdit = async (r: Rule) => {
    const p = parse(draft.definition);
    if (p.ok === false) return setProblems([p.error]);
    if (await write(`/api/routing-rules/${encodeURIComponent(r.ruleKey)}`, "PATCH", { description: draft.description, definition: p.value }, `Edited rule ${r.ruleKey}`, terms(draft.testTerms))) setEditing(null);
  };

  const freePosition = (stage: string): number => {
    const band = bands.find((b) => b.stage === stage);
    if (!band) return 0;
    const used = new Set(rules.filter((r) => bands.find((b) => b.stage === r.stage)?.group === band.group).map((r) => r.position));
    for (let p = band.min; p <= band.max; p++) if (!used.has(p)) return p;
    return band.min;
  };

  return (
    <div className="space-y-5 text-left">
      <div>
        <h2 className={`text-lg font-black ${dark ? "text-white" : "text-[#111827]"}`}>Routing rules</h2>
        <p className={`text-xs mt-1 font-semibold ${muted}`}>
          The order the engine evaluates, first match wins within the pipeline. Built-in algorithm steps are fixed; rules can be switched off, reordered inside their stage, edited, or added. Every change shows its impact before it
          is saved and can be undone from History.
          {!canManage && " Read-only — you don't have permission to make changes."}
        </p>
      </div>

      {(error || notice) && (
        <div className={`rounded-lg p-3 text-sm ${error ? (dark ? "bg-red-900/30 text-red-200" : "bg-red-50 text-red-800") : dark ? "bg-emerald-900/30 text-emerald-200" : "bg-emerald-50 text-emerald-800"}`}>
          {error ?? notice}
          {problems.length > 1 && (
            <ul className="list-disc pl-5 mt-1">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Test a lookup */}
      <div className={card}>
        <h3 className="text-sm font-black mb-2">Test a lookup — which rule decides it?</h3>
        <div className="flex flex-col md:flex-row gap-2">
          <input className={input} placeholder="Condition, e.g. sleep apnea" value={trace.term} onChange={(e) => setTrace((t) => ({ ...t, term: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && trace.term.trim() && runTrace()} />
          <select className={`${input} md:w-64`} value={trace.plan} onChange={(e) => setTrace((t) => ({ ...t, plan: e.target.value }))}>
            {plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button className={btn(true)} disabled={!trace.term.trim() || !trace.plan} onClick={runTrace}>
            Trace
          </button>
        </div>
        {trace.error && <p className="mt-2 text-sm text-red-500">{trace.error}</p>}
        {trace.result && (
          <div className="mt-3 text-sm space-y-1">
            <p>
              <strong>{trace.result.resolved ? `${trace.result.matchType}: ${trace.result.question}` : "Not decided by the rules"}</strong>
            </p>
            {trace.result.rule ? (
              <p className={muted}>
                Decided by <code>{trace.result.rule.ruleKey}</code> ({trace.result.rule.kind}, {bands.find((b) => b.stage === trace.result!.rule!.stage)?.label ?? trace.result.rule.stage}, position {trace.result.rule.position}) —{" "}
                {trace.result.rule.description}
              </p>
            ) : (
              <p className={muted}>{trace.result.resolved ? `Decided by ${trace.result.decidedBy}.` : "No rule decided this: it would go to AI Memory / the AI step."}</p>
            )}
            {trace.result.postGuard && <p className={muted}>Then adjusted by post-guard <code>{trace.result.postGuard}</code>.</p>}
            {trace.result.dictionary && (
              <p className={muted}>
                Dictionary: "{trace.result.dictionary.alias}" → category {trace.result.dictionary.effectiveCategory ?? "none"} (from {trace.result.dictionary.source.replace(/_/g, " ")}).
              </p>
            )}
            {trace.result.aiMemory && (
              <p className={muted}>
                AI Memory has a {trace.result.aiMemory.status} answer for this: {trace.result.aiMemory.question ?? "(rejected — advisors see the Others question with a manual-review note)"}.
              </p>
            )}
            <p className={`text-[11px] ${muted}`}>Mapping version {trace.result.snapshotVersion}. Read-only: no AI call and no search history.</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input className={`${input} max-w-xs`} placeholder="Filter rules…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canManage && (
          <button
            className={btn(true)}
            onClick={() => {
              setAdding((a) => !a);
              setAdd((x) => ({ ...x, position: String(freePosition(x.stage)) }));
              setProblems([]);
            }}
          >
            {adding ? "Close" : "Add a rule"}
          </button>
        )}
        <button className={btn()} onClick={() => load()} disabled={loading}>
          Reload
        </button>
      </div>

      {adding && canManage && (
        <div className={card}>
          <h3 className="text-sm font-black mb-2">New rule</h3>
          <div className="grid md:grid-cols-4 gap-2">
            <input className={input} placeholder="short name (e.g. sleep_apnea_guard)" value={add.suffix} onChange={(e) => setAdd({ ...add, suffix: e.target.value })} />
            <select
              className={input}
              value={add.stage}
              onChange={(e) => setAdd({ ...add, stage: e.target.value, position: String(freePosition(e.target.value)) })}
            >
              {bands.filter((b) => b.allowsNew).map((b) => (
                <option key={b.stage} value={b.stage}>
                  {b.label}
                </option>
              ))}
            </select>
            <input className={input} placeholder="position" inputMode="numeric" value={add.position} onChange={(e) => setAdd({ ...add, position: e.target.value })} />
            <input className={input} placeholder="what it does" value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })} />
          </div>
          <textarea className={`${input} mt-2 font-mono text-xs`} rows={9} value={add.definition} onChange={(e) => setAdd({ ...add, definition: e.target.value })} spellCheck={false} />
          <textarea className={`${input} mt-2 text-xs`} rows={2} placeholder="Terms to include in the impact preview, one per line (e.g. wording this rule should catch)" value={add.testTerms} onChange={(e) => setAdd({ ...add, testTerms: e.target.value })} />
          <div className="mt-2 flex gap-2">
            <button className={btn()} onClick={() => validate(add.stage, add.definition)}>
              Validate
            </button>
            <button
              className={btn(true)}
              disabled={busy || !add.suffix.trim() || !add.description.trim()}
              onClick={async () => {
                const p = parse(add.definition);
                if (p.ok === false) return setProblems([p.error]);
                if (await write("/api/routing-rules", "POST", { suffix: add.suffix.trim(), stage: add.stage, position: Number(add.position), description: add.description, definition: p.value }, `Added rule custom.${add.suffix.trim()}`, terms(add.testTerms))) {
                  setAdding(false);
                  setAdd({ suffix: "", stage: "shield", position: "", description: "", definition: TEMPLATE, testTerms: "" });
                }
              }}
            >
              Preview &amp; save
            </button>
          </div>
          {problems.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-500">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <p className={muted}>Loading rules…</p>
      ) : (
        orderedStages.map((band) => {
          const list = byStage.get(band.stage);
          if (!list?.length) return null;
          return (
            <div key={`${band.group}-${band.stage}`} className={card}>
              <h3 className="text-sm font-black">{band.label}</h3>
              <p className={`text-[11px] mb-2 ${muted}`}>Positions {band.min}–{band.max}{band.group === "post_guard" ? " (ordered separately, applied after an answer is chosen)" : ""}</p>
              <ul className="divide-y divide-stone-200/40">
                {list.map((r, i) => (
                  <li key={r.ruleKey} className="py-2">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className={`text-[11px] font-mono w-10 shrink-0 ${muted}`}>{r.position}</span>
                      <div className="flex-1 min-w-[12rem]">
                        <div className="text-sm font-semibold break-all">
                          {r.ruleKey}{" "}
                          {r.kind === "primitive" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-500/20">built-in step</span>}
                          {r.kind === "rule" && !r.builtIn && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20">custom</span>}
                          {!r.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 ml-1">disabled</span>}
                          {r.planScope && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-500/20 ml-1">{r.planScope}</span>}
                        </div>
                        <div className={`text-xs ${muted}`}>{r.description}</div>
                      </div>
                      {canManage && r.editable && (
                        <div className="flex gap-1 shrink-0">
                          <button className={btn()} disabled={busy || i === 0} title="Move earlier" onClick={() => write(`/api/routing-rules/${encodeURIComponent(r.ruleKey)}/move`, "POST", { direction: "up" }, `Moved ${r.ruleKey} earlier`)}>
                            ↑
                          </button>
                          <button className={btn()} disabled={busy || i === list.length - 1} title="Move later" onClick={() => write(`/api/routing-rules/${encodeURIComponent(r.ruleKey)}/move`, "POST", { direction: "down" }, `Moved ${r.ruleKey} later`)}>
                            ↓
                          </button>
                          <button className={btn()} disabled={busy} onClick={() => write(`/api/routing-rules/${encodeURIComponent(r.ruleKey)}`, "PATCH", { enabled: !r.enabled }, `${r.enabled ? "Disabled" : "Enabled"} rule ${r.ruleKey}`)}>
                            {r.enabled ? "Disable" : "Enable"}
                          </button>
                          <button className={btn()} disabled={busy} onClick={() => (editing === r.ruleKey ? setEditing(null) : startEdit(r))}>
                            {editing === r.ruleKey ? "Close" : "Edit"}
                          </button>
                          {!r.builtIn && (
                            <button className={btn()} disabled={busy} onClick={() => write(`/api/routing-rules/${encodeURIComponent(r.ruleKey)}`, "DELETE", undefined, `Deleted rule ${r.ruleKey}`)}>
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {editing === r.ruleKey && (
                      <div className="mt-2 space-y-2">
                        <input className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                        <textarea className={`${input} font-mono text-xs`} rows={12} value={draft.definition} onChange={(e) => setDraft({ ...draft, definition: e.target.value })} spellCheck={false} />
                        <textarea className={`${input} text-xs`} rows={2} placeholder="Terms to include in the impact preview, one per line" value={draft.testTerms} onChange={(e) => setDraft({ ...draft, testTerms: e.target.value })} />
                        <div className="flex gap-2">
                          <button className={btn()} onClick={() => validate(r.stage, draft.definition, r.ruleKey)}>
                            Validate
                          </button>
                          <button className={btn(true)} disabled={busy} onClick={() => saveEdit(r)}>
                            Preview &amp; save
                          </button>
                        </div>
                        {problems.length > 0 && (
                          <ul className="list-disc pl-5 text-sm text-red-500">
                            {problems.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
