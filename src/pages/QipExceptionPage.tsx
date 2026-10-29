/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Plus, ArrowLeft, Download, RefreshCw, Trash2, User } from "lucide-react";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";
import {
  CAT_KEYS,
  emptyInputs,
  emptyAdvisor,
  validate,
  activeCats,
  isBlank,
  parseCount,
  blunderPctHundredths,
  fmtPct,
  fmtMonthYear,
} from "../qipException/core";
import { buildDocument, checkOutput, buildAdvisorFacts, buildSharedFacts, aiKey } from "../qipException/template";
import { monthRange, monthLabel, scoreText } from "../qipException/months";
import {
  PANEL_RADIUS,
  STROKE_WIDTH,
  TAB_CONTENT_GAP,
  TAB_HEIGHT,
  TAB_LOGO_SIZE,
  TAB_PADDING_X,
  getPanelPath,
  getTabPath,
  useInsurerRowGeometry,
} from "../components/InsurerConfigGeometry";

/**
 * QIP EXCEPTION REQUEST GENERATOR
 * ---------------------------------------------------------------
 * Helps you create a QIP exception request document for your advisors, based on the details you enter.
 * Ported from the standalone "QIP Exception Doc Generator" tool; the rules
 * are unchanged:
 *  - Fixed headings, tables, numbers, dates and Blunder % are written by code
 *    (src/qipException/template.ts + core.ts). No AI.
 *  - AI writes only the advisor-specific paragraphs, the Background and the
 *    Conclusion (POST /api/qip-exception/draft, see server.ts and
 *    src/server/qipException/qipExceptionWriter.ts).
 *  - Checks run before download: required fields, every number in the written
 *    text must come from the inputs, tables must match the inputs, Conclusion
 *    last. Export is blocked while any check fails.
 * Nothing is stored: the form lives in this page's state only.
 *
 * ADVISOR PICKER + AUTOFILL: advisors are picked from the same scope the Team
 * Tracker uses (/api/qa-dashboard/team-tracker/context: a Guide sees their
 * team, a Mentor their mentees, an Admin everyone). The QIP Month scores and
 * the Past-months numbers are then prefilled from /api/qip-exception/scores
 * (the Team Tracker's own scoring, read-only). Autofill REPLACES whatever is in
 * those fields whenever the advisor, the QIP Month, or the Past-months From
 * month / count / category changes — regardless of who typed it — but every
 * value stays editable afterwards, and editing never triggers a refill.
 */

interface QipExceptionPageProps {
  theme: "light" | "dark";
}

type AiText = { background: string[]; conclusion: string[]; advisors: Record<string, { overview: string[]; lead: string[]; pay: string[] }> };
interface PickableAdvisor {
  tactId: string;
  name: string;
}
interface QipMonthScores {
  monthKey: string;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  leadScoreBlunders: number;
  paymentsAvg: number | null;
  paymentsInstances: number;
  paymentsBlunders: number;
}

// Form labels for the two categories (the document's own wording is unchanged).
const FORM_CAT: Record<string, string> = { lead: "LEAD SCORE", pay: "PAYMENTS QA" };

const newAdvisor = () => {
  const a: any = emptyAdvisor((crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())).replace(/[^a-z0-9]/gi, "").slice(0, 10));
  a.tactId = "";
  a.trendUi = newTrendUi();
  return a;
};
const freshInputs = () => {
  const i = emptyInputs();
  i.advisors.push(newAdvisor());
  return i;
};
const emptyAi = (): AiText => ({ background: [], conclusion: [], advisors: {} });

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string, value: any) {
  const keys = path.split(".");
  const last = keys.pop() as string;
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// ---------- past months: count + From month fill the months automatically ----------
const newTrendUi = () => ({ count: 0, from: "", cats: { lead: true, pay: true } as Record<string, boolean> });
function syncTrend(a: any) {
  const ui = (a.trendUi ||= newTrendUi());
  const cats = activeCats(a).filter((k: string) => ui.cats[k]);
  const range = ui.from && ui.count ? monthRange(ui.from, ui.count) : [];
  a.trend = (a.trend || []).filter((r: any) => r.slot !== undefined && r.slot < range.length && cats.includes(r.category));
  for (let s = 0; s < range.length; s++) {
    for (const k of cats) {
      if (!a.trend.some((r: any) => r.slot === s && r.category === k)) a.trend.push({ slot: s, category: k, month: "", monthKey: "", score: "", instances: "", blunders: "" });
    }
  }
  a.trend.forEach((r: any) => {
    r.month = range[r.slot].name;
    r.monthKey = range[r.slot].key;
  });
  a.trend.sort((x: any, y: any) => x.slot - y.slot || CAT_KEYS.indexOf(x.category) - CAT_KEYS.indexOf(y.category));
  return { cats, range };
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

async function writeText(task: "shared" | "advisor", facts: string): Promise<any> {
  const res = await fetch("/api/qip-exception/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, facts }),
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body (e.g. a proxy 503) */
  }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function fetchScores(tactId: string, fromMonth: string, toMonth: string): Promise<QipMonthScores[]> {
  const res = await fetch(`/api/qip-exception/scores?${new URLSearchParams({ tactId, fromMonth, toMonth }).toString()}`);
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  // A page or proxy answering instead of the scores service is a failure, not "no data".
  if (!Array.isArray(body.months)) throw new Error("The scores service did not answer.");
  return body.months as QipMonthScores[];
}

/** One category's three numbers for one month, as form text ("" when the QA data has none). */
function pickNumbers(m: QipMonthScores | undefined, cat: string): { score: string; instances: string; blunders: string } {
  if (!m) return { score: "", instances: "", blunders: "" };
  const avg = cat === "lead" ? m.leadScoreAvg : m.paymentsAvg;
  const n = cat === "lead" ? m.leadScoreInstances : m.paymentsInstances;
  const b = cat === "lead" ? m.leadScoreBlunders : m.paymentsBlunders;
  if (avg === null && !n) return { score: "", instances: "", blunders: "" };
  return { score: scoreText(avg), instances: n ? String(n) : "", blunders: n ? String(b) : "" };
}

/** Secondary action button: same clipped-corner shape as the main button, with an outline. */
function OutlineBtn({ dark, onClick, disabled, id, children }: { dark: boolean; onClick: () => void; disabled?: boolean; id?: string; children: ReactNode }) {
  return (
    <span id={id} className="inline-flex">
      <ClippedButton
        onClick={onClick}
        disabled={disabled}
        size="lg"
        borderColor={dark ? "rgba(255,255,255,0.30)" : "#a8a29e"}
        hoverBorderColor={dark ? "rgba(255,255,255,0.55)" : "#57534e"}
        style={{ background: dark ? "#0c1e30" : "#ffffff", paddingTop: "clamp(8px, 1.2vh, 12px)", paddingBottom: "clamp(8px, 1.2vh, 12px)" }}
        className={`px-5 text-xs font-mono uppercase font-bold tracking-[0.2em] gap-1.5 ${dark ? "text-slate-100" : "text-stone-800"}`}
      >
        {children}
      </ClippedButton>
    </span>
  );
}

interface FieldCtx {
  inputs: any;
  mutate: (fn: (draft: any) => void) => void;
  inputCls: string;
  labelCls: string;
}
const FieldContext = createContext<FieldCtx | null>(null);

// Defined at module level (not inside QipExceptionPage) so React keeps the same
// element between renders and the focused input is not remounted on every keystroke.
function Field({ label, path, type = "text", inputmode, textarea, hint, narrow }: { label: string; path: string; type?: string; inputmode?: "decimal" | "numeric"; textarea?: boolean; hint?: string; narrow?: boolean }) {
  const ctx = useContext(FieldContext) as FieldCtx;
  const id = "qip_" + path.replace(/[^a-z0-9]/gi, "_");
  const value = getPath(ctx.inputs, path) ?? "";
  const onChange = (v: string) => ctx.mutate((d) => setPath(d, path, v));
  return (
    <div className={`flex flex-col gap-1 ${narrow ? "w-[88px] shrink-0" : ""}`}>
      <label htmlFor={id} className={`${ctx.labelCls} leading-tight`}>{label}</label>
      {textarea ? (
        <textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} className={`${ctx.inputCls} resize-y min-h-[56px]`} />
      ) : (
        <input id={id} type={type} inputMode={inputmode} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} className={ctx.inputCls} />
      )}
      {hint ? <p className="text-[11px] text-content-muted">{hint}</p> : null}
    </div>
  );
}

export function QipExceptionPage({ theme }: QipExceptionPageProps) {
  const dark = theme === "dark";
  const [inputs, setInputs] = useState<any>(freshInputs);
  // The inputs as they were when the document was generated (blank past-month
  // rows and form-only fields removed). The preview and checks use this copy, so
  // editing the form afterwards cannot silently change a document on screen.
  const [docInputs, setDocInputs] = useState<any>(null);
  const [ai, setAi] = useState<AiText>(emptyAi);
  const [view, setView] = useState<"form" | "preview">("form");
  const [busy, setBusy] = useState("");
  const [formErrors, setFormErrors] = useState<{ path: string; msg: string }[]>([]);
  const [aiErrors, setAiErrors] = useState<string[]>([]);
  const [saveNote, setSaveNote] = useState<{ text: string; err: boolean }>({ text: "", err: false });

  // Advisors this person may pick (same scope as Team Tracker).
  const [pickable, setPickable] = useState<PickableAdvisor[]>([]);
  const [pickError, setPickError] = useState("");
  const [pickLoading, setPickLoading] = useState(true);
  // Autofill status line per "advisorId:section" ("qip" | "trend").
  const [afMsg, setAfMsg] = useState<Record<string, string>>({});
  const [refillTick, setRefillTick] = useState(0);

  // One tab per advisor, drawn with the same slanted "file tab" shapes as the
  // insurer tabs on Coverage Projection Assist (shared geometry in
  // src/components/InsurerConfigGeometry.tsx).
  const [activeId, setActiveId] = useState<string>(() => "");
  const tabsShellRef = useRef<HTMLDivElement>(null);
  const tabsRowRef = useRef<HTMLDivElement>(null);
  const tabsPanelRef = useRef<HTMLElement>(null);

  const mutate = (fn: (draft: any) => void) =>
    setInputs((prev: any) => {
      const next = structuredClone(prev);
      fn(next);
      next.advisors.forEach(syncTrend);
      return next;
    });

  const activeAdvisor = inputs.advisors.find((a: any) => a.id === activeId) ?? inputs.advisors[0];
  const tabsGeometry = useInsurerRowGeometry(tabsShellRef, tabsRowRef, tabsPanelRef, `${activeAdvisor?.id}|${inputs.advisors.length}`);

  const addAdvisor = () => {
    const adv = newAdvisor();
    mutate((d) => { d.advisors.push(adv); });
    setActiveId(adv.id);
  };
  const removeAdvisor = (id: string) => {
    const idx = inputs.advisors.findIndex((a: any) => a.id === id);
    const neighbour = inputs.advisors[idx + 1] ?? inputs.advisors[idx - 1];
    mutate((d) => { d.advisors = d.advisors.filter((a: any) => a.id !== id); });
    if (neighbour) setActiveId(neighbour.id);
  };

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (inputs.advisors.some((a: any) => a.name || a.notes)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [inputs]);

  // ---------- advisor list ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/qa-dashboard/team-tracker/context");
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || body?.error) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
        const list: PickableAdvisor[] = (body.advisors || [])
          .map((a: any) => ({ tactId: String(a.tactId).trim(), name: String(a.name).trim() }))
          .filter((a: PickableAdvisor) => a.tactId && a.name)
          .sort((x: PickableAdvisor, y: PickableAdvisor) => x.name.localeCompare(y.name));
        if (!cancelled) setPickable(list);
      } catch (e: any) {
        if (!cancelled) setPickError("Could not load your advisors. Please refresh the page and try again.");
      } finally {
        if (!cancelled) setPickLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- autofill ----------
  // appliedRef remembers which (advisor, category, month selection) was last
  // filled, so a refill happens only when that selection CHANGES — never when
  // the user just edits a number. inflightRef stops duplicate fetches.
  const appliedRef = useRef<Map<string, string>>(new Map());
  const inflightRef = useRef<Set<string>>(new Set());
  // Caches the request itself (not just its result) so two categories asking for the same months share one call.
  const cacheRef = useRef<Map<string, Promise<QipMonthScores[]>>>(new Map());

  const loadScores = (tactId: string, from: string, to: string) => {
    const key = `${tactId}|${from}|${to}`;
    const hit = cacheRef.current.get(key);
    if (hit) return hit;
    const p = fetchScores(tactId, from, to);
    cacheRef.current.set(key, p);
    p.catch(() => cacheRef.current.delete(key));
    return p;
  };

  useEffect(() => {
    for (const a of inputs.advisors) {
      if (!a.tactId) continue;
      const id: string = a.id;
      const tactId: string = a.tactId;

      // QIP Month numbers
      const dataMonth: string = inputs.dataMonth;
      const qipPending = /^\d{4}-\d{2}$/.test(dataMonth)
        ? activeCats(a).filter((k: string) => appliedRef.current.get(`${id}:qip:${k}`) !== `${tactId}|${dataMonth}|${k}` && !inflightRef.current.has(`${id}:qip:${k}:${tactId}|${dataMonth}`))
        : [];
      if (qipPending.length) {
        const flights = qipPending.map((k: string) => `${id}:qip:${k}:${tactId}|${dataMonth}`);
        flights.forEach((f: string) => inflightRef.current.add(f));
        setAfMsg((m) => ({ ...m, [`${id}:qip`]: "Fetching scores…" }));
        loadScores(tactId, dataMonth, dataMonth)
          .then((months) => {
            const row = months.find((x) => x.monthKey === dataMonth);
            const hasAny = qipPending.some((k: string) => {
              const n = pickNumbers(row, k);
              return !!(n.score || n.instances);
            });
            setInputs((prev: any) => {
              const next = structuredClone(prev);
              const adv = next.advisors.find((x: any) => x.id === id);
              if (!adv) return prev;
              for (const k of qipPending) {
                // Skip if the selection moved on while the request was running; the next pass handles it.
                if (adv.tactId !== tactId || next.dataMonth !== dataMonth || !adv.categories[k].on) continue;
                const n = pickNumbers(row, k);
                adv.categories[k].score = n.score;
                adv.categories[k].instances = n.instances;
                adv.categories[k].blunders = n.blunders;
                appliedRef.current.set(`${id}:qip:${k}`, `${tactId}|${dataMonth}|${k}`);
              }
              return next;
            });
            setAfMsg((m) => ({ ...m, [`${id}:qip`]: hasAny ? `Scores filled in for ${monthLabel(dataMonth)}. You can change any of them.` : `No scores found for ${monthLabel(dataMonth)}. You can type them in yourself.` }));
          })
          .catch(() => setAfMsg((m) => ({ ...m, [`${id}:qip`]: "Could not fetch the scores right now. You can type them in yourself, or try “Fetch scores again”." })))
          .finally(() => flights.forEach((f: string) => inflightRef.current.delete(f)));
      }

      // Past months numbers
      const ui = a.trendUi;
      if (ui && ui.from && ui.count) {
        const range = monthRange(ui.from, ui.count);
        const from: string = ui.from;
        const count: number = ui.count;
        const trendPending = range.length
          ? activeCats(a).filter((k: string) => ui.cats[k] && appliedRef.current.get(`${id}:trend:${k}`) !== `${tactId}|${from}|${count}|${k}` && !inflightRef.current.has(`${id}:trend:${k}:${tactId}|${from}|${count}`))
          : [];
        if (trendPending.length) {
          const flights = trendPending.map((k: string) => `${id}:trend:${k}:${tactId}|${from}|${count}`);
          flights.forEach((f: string) => inflightRef.current.add(f));
          setAfMsg((m) => ({ ...m, [`${id}:trend`]: "Fetching scores…" }));
          loadScores(tactId, range[0].key, range[range.length - 1].key)
            .then((months) => {
              const hasAny = trendPending.some((k: string) => range.some((r) => {
                const n = pickNumbers(months.find((x) => x.monthKey === r.key), k);
                return !!(n.score || n.instances);
              }));
              setInputs((prev: any) => {
                const next = structuredClone(prev);
                const adv = next.advisors.find((x: any) => x.id === id);
                if (!adv || adv.tactId !== tactId || !adv.trendUi || adv.trendUi.from !== from || adv.trendUi.count !== count) return prev;
                for (const k of trendPending) {
                  if (!adv.trendUi.cats[k] || !adv.categories[k].on) continue;
                  for (const r of adv.trend) {
                    if (r.category !== k) continue;
                    const n = pickNumbers(months.find((x) => x.monthKey === r.monthKey), k);
                    r.score = n.score;
                    r.instances = n.instances;
                    r.blunders = n.blunders;
                  }
                  appliedRef.current.set(`${id}:trend:${k}`, `${tactId}|${from}|${count}|${k}`);
                }
                return next;
              });
              setAfMsg((m) => ({ ...m, [`${id}:trend`]: hasAny ? "Scores filled in. You can change any of them." : "No scores found for these months. You can type them in yourself." }));
            })
            .catch(() => setAfMsg((m) => ({ ...m, [`${id}:trend`]: "Could not fetch the scores right now. You can type them in yourself, or try “Fetch scores again”." })))
            .finally(() => flights.forEach((f: string) => inflightRef.current.delete(f)));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, refillTick]);

  /** "Reload from QA data" for one section: forget what was applied so the effect above fetches fresh numbers. */
  const refill = (advisorId: string, section: "qip" | "trend") => {
    for (const k of CAT_KEYS) appliedRef.current.delete(`${advisorId}:${section}:${k}`);
    cacheRef.current.clear();
    setRefillTick((t) => t + 1);
  };

  // ---------- styling ----------
  const inputCls = `w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none focus:border-[#117FDA] ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-content-muted";
  const cardCls = `rounded-xl border p-4 space-y-3 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const dangerBtnCls = `text-[11px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg border cursor-pointer inline-flex items-center gap-1.5 ${
    dark ? "border-red-500/30 text-red-300 hover:bg-red-500/10" : "border-red-200 text-red-700 hover:bg-red-50"
  }`;
  const linkBtnCls = `text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-700 hover:text-blue-800"}`;
  const msgCls = (kind: "bad" | "warn" | "ok") =>
    `rounded-lg border p-3 text-[13px] font-semibold ${
      kind === "bad"
        ? dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
        : kind === "warn"
          ? dark ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-800"
          : dark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-800"
    }`;
  const NUM_ROW = "flex flex-wrap items-end gap-x-3 gap-y-3";

  /** A section title that sits on the page itself (outside any card), with an optional action on the right and a note under it. */
  const sectionTitle = (title: string, right?: ReactNode, note?: string) => (
    <div className="space-y-0.5 px-0.5">
      <div className="flex items-end justify-between gap-3">
        <h2 className={`text-[12px] font-black uppercase tracking-[0.14em] ${dark ? "text-slate-200" : "text-stone-700"}`}>{title}</h2>
        {right}
      </div>
      {note ? <p className="text-[11px] text-content-muted">{note}</p> : null}
    </div>
  );

  // ---------- form ----------
  const categoryCard = (a: any, i: number, k: string) => {
    const p = `advisors.${i}.categories.${k}`;
    const c = a.categories[k];
    const pct = blunderPctHundredths(parseCount(c.blunders), parseCount(c.instances));
    return (
      <div key={k} className={`${cardCls} w-max max-w-full`} data-cat-section={k}>
        <div className={NUM_ROW}>
          <Field narrow label={FORM_CAT[k]} path={`${p}.score`} inputmode="decimal" />
          <Field narrow label="Instances" path={`${p}.instances`} inputmode="numeric" />
          <Field narrow label="Blunders" path={`${p}.blunders`} inputmode="numeric" />
          <div className="flex flex-col gap-1 min-w-[112px]">
            <span className={`${labelCls} leading-tight`}>Blunder %</span>
            <span className="text-[13px] font-bold py-1.5">{pct === null ? "–" : `${fmtPct(pct)} (${c.blunders}/${c.instances})`}</span>
          </div>
        </div>
        {k === "lead" ? (
          <div className={NUM_ROW}>
            <Field narrow label="Chat score" path={`${p}.chatScore`} inputmode="decimal" />
            <Field narrow label="Chat inst." path={`${p}.chatInstances`} inputmode="numeric" />
            <Field narrow label="Call score" path={`${p}.callScore`} inputmode="decimal" />
            <Field narrow label="Call inst." path={`${p}.callInstances`} inputmode="numeric" />
          </div>
        ) : null}
        <div className={NUM_ROW}>
          <Field narrow label="Current score" path={`${p}.currentScore`} inputmode="decimal" />
          <Field narrow label="Current inst." path={`${p}.currentInstances`} inputmode="numeric" />
        </div>
      </div>
    );
  };

  const selectField = (id: string, label: string, value: string, onChange: (v: string) => void, options: [string, string][]) => (
    <div key={id} className="flex flex-col gap-1 min-w-[128px]">
      <label htmlFor={id} className={labelCls}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </div>
  );

  const trendCard = (a: any, i: number) => {
    const ui = a.trendUi || newTrendUi();
    const avail = activeCats(a);
    const { cats, range } = syncTrend(structuredClone(a));
    return (
      <div className={cardCls} data-trend-section={i}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {selectField(`trendCount_${i}`, "How many months?", String(ui.count), (v) => mutate((d) => { d.advisors[i].trendUi.count = Number(v); }), [["0", "None"], ...Array.from({ length: 12 }, (_, n) => [String(n + 1), String(n + 1)] as [string, string])])}
          {ui.count ? (
            <div className="flex flex-col gap-1 min-w-[150px]">
              <label htmlFor={`trendFrom_${i}`} className={labelCls}>From</label>
              <input id={`trendFrom_${i}`} type="month" value={ui.from} onChange={(e) => mutate((d) => { d.advisors[i].trendUi.from = e.target.value; })} className={inputCls} />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Categories</span>
            {avail.length ? (
              <div className="flex gap-4 py-1.5">
                {avail.map((k: string) => (
                  <label key={k} className="flex items-center gap-1.5 text-[12px] font-bold cursor-pointer">
                    <input type="checkbox" data-trend-cat-pick={k} checked={!!ui.cats[k]} onChange={(e) => mutate((d) => { d.advisors[i].trendUi.cats[k] = e.target.checked; })} />
                    {FORM_CAT[k]}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-content-muted py-1.5">Tick a score type in Advisor details first.</p>
            )}
          </div>
        </div>
        {ui.count && !ui.from ? <p className="text-[12px] text-content-muted">Choose the first month and the rest will follow.</p> : null}
        {ui.count && ui.from && !cats.length && avail.length ? <p className="text-[12px] text-content-muted">Tick at least one score type above.</p> : null}
        {range.length && cats.length ? (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(310px,max-content))]">
            {range.map((m, s) => (
              <div key={s} className={`rounded-lg border p-3 space-y-2 ${dark ? "border-white/[0.08]" : "border-stone-200"}`} data-month-slot={s}>
                <h4 className="text-[12px] font-black">{m.name} <span className="font-semibold text-content-muted">{m.key.slice(0, 4)}</span></h4>
                {cats.map((k: string) => {
                  const j = a.trend.findIndex((r: any) => r.slot === s && r.category === k);
                  const p = `advisors.${i}.trend.${j}`;
                  return (
                    <div key={k} data-trend={j} data-trend-cat={k}>
                      <div className="flex items-end gap-3">
                        <Field narrow label={FORM_CAT[k]} path={`${p}.score`} inputmode="decimal" />
                        <Field narrow label="Instances" path={`${p}.instances`} inputmode="numeric" />
                        <Field narrow label="Blunders" path={`${p}.blunders`} inputmode="numeric" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const blunderCard = (a: any, i: number) => (
    <div className={cardCls}>
      {a.blunderRows.map((_: any, j: number) => (
        <div key={j} className="grid gap-3 items-end [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]" data-blunder={j}>
          <Field label="Date of marking" path={`advisors.${i}.blunderRows.${j}.date`} type="date" />
          <Field label="Chat ID" path={`advisors.${i}.blunderRows.${j}.chatId`} />
          <Field label="Severity" path={`advisors.${i}.blunderRows.${j}.severity`} />
          <Field label="Marking" path={`advisors.${i}.blunderRows.${j}.marking`} />
          <Field label="Comment" path={`advisors.${i}.blunderRows.${j}.comment`} />
          <div>
            <button type="button" className={dangerBtnCls} onClick={() => mutate((d) => { d.advisors[i].blunderRows.splice(j, 1); })}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        </div>
      ))}
      <OutlineBtn dark={dark} onClick={() => mutate((d) => { d.advisors[i].blunderRows.push({ date: "", chatId: "", severity: "", marking: "", comment: "" }); })}>
        <Plus className="w-3.5 h-3.5" /> Add a row
      </OutlineBtn>
    </div>
  );

  const advisorBlock = (a: any, i: number) => {
    const cats = activeCats(a);
    const p = `advisors.${i}`;
    const taken = new Set(inputs.advisors.filter((x: any) => x.id !== a.id).map((x: any) => x.tactId));
    const options = pickable.filter((x) => !taken.has(x.tactId)).map((x) => ({ value: x.tactId, label: x.name }));
    const qipMsg = afMsg[`${a.id}:qip`];
    const trendMsg = afMsg[`${a.id}:trend`];
    return (
      <section key={a.id} className="space-y-4" data-advisor={i}>
        {inputs.advisors.length > 1 ? (
          <div className="flex justify-end">
            <button type="button" className={dangerBtnCls} onClick={() => removeAdvisor(a.id)}>
              <Trash2 className="w-3.5 h-3.5" /> Remove this advisor
            </button>
          </div>
        ) : null}

        <div className="space-y-1.5">
          {sectionTitle("Advisor details")}
          <div className={cardCls}>
            <div className="grid gap-x-5 gap-y-3 items-end [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
              <div className="flex flex-col gap-1" data-advisor-picker>
                <span className={labelCls}>Advisor</span>
                {pickError ? (
                  <p className={`text-[12px] font-semibold ${dark ? "text-red-300" : "text-red-700"}`}>{pickError}</p>
                ) : (
                  <CustomSelect
                    theme={theme}
                    searchable
                    searchPlaceholder="Search advisors…"
                    value={a.tactId}
                    placeholder={pickLoading ? "Loading advisors…" : "Search and pick an advisor"}
                    options={options}
                    onChange={(tactId) => {
                      const hit = pickable.find((x) => x.tactId === tactId);
                      mutate((d) => {
                        d.advisors[i].tactId = tactId;
                        d.advisors[i].name = hit ? hit.name : "";
                      });
                    }}
                  />
                )}
              </div>
              <Field label="Evaluation start date (optional)" path={`${p}.evalStartDate`} type="date" />
              <div className="flex flex-col gap-1">
                <span className={labelCls}>Pronoun</span>
                <div className="flex gap-4 py-1.5">
                  {(["he", "she"] as const).map((v) => (
                    <label key={v} className="flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer">
                      <input type="radio" name={`pron_${i}`} value={v} checked={a.pronoun === v} onChange={() => mutate((d) => { d.advisors[i].pronoun = v; })} />
                      {v === "he" ? "He" : "She"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className={labelCls}>Scores to include (select one or both)</span>
                <div className="flex gap-4 py-1.5">
                  {CAT_KEYS.map((k) => (
                    <label key={k} className="flex items-center gap-1.5 text-[12px] font-bold cursor-pointer">
                      <input type="checkbox" data-cat={k} checked={a.categories[k].on} onChange={(e) => mutate((d) => { d.advisors[i].categories[k].on = e.target.checked; })} />
                      {FORM_CAT[k]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          {sectionTitle(
            `QIP Month scores${monthLabel(inputs.dataMonth) ? ` – ${monthLabel(inputs.dataMonth)}` : ""}`,
            a.tactId && cats.length ? <button type="button" className={linkBtnCls} onClick={() => refill(a.id, "qip")}><RefreshCw className="w-3 h-3" /> Fetch scores again</button> : null,
            qipMsg || (a.tactId ? "Scores fill in automatically for the QIP Month you pick. You can change any of them." : "Pick an advisor and the QIP Month, and their scores will fill in automatically.")
          )}
          {cats.length ? (
            <div className="flex flex-wrap gap-3 items-start">{cats.map((k: string) => categoryCard(a, i, k))}</div>
          ) : (
            <div className={cardCls}><p className="text-[12px] text-content-muted">Tick Lead Score and/or Payments QA above to enter the scores.</p></div>
          )}
        </div>

        <div className="space-y-1.5">
          {sectionTitle("Special Notes")}
          <div className={cardCls}>
            <Field label="Special Notes (Reason, Situation, or Instructions)" path={`${p}.notes`} textarea hint="Anything we should know or mention about this advisor. Optional." />
          </div>
        </div>

        <div className="space-y-1.5">
          {sectionTitle(
            "Past performance trend",
            a.tactId && a.trendUi?.from && a.trendUi?.count ? <button type="button" className={linkBtnCls} onClick={() => refill(a.id, "trend")}><RefreshCw className="w-3 h-3" /> Fetch scores again</button> : null,
            trendMsg || "Optional. Choose how many earlier months to show and the first month. The scores fill in automatically and you can change them."
          )}
          {trendCard(a, i)}
        </div>

        <div className="space-y-1.5">
          {sectionTitle("Feedback Specifics")}
          {blunderCard(a, i)}
        </div>
      </section>
    );
  };

  // ---------- generate ----------
  async function generate(useAi: boolean) {
    setAiErrors([]);
    setSaveNote({ text: "", err: false });
    // Document copy: blank past-month rows dropped, and the form-only fields
    // (trendUi, slot, monthKey, tactId) removed so they can never count as
    // "numbers you entered" in the written-text number check.
    const cleaned = structuredClone(inputs);
    cleaned.advisors.forEach((a: any) => {
      a.trend = (a.trend || [])
        .filter((r: any) => !(isBlank(r.score) && isBlank(r.instances) && isBlank(r.blunders)))
        .map(({ slot: _slot, monthKey: _monthKey, ...rest }: any) => rest);
      delete a.trendUi;
      delete a.tactId;
    });
    const errs = validate(cleaned);
    setFormErrors(errs);
    if (errs.length) {
      setTimeout(() => document.getElementById("qipFormErrors")?.scrollIntoView({ block: "center" }), 0);
      return;
    }
    const nextAi = emptyAi();
    cleaned.advisors.forEach((a: any) => {
      nextAi.advisors[a.id] = { overview: [], lead: [], pay: [] };
    });
    const errors: string[] = [];
    if (useAi) {
      const advisors = cleaned.advisors;
      const total = advisors.length + 1;
      let done = 0;
      const progress = () => setBusy(`Writing your document… ${done} of ${total} sections done. This can take a minute.`);
      setBusy("Writing your document… this can take a minute.");
      const wrap = (p: Promise<void>, label: string) =>
        p.catch((e: any) => { errors.push(`${label}: ${e.message || "could not be written"}`); }).finally(() => { done++; progress(); });
      // Background and Conclusion first: if the service is not set up or not allowed for this user, stop before sending more.
      await wrap(
        writeText("shared", buildSharedFacts(cleaned)).then((r) => { nextAi.background = r.background || []; nextAi.conclusion = r.conclusion || []; }),
        "Background and Conclusion"
      );
      if (!errors.some((m) => /not available right now|only available/i.test(m))) {
        await Promise.all(
          advisors.map((a: any) =>
            wrap(
              writeText("advisor", buildAdvisorFacts(cleaned, a)).then((r) => { nextAi.advisors[a.id] = { overview: r.overview || [], lead: r.lead || [], pay: r.pay || [] }; }),
              a.name.trim()
            )
          )
        );
      }
      setBusy("");
      setAiErrors(errors);
      if (errors.length >= total || errors.some((m) => /not available right now|only available/i.test(m))) return; // nothing usable: stay on the form
    }
    setDocInputs(cleaned);
    setAi(nextAi);
    setView("preview");
  }

  // ---------- preview ----------
  const model = useMemo(() => (docInputs ? buildDocument(docInputs, ai) : null), [docInputs, ai]);
  const checks = useMemo(() => (docInputs && model ? checkOutput(docInputs, model) : null), [docInputs, model]);

  function applyAiEdit(key: string, text: string) {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    setAi((prev) => {
      const next: AiText = { ...prev, advisors: { ...prev.advisors } };
      if (key === aiKey.background) next.background = lines;
      else if (key === aiKey.conclusion) next.conclusion = lines;
      else {
        const m = /^adv:([^:]+):(.+)$/.exec(key);
        if (m) next.advisors[m[1]] = { ...(next.advisors[m[1]] || { overview: [], lead: [], pay: [] }), [m[2]]: lines };
      }
      return next;
    });
  }

  async function download() {
    if (!docInputs || !model) return;
    const r = checkOutput(docInputs, model);
    if (r.errors.length) return; // double-check at the moment of export
    try {
      const { docxBlob } = await import("../qipException/docx");
      const blob = await docxBlob(model);
      const names = docInputs.advisors.map((a: any) => a.name.trim());
      const base = names.length === 1 ? `QIP Exception Request - ${names[0]} - ${fmtMonthYear(docInputs.requestMonth)}` : `QIP Exception Request - ${fmtMonthYear(docInputs.requestMonth)}`;
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = safeName(base) + ".docx";
      document.body.append(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setSaveNote({ text: "Your document has been downloaded.", err: false });
    } catch {
      setSaveNote({ text: "Sorry, the document could not be created. Please try again.", err: true });
    }
  }

  const textOf = (items: { runs: { text: string }[] }[]) => items.map((it) => it.runs.map((r) => r.text).join("")).join("\n\n");

  const renderBlock = (b: any, idx: number): ReactNode => {
    switch (b.type) {
      case "title":
        return <h2 key={idx} className="text-[20px] font-black tracking-tight">{b.text}</h2>;
      case "heading":
        return <h3 key={idx} className="text-[16px] font-black pt-3">{b.text}</h3>;
      case "para":
        return (
          <p key={idx} className={`text-[13px] leading-relaxed ${b.indent ? "pl-4" : ""}`}>
            {b.runs.map((r: any, n: number) => (r.bold ? <strong key={n}>{r.text}</strong> : <span key={n}>{r.text}</span>))}
          </p>
        );
      case "bullets":
        return b.items.length ? (
          <ul key={idx} className="list-disc pl-6 text-[13px] space-y-0.5">
            {b.items.map((it: any, n: number) => <li key={n}>{it.runs.map((r: any) => r.text).join("")}</li>)}
          </ul>
        ) : null;
      case "table":
        return (
          <div key={idx} className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>
                  {b.headers.map((x: string) => (
                    <th key={x} className={`text-left font-bold px-2.5 py-1.5 border ${dark ? "border-white/[0.12] bg-white/[0.05]" : "border-stone-300 bg-stone-100"}`}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r: string[], n: number) => (
                  <tr key={n}>
                    {r.map((c, m) => <td key={m} className={`px-2.5 py-1.5 border ${dark ? "border-white/[0.12]" : "border-stone-300"}`}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  };

  // ---------- render ----------
  const Title = (
    <div>
      <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
        <FileText className="w-5 h-5" />
        <span>QIP Exception Request</span>
      </h1>
      <p className="text-[13px] mt-1 font-semibold text-content-muted">Helps you create a QIP exception request document for your advisors, based on the details you enter.</p>
    </div>
  );

  if (view === "preview" && model && checks) {
    return (
      <div className="space-y-5 pb-6">
        {Title}
        <p className="text-[12px] font-semibold text-content-muted">The headings, tables and numbers are set automatically. You can edit only the written paragraphs below. To change anything else, go back and edit the details.</p>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <div className={`${cardCls} min-w-0`} id="qipDocPreview">
            {model.blocks.map((b: any, idx: number) => {
              if (b.ai) {
                const key = b.ai as string;
                return (
                  <div key={key} className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#117FDA]">Written paragraph – you can edit this</div>
                    <textarea rows={5} data-ai={key} value={textOf(b.items)} onChange={(e) => applyAiEdit(key, e.target.value)} className={`${inputCls} resize-y`} />
                  </div>
                );
              }
              return renderBlock(b, idx);
            })}
          </div>
          <aside className="space-y-4 xl:sticky xl:top-4">
            <div className="space-y-2" id="qipChecks">
              {checks.errors.length ? (
                <div className={msgCls("bad")} role="alert">Fix before downloading:<ul className="list-disc pl-5 font-medium mt-1">{checks.errors.map((m: string, n: number) => <li key={n}>{m}</li>)}</ul></div>
              ) : null}
              {checks.warnings.length ? (
                <div className={msgCls("warn")}>Please check:<ul className="list-disc pl-5 font-medium mt-1">{checks.warnings.map((m: string, n: number) => <li key={n}>{m}</li>)}</ul></div>
              ) : null}
              {checks.passed.length ? (
                <div className={msgCls("ok")}>Checks passed:<ul className="list-disc pl-5 font-medium mt-1">{checks.passed.map((m: string, n: number) => <li key={n}>{m}</li>)}</ul></div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <OutlineBtn dark={dark} id="qipBack" onClick={() => setView("form")}>
                <ArrowLeft className="w-3.5 h-3.5" /> Back to edit
              </OutlineBtn>
              <OutlineBtn dark={dark} id="qipRegen" disabled={!!busy} onClick={() => generate(true)}>
                <RefreshCw className="w-3.5 h-3.5" /> Write again
              </OutlineBtn>
              <PrimaryCtaButton theme={theme} id="qipDownload" disabled={checks.errors.length > 0} onClick={download}>
                <span className="inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Download document</span>
              </PrimaryCtaButton>
            </div>
            {busy ? <p className="text-[12px] font-semibold text-content-muted">{busy}</p> : null}
            {saveNote.text ? <p className={`text-[12px] font-semibold ${saveNote.err ? (dark ? "text-red-300" : "text-red-700") : "text-content-muted"}`}>{saveNote.text}</p> : null}
          </aside>
        </div>
      </div>
    );
  }

  const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
  const activeIdx = Math.max(0, inputs.advisors.findIndex((a: any) => a.id === activeAdvisor?.id));
  const tabButtonStyle = { position: "relative", flex: "0 1 190px", minWidth: 96, height: TAB_HEIGHT, paddingLeft: TAB_PADDING_X, paddingRight: TAB_PADDING_X, background: "transparent", border: "none" } as const;
  const advisorTabs = (
    <div ref={tabsShellRef} className="relative">
      <div ref={tabsRowRef} role="tablist" aria-label="Advisors" style={{ position: "relative", zIndex: 10, display: "flex", flexWrap: "nowrap", alignItems: "flex-start", gap: 8 }}>
        {inputs.advisors.map((a: any, i: number) => {
          const active = i === activeIdx;
          const label = a.name.trim() || `Advisor ${i + 1}`;
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-advisor-tab={i}
              onClick={() => setActiveId(a.id)}
              style={tabButtonStyle}
              className={`text-xs font-bold cursor-pointer transition-colors duration-150 ${active ? (dark ? "text-white" : "text-stone-900") : dark ? "text-slate-300 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
            >
              <span className="relative flex items-center justify-center h-full min-w-0" style={{ gap: TAB_CONTENT_GAP }}>
                <span
                  className={`shrink-0 rounded-full flex items-center justify-center text-[11px] font-black ${dark ? "bg-white/10 text-slate-100" : "bg-[var(--accent-subtle-bg)] text-stone-700"}`}
                  style={{ width: TAB_LOGO_SIZE, height: TAB_LOGO_SIZE }}
                >
                  {initials(a.name) || <User className="w-4 h-4" />}
                </span>
                <span className="truncate" style={{ minWidth: 0 }}>{label}</span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={false}
          id="qipAddAdvisor"
          onClick={addAdvisor}
          style={{ ...tabButtonStyle, flex: "0 1 170px" }}
          className={`text-xs font-bold cursor-pointer transition-colors duration-150 ${dark ? "text-slate-300 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
        >
          <span className="relative flex items-center justify-center h-full" style={{ gap: 8 }}>
            <Plus className="w-4 h-4 shrink-0" />
            <span className="truncate">Add advisor</span>
          </span>
        </button>
      </div>

      <section
        ref={tabsPanelRef}
        role="tabpanel"
        className={`relative p-5 space-y-5 ${dark ? "bg-white/[0.03]" : "bg-white shadow-card"}`}
        style={{ marginTop: 0, borderRadius: PANEL_RADIUS }}
      >
        {activeAdvisor ? advisorBlock(activeAdvisor, activeIdx) : null}
      </section>

      {tabsGeometry && tabsGeometry.tabs[activeIdx] ? (
        <svg
          aria-hidden="true"
          focusable="false"
          style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }}
          viewBox={`0 0 ${tabsGeometry.width} ${TAB_HEIGHT + tabsGeometry.panelHeight}`}
        >
          {tabsGeometry.tabs.map((rect, idx) =>
            idx === activeIdx ? null : (
              <path
                key={idx}
                d={getTabPath(rect.x, rect.width, TAB_HEIGHT, false)}
                fill={dark ? "rgba(255,255,255,0.05)" : "var(--surface)"}
                stroke={dark ? "rgba(255,255,255,0.1)" : "var(--border)"}
                strokeWidth={STROKE_WIDTH}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          )}
          <path
            d={getTabPath(tabsGeometry.tabs[activeIdx].x, tabsGeometry.tabs[activeIdx].width, TAB_HEIGHT, true)}
            fill={dark ? "#142D42" : "var(--accent-subtle-bg)"}
            stroke={dark ? "#00D3F3" : "var(--accent)"}
            strokeWidth={STROKE_WIDTH}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            transform={`translate(0, ${TAB_HEIGHT})`}
            d={getPanelPath(tabsGeometry.width, tabsGeometry.panelHeight, tabsGeometry.tabs[activeIdx].x, tabsGeometry.tabs[activeIdx].width, PANEL_RADIUS)}
            fill="none"
            stroke={dark ? "#00D3F3" : "var(--accent)"}
            strokeWidth={STROKE_WIDTH}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );

  return (
    <FieldContext.Provider value={{ inputs, mutate, inputCls, labelCls }}>
      <div className="space-y-5 pb-6">
        {Title}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-6 items-start">
          <div className="min-w-0 order-2 xl:order-1">{advisorTabs}</div>
          <aside className="space-y-5 xl:sticky xl:top-4 order-1 xl:order-2">
            <div className="space-y-1.5">
              {sectionTitle("Request details")}
              <div className={cardCls}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Request month" path="requestMonth" type="month" />
                  <Field label="QIP Month" path="dataMonth" type="month" />
                  <Field label="QA benchmark" path="benchmark" inputmode="decimal" />
                  <Field label="Blunder % limit" path="limit" inputmode="decimal" />
                </div>
                <p className="text-[11px] text-content-muted">Blunder % is worked out for you. Changing the QIP Month fetches each advisor&apos;s scores for that month again.</p>
              </div>
            </div>
            <div id="qipFormErrors">
              {formErrors.length ? (
                <div className={msgCls("bad")} role="alert">Please fix these first:<ul className="list-disc pl-5 font-medium mt-1">{formErrors.map((e, n) => <li key={n}>{e.msg}</li>)}</ul></div>
              ) : null}
            </div>
            {aiErrors.length ? (
              <div className={msgCls("warn")}>Some parts could not be written. You can try again, or choose Create manually:<ul className="list-disc pl-5 font-medium mt-1">{aiErrors.map((m, n) => <li key={n}>{m}</li>)}</ul></div>
            ) : null}
            <div className="space-y-1.5">
              {sectionTitle("Create the document")}
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryCtaButton theme={theme} id="qipGenAi" disabled={!!busy} onClick={() => generate(true)}>Generate</PrimaryCtaButton>
                <OutlineBtn dark={dark} id="qipGenManual" disabled={!!busy} onClick={() => generate(false)}>Create manually</OutlineBtn>
              </div>
              {busy ? <p className="text-[12px] font-semibold text-content-muted" id="qipStatus">{busy}</p> : null}
              <p className="text-[11px] text-content-muted">Generate writes the written parts of the document for you: the Background, a short note on each advisor, and the Conclusion. To do this, the details you entered are shared with an AI writing service. Prefer to write them yourself? Choose Create manually. Nothing you enter is saved.</p>
            </div>
          </aside>
        </div>
      </div>
    </FieldContext.Provider>
  );
}
