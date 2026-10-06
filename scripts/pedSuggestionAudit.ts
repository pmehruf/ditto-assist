/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declaration Assist SUGGESTION cleanup, PHASE 1 (revised): strictly READ-ONLY. Reads a captured copy of the mapping tables
 * (the file written by `npm run mapping:snapshot`), never a database, and writes review files. It changes nothing.
 *
 *   npx tsx scripts/pedSuggestionAudit.ts --snapshot <snapshot.json.gz> --out <dir> [--usage <usage.json>]
 *
 * Scope: only what an advisor sees in the suggestion list while typing in Declaration Assist. That list is every VISIBLE alias
 * (`GET /api/ped-repository/autocomplete`, server.ts). The only change this audit ever proposes is turning a name's
 * `is_visible` off. The routing engine does not read `is_visible` (src/server/mappingSnapshot.ts builds the alias map from every
 * alias row), so a hidden name keeps resolving to exactly the same result as today. No merge, no category change, no plan
 * mapping change, no deletion.
 *
 * Tier A  obvious wording variants of a name that stays visible (plural, hyphen, spacing, accent, British/American spelling,
 *         generic trailing word). Within one condition, or across two conditions only when the wording is identical AND both
 *         conditions have the same category AND give the same answer on every plan (a guard, never the proof).
 * Tier B  other names on a condition that already has a main name (different wording of the same condition). Needs approval.
 * Non-medical  names the app already treats as "not a condition" (habits, normal life stages) and names whose condition no
 *         longer exists. src/App.tsx lists lifestyle and natural_life_stage as "never selectable suggestions".
 * Review  everything else that looks similar. Left untouched.
 */

import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { snapshotFromDump, type MappingDump } from "../src/mapping/seedBuilder.js";
import { newEngineOutcome, planConfigsFromDump, primaryKey } from "../src/mapping/equalityHarness.js";
import type { MappingSnapshot } from "../src/mapping/ruleTypes.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapPath = arg("snapshot");
const outDir = arg("out");
const usagePath = arg("usage");
if (!snapPath || !outDir) {
  console.error("Usage: --snapshot <file.json.gz> --out <dir> [--usage <usage.json>]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

interface Ped { id: number; pedCode: string; canonicalName: string; categoryKey: string | null; status: string }
interface Alias { id: number; pedId: number; aliasText: string; normalizedAlias: string; isPrimary: boolean; isVisible: boolean }
const raw = JSON.parse(gunzipSync(readFileSync(snapPath)).toString()) as { meta: { capturedAt: string; environment: string }; data: MappingDump };
const dump = raw.data as unknown as MappingDump & { pedRepository: Ped[]; pedAliases: Alias[] };
const usage: Record<string, number> = usagePath ? JSON.parse(readFileSync(usagePath, "utf8")) : {};
const peds = dump.pedRepository as unknown as Ped[];
const aliases = dump.pedAliases as unknown as Alias[];
const pedById = new Map(peds.map((p) => [p.id, p]));
const aliasesByPed = new Map<number, Alias[]>();
for (const a of aliases) aliasesByPed.set(a.pedId, [...(aliasesByPed.get(a.pedId) ?? []), a]);

// ── the real engine, with aliases built the way the live loader builds them ───────────────────────
const base = snapshotFromDump(dump);
const snapshot: MappingSnapshot = {
  ...base,
  aliases: new Map(aliases.map((a) => [a.normalizedAlias, { pedId: a.pedId, pedCategory: pedById.get(a.pedId)?.categoryKey ?? null, routingEnabled: true, categoryOverride: null, fallbackCategory: null }] as const)),
};
const plans = planConfigsFromDump(dump);
const planNames = plans.map((p) => p.planName);
const cache = new Map<string, string[]>();
const answers = (text: string): string[] => {
  let v = cache.get(text);
  if (!v) { v = plans.map(({ planName, config }) => primaryKey(newEngineOutcome(text, planName, config, snapshot))); cache.set(text, v); }
  return v;
};
const differing = (a: string[], b: string[]) => planNames.filter((_, i) => a[i] !== b[i]);
const mainNameOf = (ped: Ped): Alias | undefined => (aliasesByPed.get(ped.id) ?? []).find((x) => x.isPrimary) ?? (aliasesByPed.get(ped.id) ?? [])[0];
const pedAnswers = (ped: Ped): string[] => answers(mainNameOf(ped)?.aliasText ?? ped.canonicalName);

// ── wording keys ──────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(["condition", "conditions", "disease", "diseases", "disorder", "disorders", "syndrome", "problem", "problems", "issue", "issues", "history", "of", "the", "and", "with", "in", "on", "due", "to", "after", "post", "status"]);
const stem = (w: string): string => {
  let s = w;
  if (s.length > 5 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else for (const suf of ["ation", "ing", "ion", "ed", "es", "s", "ic", "al", "ia"]) if (s.length > suf.length + 3 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  if (s.length > 4 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
};
const clean = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/'s\b/g, "").replace(/ae/g, "e").replace(/oe/g, "e").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (t: string) => clean(t).split(" ").filter((w) => w && !STOP.has(w)).map(stem);
const k1 = (t: string) => [...tokens(t)].sort().join(" ");
const k2 = (t: string) => tokens(t).join("");
const sameWording = (a: string, b: string) => !!tokens(a).length && (k1(a) === k1(b) || k2(a) === k2(b));
const abbreviation = (t: string) => /^[A-Z0-9][A-Z0-9 .\-/&]{1,7}$/.test(t.trim()) && t.trim() === t.trim().toUpperCase();
const ACTION_WORD = /\b(removal|surgery|evaluation|state|episode|treated|untreated|screening|history)\s*$/i;
const looksClean = (t: string) => !ACTION_WORD.test(t) && t.trim() === t && !/\s{2,}/.test(t) && /^[A-Z0-9]/.test(t);

// ── what advisors see now ─────────────────────────────────────────────────────────────────────────
const visibleAll = aliases.filter((a) => a.isVisible);
const visible = visibleAll.filter((a) => pedById.has(a.pedId));
const searches = (a: Alias): number | string => usage[a.normalizedAlias] ?? "";

interface Decision { alias: Alias; tier: string; action: string; reason: string; group: number; keep?: string; flag?: string }
const decisions = new Map<number, Decision>();
const review: Array<Record<string, unknown>> = [];
let gid = 0;
const csv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
};
const info = (a: Alias) => { const p = pedById.get(a.pedId); return { Name: a.aliasText, "Alias id": a.id, "PED code": p?.pedCode ?? "(deleted condition)", "Official name": p?.canonicalName ?? "", Category: p?.categoryKey ?? (p ? "(none)" : ""), "Searches, last 90 days": searches(a) }; };

const lev = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
};
// 1. Non-medical suggestions (the app's own rule: habits and normal life stages are never suggestions)
const NON_SUGGESTIBLE = new Set(["lifestyle", "natural_life_stage"]);
const nonMedical: Array<Record<string, unknown>> = [];
const nonMedicalIds = new Set<number>();
const engineQuirk: Array<Record<string, unknown>> = [];
for (const a of visibleAll) {
  const p = pedById.get(a.pedId);
  const ans = answers(a.aliasText);
  const notACondition = ans.every((x) => x.split("|")[1] === "NON_AILMENT");
  let why = "";
  if (p && !(p.categoryKey && NON_SUGGESTIBLE.has(p.categoryKey)) && notACondition) engineQuirk.push({ Why: "The engine answers 'not a condition' on every plan, but the condition is not in a non-medical category. Left visible. It may be a real condition the engine mis-reads (for example a word like 'normal').", Action: "Leave visible (untouched); review", ...info(a) });
  if (!p) why = "Its condition was deleted; today it goes to the AI step";
  else if (p.categoryKey && NON_SUGGESTIBLE.has(p.categoryKey)) why = `Category "${p.categoryKey}": the app already lists lifestyle and normal life stages as "never suggestions" (src/App.tsx)`;
  if (!why) continue;
  nonMedicalIds.add(a.id);
  nonMedical.push({ Action: "Hide from suggestions (keeps matching)", Why: why, ...info(a), "Answer today": ans.map((x, i) => `${planNames[i]}: ${x.split("|")[1] === "1" ? x.split("|")[2]?.slice(0, 30) : x.split("|")[1] === "NON_AILMENT" ? "Not a condition" : "AI step"}`).join(" ; ").slice(0, 150) });
}

// 2. Tier A across conditions: identical wording on two different conditions
const byKey = new Map<string, Alias[]>();
for (const a of visible) {
  if (nonMedicalIds.has(a.id) || !tokens(a.aliasText).length) continue;
  for (const key of new Set([`1:${k1(a.aliasText)}`, `2:${k2(a.aliasText)}`])) byKey.set(key, [...(byKey.get(key) ?? []), a]);
}
const handledBuckets = new Set<string>();
const directCount = (a: Alias) => answers(a.aliasText).filter((x) => x.split("|")[1] === "P0").length;
const rank = (a: Alias) => { const p = pedById.get(a.pedId)!; return [p.status === "approved" ? 0 : 1, p.categoryKey ? 0 : 1, a.isPrimary ? 0 : 1, -directCount(a), looksClean(a.aliasText) ? 0 : 1, -(aliasesByPed.get(p.id)?.length ?? 0), p.id]; };
const cmp = (x: number[], y: number[]) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
for (const list of byKey.values()) {
  const pedIds = new Set(list.map((a) => a.pedId));
  if (pedIds.size < 2) continue;
  const sigKey = [...pedIds].sort().join(",");
  if (handledBuckets.has(sigKey)) continue;
  handledBuckets.add(sigKey);
  gid++;
  const ps = [...pedIds].map((id) => pedById.get(id)!);
  const sameCat = new Set(ps.map((p) => p.categoryKey ?? "(none)")).size === 1;
  const ans0 = pedAnswers(ps[0]);
  const sameAns = ps.every((p) => differing(ans0, pedAnswers(p)).length === 0);
  const names = list.filter((a) => a.isPrimary).length ? list.filter((a) => a.isPrimary) : list;
  // Same wording, different category or label, but the SAME question on every plan (only the result label can differ, for example
  // Direct match on one plan versus Category match). Hiding one cannot change what an advisor is told; proposed as Tier C.
  const questionOf = (p: Ped) => pedAnswers(p).map((x) => x.split("|")[2] ?? "");
  const q0 = questionOf(ps[0]);
  const sameQuestions = ps.every((p) => questionOf(p).every((q, i) => q === q0[i]));
  if (sameCat && sameAns) {
    const keeper = [...names].sort((x, y) => cmp(rank(x), rank(y)))[0];
    for (const a of list) {
      if (a.pedId === keeper.pedId) continue;
      if (a.isPrimary || list.some((o) => o.pedId === a.pedId && o.isPrimary)) decisions.set(a.id, { alias: a, tier: "A", action: "Hide", reason: `Same wording as "${keeper.aliasText}" (another condition with the same category and the same answer on every plan)`, group: gid, keep: keeper.aliasText });
    }
  } else if (sameQuestions) {
    const keeper = [...names].sort((x, y) => cmp(rank(x), rank(y)))[0];
    for (const a of list) {
      if (a.pedId === keeper.pedId) continue;
      if (a.isPrimary || list.some((o) => o.pedId === a.pedId && o.isPrimary)) decisions.set(a.id, { alias: a, tier: "C", action: "Hide", reason: `Same wording as "${keeper.aliasText}"; the question is identical on every plan (only the result label can differ: ${[...new Set(ps.flatMap((p) => differing(ans0, pedAnswers(p))))].join(", ") || "category"})`, group: gid, keep: keeper.aliasText });
    }
  } else {
    for (const a of list) review.push({ Group: gid, Why: `Same wording, but the conditions differ: ${!sameCat ? "category differs" : ""}${!sameCat && !sameAns ? "; " : ""}${!sameAns ? `answers differ on ${[...new Set(ps.flatMap((p) => differing(ans0, pedAnswers(p))))].join(", ")}` : ""}`, Action: "Leave both visible (untouched)", ...info(a) });
  }
}

// 3. Within one condition: wording variants (Tier A) and other names (Tier B)
for (const ped of peds) {
  const vis = (aliasesByPed.get(ped.id) ?? []).filter((a) => a.isVisible && !nonMedicalIds.has(a.id) && !decisions.has(a.id));
  if (vis.length < 2) continue;
  gid++;
  const sorted = [...vis].sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || Number(looksClean(y.aliasText)) - Number(looksClean(x.aliasText)) || x.aliasText.length - y.aliasText.length);
  const keeper = sorted.find((a) => a.isPrimary) ?? sorted[0];
  const kTokens = new Set(tokens(keeper.aliasText));
  const swap = ACTION_WORD.test(keeper.aliasText) ? sorted.find((a) => a !== keeper && !abbreviation(a.aliasText) && !ACTION_WORD.test(a.aliasText) && looksClean(a.aliasText) && tokens(a.aliasText).every((w) => kTokens.has(w))) : undefined;
  const DECORATOR = new Set(["state", "removal", "evaluation", "check", "episode", "level", "levels", "test", "screening", "treated", "untreated", "history", "surgery", "problem", "issue"].map(stem));
  for (const a of vis) {
    if (a === keeper) {
      decisions.set(a.id, swap ? { alias: a, tier: "B2", action: "Hide if you approve the swap", reason: "The main name reads like an action or status phrase; a cleaner name of the same condition exists", group: gid, keep: swap.aliasText, flag: "Swap" } : { alias: a, tier: "-", action: "Keep visible (main name)", reason: "Main name", group: gid, keep: keeper.aliasText, flag: "" });
      continue;
    }
    if (swap && a === swap) {
      decisions.set(a.id, { alias: a, tier: "-", action: "Keep visible (cleaner name; takes the main name's place if you approve the swap)", reason: "Cleaner name of the same condition", group: gid, keep: swap.aliasText, flag: "Swap" });
      continue;
    }
    const ka = k2(a.aliasText), kk = k2(keeper.aliasText);
    const own = tokens(a.aliasText).filter((w) => !DECORATOR.has(w));
    const decoratorOnly = own.length > 0 && own.every((w) => kTokens.has(w)) && tokens(keeper.aliasText).filter((w) => !DECORATOR.has(w)).every((w) => own.includes(w) || DECORATOR.has(w));
    if (abbreviation(a.aliasText)) decisions.set(a.id, { alias: a, tier: "-", action: "Keep visible (abbreviation)", reason: "Advisors type abbreviations", group: gid, keep: keeper.aliasText, flag: "Your call: hide?" });
    else if (sameWording(a.aliasText, keeper.aliasText)) decisions.set(a.id, { alias: a, tier: "A", action: "Hide", reason: "Same name written differently (plural, hyphen, spacing, spelling or a generic trailing word)", group: gid, keep: keeper.aliasText });
    else if (ka.length >= 6 && lev(ka, kk, 2) <= 2 && !/[0-9]/.test(a.aliasText + keeper.aliasText)) decisions.set(a.id, { alias: a, tier: "A", action: "Hide", reason: "Spelling variant of the main name", group: gid, keep: keeper.aliasText });
    else if (decoratorOnly) decisions.set(a.id, { alias: a, tier: "B1", action: "Hide", reason: "The main name plus an extra word (state, removal, check, level…)", group: gid, keep: keeper.aliasText });
    else decisions.set(a.id, { alias: a, tier: "B2", action: "Hide", reason: "A different word for the same condition. RISK: an advisor typing this word will no longer see a suggestion (the search itself still works). Recommend keeping unless you approve.", group: gid, keep: keeper.aliasText, flag: tokens(a.aliasText).length === 1 ? "Short common word: recommend keeping it visible" : "" });
  }
}

// 4. Review only: possible misspellings across conditions (spelling distance) and related wording. Never changed.
const freq = new Map<string, number>();
for (const a of visible) for (const w of new Set(clean(a.aliasText).split(" "))) freq.set(w, (freq.get(w) ?? 0) + 1);
const mains = visible.filter((a) => a.isPrimary && !nonMedicalIds.has(a.id));
const seenPairs = new Set<string>();
for (let i = 0; i < mains.length; i++) for (let j = i + 1; j < mains.length; j++) {
  const A = mains[i], B = mains[j];
  if (A.pedId === B.pedId || sameWording(A.aliasText, B.aliasText)) continue;
  let why = "";
  const ka = k2(A.aliasText), kb = k2(B.aliasText);
  if (ka.length >= 10 && !/[0-9]/.test(A.aliasText + B.aliasText) && lev(ka, kb, 1) <= 1) {
    const wa = new Set(clean(A.aliasText).split(" ")), wb = new Set(clean(B.aliasText).split(" "));
    const only = [...[...wa].filter((w) => !wb.has(w)), ...[...wb].filter((w) => !wa.has(w))];
    if (!only.every((w) => (freq.get(w) ?? 0) >= 2 || w.length <= 4)) why = "Possible misspelling";
  }
  if (!why) {
    const TA = new Set(tokens(A.aliasText)), TB = new Set(tokens(B.aliasText));
    const inter = [...TA].filter((w) => TB.has(w)).length;
    const small = TA.size <= TB.size ? TA : TB, big = TA.size <= TB.size ? TB : TA;
    const extra = [...big].filter((w) => !small.has(w));
    if ((small.size >= 2 && inter === small.size && extra.length === 1 && extra[0].length <= 4) || (inter >= 2 && inter / (TA.size + TB.size - inter) >= 0.6)) why = "Related wording";
  }
  if (!why) continue;
  const key = [A.id, B.id].join("-");
  if (seenPairs.has(key)) continue;
  seenPairs.add(key);
  gid++;
  const dA = pedAnswers(pedById.get(A.pedId)!), dB = pedAnswers(pedById.get(B.pedId)!);
  for (const a of [A, B]) review.push({ Group: gid, Why: `${why}; ${differing(dA, dB).length ? `answers differ on ${differing(dA, dB).join(", ")}` : "same answers today (not proof they are the same condition)"}`, Action: "Leave both visible (untouched)", ...info(a) });
}

// ── outputs ───────────────────────────────────────────────────────────────────────────────────────
const tierRows = [...decisions.values()].filter((d) => d.tier !== "" ).sort((a, b) => a.group - b.group || a.tier.localeCompare(b.tier)).map((d) => ({ Group: d.group, Tier: d.tier === "-" ? "Stays" : d.tier, Action: d.action, "Stays visible as": d.keep ?? "", Reason: d.reason, Note: d.flag ?? "", ...info(d.alias) }));
const hideA = [...decisions.values()].filter((d) => d.tier === "A").length;
const hideB1 = [...decisions.values()].filter((d) => d.tier === "B1").length;
const hideB2 = [...decisions.values()].filter((d) => d.tier === "B2").length;
const nm = nonMedical.length;
writeFileSync(`${outDir}/1-visible-name-cleanup.csv`, csv(tierRows));
writeFileSync(`${outDir}/2-non-medical-suggestions.csv`, csv(nonMedical));
writeFileSync(`${outDir}/3-left-untouched-for-review.csv`, csv([...review, ...engineQuirk.map((r) => ({ Group: "-", ...r }))]));
// The approved hide list: Tier A, Tier B1 and the non-medical names. Never Tier B2 (alternative wording stays visible).
const byText = new Map<string, Alias>();
for (const a of visible) if (!byText.has(a.aliasText)) byText.set(a.aliasText, a);
const planItems: Array<Record<string, unknown>> = [];
for (const d of decisions.values()) {
  if (d.tier !== "A" && d.tier !== "B1") continue;
  const keeper = d.keep ? byText.get(d.keep) : undefined;
  planItems.push({ id: d.alias.id, text: d.alias.aliasText, normalized: d.alias.normalizedAlias, group: d.tier, pedId: d.alias.pedId, category: null, keeperId: keeper?.id ?? null, keeperText: d.keep ?? null });
}
for (const a of visibleAll) {
  if (!nonMedicalIds.has(a.id)) continue;
  const p = pedById.get(a.pedId);
  planItems.push({ id: a.id, text: a.aliasText, normalized: a.normalizedAlias, group: "NON_MEDICAL", pedId: p ? a.pedId : null, category: p?.categoryKey ?? null, keeperId: null, keeperText: null });
}
writeFileSync(`${outDir}/hide-plan.json`, JSON.stringify({ version: 1, madeFrom: { environment: raw.meta.environment, capturedAt: raw.meta.capturedAt }, expectedVisibleBefore: visibleAll.length, expectedVisibleAfter: visibleAll.length - planItems.length, items: planItems }, null, 1));
writeFileSync(`${outDir}/hide-list-106.csv`, csv(planItems.map((i) => ({ Group: i.group === "NON_MEDICAL" ? "Non-medical" : i.group, "Name to hide": i.text, "Stays visible instead": i.keeperText ?? "", "Alias id": i.id }))));
const planC: Array<Record<string, unknown>> = [];
for (const d of decisions.values()) {
  if (d.tier !== "C") continue;
  const keeper = d.keep ? byText.get(d.keep) : undefined;
  planC.push({ id: d.alias.id, text: d.alias.aliasText, normalized: d.alias.normalizedAlias, group: "A", pedId: d.alias.pedId, category: null, keeperId: keeper?.id ?? null, keeperText: d.keep ?? null });
}
const beforeC = visibleAll.length - planItems.length;
writeFileSync(`${outDir}/hide-plan-C.json`, JSON.stringify({ version: 1, madeFrom: { environment: raw.meta.environment, capturedAt: raw.meta.capturedAt }, expectedVisibleBefore: beforeC, expectedVisibleAfter: beforeC - planC.length, items: planC }, null, 1));
writeFileSync(`${outDir}/hide-list-C.csv`, csv(planC.map((i) => ({ "Name to hide": i.text, "Stays visible instead": i.keeperText ?? "", "Alias id": i.id }))));
const total = visibleAll.length;
const md = `# Declaration Assist suggestion list: revised Phase 1 (read-only)

Source: ${raw.meta.environment} snapshot captured ${raw.meta.capturedAt}. No database was read or changed.

| Measure | Count |
|---|---|
| Suggestions advisors see today (visible names) | ${total} |
| Tier A: obvious wording variants to hide | ${hideA} |
| Tier B1: the main name plus an extra word (state, removal, check, level): hide | ${hideB1} |
| Tier B2: a different word for the same condition (colloquial or Latin name): recommend KEEPING, needs approval | ${hideB2} |
| Non-medical suggestions to hide (habits, normal life stages, deleted conditions) | ${nm} |
| Left untouched for review (look similar, may differ) | ${new Set(review.map((r) => r.Group)).size} groups |
| List size after Tier A only | ${total - hideA} |
| After Tier A + non-medical | ${total - hideA - nm} |
| After Tier A + B1 + non-medical | ${total - hideA - hideB1 - nm} |
| After Tier A + B1 + B2 + non-medical (maximum) | ${total - hideA - hideB1 - hideB2 - nm} |
`;
writeFileSync(`${outDir}/suggestion-audit-summary.md`, md);
console.log(md);
