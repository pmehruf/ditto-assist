/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PED Library cleanup, PHASE 1: strictly READ-ONLY audit. Reads a captured copy of the mapping tables (the file written by
 * `npm run mapping:snapshot`), never a database, and writes review files. It changes nothing.
 *
 *   npx tsx scripts/pedLibraryAudit.ts --snapshot <snapshot.json.gz> --out <dir> [--usage <usage.json>]
 *
 * What it looks for (the Lookup dropdown lists every VISIBLE alias, one line each):
 *   - several visible names on one condition (the dropdown shows the same condition more than once);
 *   - different conditions that are the same thing written differently (same words in another order, plural, joined or
 *     hyphenated, a one-letter spelling difference);
 *   - aliases whose condition no longer exists, conditions with no alias, deprecated rows.
 * For every candidate it runs the real engine on each name on every plan and records the answer, so a proposal can say
 * whether two names give the same declaration answer today. Names whose answers differ are never proposed as a plain merge.
 *
 * Limits: the snapshot does not carry the per-alias routing options (routing_enabled, category override, last-resort category)
 * or search usage, so those are checked later against the live database (see scripts/pedUsageReport.ts and Phase 2).
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
const dump = (JSON.parse(gunzipSync(readFileSync(snapPath)).toString()) as { meta: Record<string, unknown>; data: MappingDump }).data as unknown as MappingDump & { pedRepository: Ped[]; pedAliases: Alias[] };
const meta = (JSON.parse(gunzipSync(readFileSync(snapPath)).toString()) as { meta: { capturedAt: string; environment: string } }).meta;
const usage: Record<string, number> = usagePath ? JSON.parse(readFileSync(usagePath, "utf8")) : {};

const peds = dump.pedRepository;
const aliases = dump.pedAliases;
const pedById = new Map(peds.map((p) => [p.id, p]));
const aliasesByPed = new Map<number, Alias[]>();
for (const a of aliases) aliasesByPed.set(a.pedId, [...(aliasesByPed.get(a.pedId) ?? []), a]);

// ── the engine, with aliases built the way the live loader builds them ────────────────────────────
const base = snapshotFromDump(dump);
const snapshot: MappingSnapshot = {
  ...base,
  aliases: new Map(
    aliases.map((a) => [a.normalizedAlias, { pedId: a.pedId, pedCategory: pedById.get(a.pedId)?.categoryKey ?? null, routingEnabled: true, categoryOverride: null, fallbackCategory: null }] as const)
  ),
};
const plans = planConfigsFromDump(dump);
const answerCache = new Map<string, string>();
const answers = (text: string): string[] =>
  plans.map(({ planName, config }) => {
    const k = `${planName}\u0000${text}`;
    let v = answerCache.get(k);
    if (v === undefined) {
      v = primaryKey(newEngineOutcome(text, planName, config, snapshot));
      answerCache.set(k, v);
    }
    return v;
  });
const planNames = plans.map((p) => p.planName);
const differingPlans = (a: string[], b: string[]) => planNames.filter((_, i) => a[i] !== b[i]);

// ── similarity keys ──────────────────────────────────────────────────────────────────────────────
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
const abbreviation = (t: string) => /^[A-Z0-9][A-Z0-9 .\-/&]{1,7}$/.test(t.trim()) && t.trim() === t.trim().toUpperCase();
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ── candidate groups over VISIBLE aliases ────────────────────────────────────────────────────────
const visible = aliases.filter((a) => a.isVisible && pedById.has(a.pedId));
const parent = new Map<number, number>();
const find = (x: number): number => (parent.get(x) === x || !parent.has(x) ? (parent.set(x, x), x) : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
const reason = new Map<string, Set<string>>();
const note = (a: number, b: number, why: string) => { const key = [a, b].sort().join("-"); (reason.get(key) ?? reason.set(key, new Set()).get(key)!).add(why); };
const byK1 = new Map<string, Alias[]>(), byK2 = new Map<string, Alias[]>();
for (const a of visible) {
  if (!tokens(a.aliasText).length) continue;
  for (const [m, key] of [[byK1, k1(a.aliasText)], [byK2, k2(a.aliasText)]] as const) m.set(key, [...(m.get(key) ?? []), a]);
}
for (const [m, why] of [[byK1, "same words"], [byK2, "same spelling once joined"]] as const)
  for (const list of m.values()) for (let i = 1; i < list.length; i++) { union(list[0].id, list[i].id); note(list[0].id, list[i].id, why); }
for (const list of aliasesByPed.values()) {
  const v = list.filter((x) => x.isVisible && pedById.has(x.pedId));
  for (let i = 1; i < v.length; i++) { union(v[0].id, v[i].id); note(v[0].id, v[i].id, "same condition"); }
}
const freq = new Map<string, number>();
for (const a of visible) for (const w of new Set(clean(a.aliasText).split(" "))) freq.set(w, (freq.get(w) ?? 0) + 1);
const k2s = visible.map((a) => ({ a, k: k2(a.aliasText) })).filter((x) => x.k.length >= 10 && !/[0-9]/.test(x.a.aliasText));
for (let i = 0; i < k2s.length; i++) for (let j = i + 1; j < k2s.length; j++) {
  if (k2s[i].k === k2s[j].k || lev(k2s[i].k, k2s[j].k, 1) > 1) continue;
  const wa = new Set(clean(k2s[i].a.aliasText).split(" ")), wb = new Set(clean(k2s[j].a.aliasText).split(" "));
  const onlyA = [...wa].filter((w) => !wb.has(w)), onlyB = [...wb].filter((w) => !wa.has(w));
  // Two different real words (each used by other names too, e.g. nephropathy / neuropathy) are not a spelling mistake.
  if ([...onlyA, ...onlyB].every((w) => (freq.get(w) ?? 0) >= 2 || w.length <= 4)) continue;
  union(k2s[i].a.id, k2s[j].a.id);
  note(k2s[i].a.id, k2s[j].a.id, "possible misspelling (one name uses a word nothing else uses)");
}
const groups = new Map<number, Alias[]>();
for (const a of visible) if (parent.has(a.id)) groups.set(find(a.id), [...(groups.get(find(a.id)) ?? []), a]);

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────
const csv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [cols.map((c) => esc(c)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
};
const searchesOf = (a: Alias) => usage[a.normalizedAlias] ?? "";
const member = (a: Alias) => {
  const p = pedById.get(a.pedId)!;
  const ans = answers(a.aliasText);
  return { a, p, ans, visibleCount: (aliasesByPed.get(p.id) ?? []).filter((x) => x.isVisible).length, total: (aliasesByPed.get(p.id) ?? []).length };
};
type M = ReturnType<typeof member>;
const survivorOf = (ms: M[]): M =>
  [...ms].sort((x, y) => Number(y.p.status === "approved") - Number(x.p.status === "approved") || Number(!!y.p.categoryKey) - Number(!!x.p.categoryKey) || Number(y.a.isPrimary) - Number(x.a.isPrimary) || y.total - x.total || x.p.id - y.p.id)[0];

const rows: Array<Record<string, unknown>> = [];
const summary = { sameCondition: 0, mergeSafe: 0, needsDecision: 0, hideOnly: 0 };
let gid = 0;
for (const list of [...groups.values()].filter((l) => new Set(l.map((x) => x.aliasText.toLowerCase().trim())).size > 1 || new Set(l.map((x) => x.pedId)).size > 1).sort((a, b) => a[0].aliasText.localeCompare(b[0].aliasText))) {
  gid++;
  const ms = list.map(member);
  const pedIds = new Set(ms.map((m) => m.p.id));
  const cats = new Set(ms.map((m) => m.p.categoryKey ?? "(none)"));
  // Compare conditions, not names: each condition is represented by its main name (names of one condition never change an answer by being hidden).
  const repOf = (m: M) => answers((aliasesByPed.get(m.p.id) ?? []).find((x) => x.isPrimary)?.aliasText ?? m.a.aliasText);
  const sig = repOf(ms[0]);
  const identical = ms.every((m) => differingPlans(sig, repOf(m)).length === 0);
  const whys = new Set<string>();
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) for (const w of reason.get([ms[i].a.id, ms[j].a.id].sort().join("-")) ?? []) whys.add(w);
  const survivor = survivorOf(ms);
  const survivorPed = survivor.p.id;
  const spellingOnly = [...whys].every((w) => w.startsWith("possible misspelling"));
  let type: string, action: string;
  if (pedIds.size === 1) {
    type = "Same condition, several visible names";
    action = "Keep the main name visible; hide the others (they keep matching)";
    summary.sameCondition++;
  } else if (spellingOnly) {
    type = "Possible misspelling (review)";
    action = "REVIEW: if one is a typo, hide it; otherwise keep both";
    summary.hideOnly++;
  } else if (identical && cats.size === 1) {
    type = "Same thing written differently, same answers";
    action = "Merge into the survivor; keep the other names as hidden names";
    summary.mergeSafe++;
  } else {
    type = "Same thing written differently, but answers or category differ";
    action = "NEEDS YOUR DECISION: merging would change an answer";
    summary.needsDecision++;
  }
  const lowConfidence = spellingOnly;
  for (const m of ms) {
    const dp = differingPlans(sig, repOf(m));
    rows.push({
      Group: gid,
      "What it is": type,
      Confidence: lowConfidence ? "Low (spelling distance only)" : "High",
      "Why grouped": [...whys].join("; "),
      "Proposed action": action,
      Role: (pedIds.size === 1 || (!spellingOnly && m.p.id === survivorPed && m !== survivor)) ? (m.a.isPrimary ? "Keep visible (main name)" : abbreviation(m.a.aliasText) ? "Abbreviation: your call (keep visible?)" : "Hide") : spellingOnly ? "Review" : m === survivor ? "Survivor (suggested)" : identical && cats.size === 1 ? "Merge into survivor, keep name hidden" : "Decide",
      Name: m.a.aliasText,
      "Alias id": m.a.id,
      "PED code": m.p.pedCode,
      "PED id": m.p.id,
      "Official name": m.p.canonicalName,
      Category: m.p.categoryKey ?? "(none)",
      Status: m.p.status,
      "Main name?": m.a.isPrimary ? "yes" : "",
      "Visible names on this PED": m.visibleCount,
      "Searches, last 90 days": searchesOf(m.a),
      "Answers differ from the first name on": dp.join(", "),
      ...Object.fromEntries(planNames.map((pn, i) => [`Answer: ${pn}`, m.ans[i].split("|").slice(1, 3).join(" ").slice(0, 70)])),
    });
  }
}
writeFileSync(`${outDir}/ped-library-groups.csv`, csv(rows));

// ── other findings ───────────────────────────────────────────────────────────────────────────────
const other: Array<Record<string, unknown>> = [];
const withoutOrphans: MappingSnapshot = { ...snapshot, aliases: new Map([...snapshot.aliases].filter(([, v]) => pedById.has(v.pedId))) };
const answersWithout = (text: string): string[] => plans.map(({ planName, config }) => primaryKey(newEngineOutcome(text, planName, config, withoutOrphans)));
for (const a of aliases) if (!pedById.has(a.pedId)) {
  const now = answers(a.aliasText), without = answersWithout(a.aliasText);
  const changed = planNames.filter((_, i) => now[i] !== without[i]);
  other.push({ Finding: "Name whose condition no longer exists", Name: a.aliasText, "Alias id": a.id, "Missing PED id": a.pedId, Visible: a.isVisible ? "yes" : "no", "Answer today": now.map((x, i) => `${planNames[i]}: ${x.split("|")[1] === "1" ? x.split("|")[2] : "AI step"}`).join(" ; ").slice(0, 120), "If the name is deleted": changed.length ? `Answer changes on: ${changed.join(", ")}` : "No answer changes", Proposed: changed.length ? "NEEDS YOUR DECISION" : "Delete (no answer changes), or recreate the condition if it should exist" });
}
for (const p of peds) {
  const al = aliasesByPed.get(p.id) ?? [];
  if (!al.length) other.push({ Finding: "Condition with no name at all", Name: p.canonicalName, "PED code": p.pedCode, "PED id": p.id, Status: p.status, Category: p.categoryKey ?? "(none)", Proposed: "Review: it can never be found or shown" });
  if (p.status === "deprecated") other.push({ Finding: "Deprecated condition", Name: p.canonicalName, "PED code": p.pedCode, "PED id": p.id, "Visible names": al.filter((x) => x.isVisible).length, Proposed: al.some((x) => x.isVisible) ? "Hide its names (status does not affect matching or the dropdown)" : "Nothing: its names are already hidden" });
}
for (const a of aliases) if (/�/.test(a.aliasText)) other.push({ Finding: "Name with damaged characters", Name: a.aliasText, "Alias id": a.id, "PED code": pedById.get(a.pedId)?.pedCode ?? "", Proposed: "Correct the spelling (the damaged text cannot be typed by an advisor)" });
const labelIssues = visible.filter((a) => a.aliasText !== a.aliasText.trim() || /\s{2,}/.test(a.aliasText) || /[.,;:]$/.test(a.aliasText.trim()) || (a.aliasText === a.aliasText.toLowerCase() && a.aliasText.length > 3 && !abbreviation(a.aliasText)));
for (const a of labelIssues) other.push({ Finding: "Name written inconsistently (all lower case, stray space or trailing punctuation)", Name: a.aliasText, "Alias id": a.id, "PED code": pedById.get(a.pedId)!.pedCode, Proposed: "Tidy the text only if the Constitution's naming rule allows it (does not change matching)" });
writeFileSync(`${outDir}/ped-library-other-findings.csv`, csv(other));

// Pass 3: related wording across different conditions (not already grouped). Lower confidence: a person decides.
const grouped = new Set([...groups.values()].flat().map((a) => a.id));
const mains = visible.filter((a) => a.isPrimary && !grouped.has(a.id));
const related: Array<Record<string, unknown>> = [];
for (let i = 0; i < mains.length; i++) for (let j = i + 1; j < mains.length; j++) {
  const A = new Set(tokens(mains[i].aliasText)), B = new Set(tokens(mains[j].aliasText));
  const inter = [...A].filter((w) => B.has(w));
  const small = A.size <= B.size ? A : B, big = A.size <= B.size ? B : A;
  const extra = [...big].filter((w) => !small.has(w));
  const oneIsTheOtherPlusAbbreviation = small.size >= 2 && inter.length === small.size && extra.length === 1 && extra[0].length <= 4;
  const jac = inter.length / (A.size + B.size - inter.length);
  if (!(oneIsTheOtherPlusAbbreviation || (inter.length >= 2 && jac >= 0.6))) continue;
  const pa = pedById.get(mains[i].pedId)!, pb = pedById.get(mains[j].pedId)!;
  const x = answers(mains[i].aliasText), y = answers(mains[j].aliasText);
  related.push({ "Name 1": mains[i].aliasText, "PED 1": pa.pedCode, "Category 1": pa.categoryKey ?? "(none)", "Name 2": mains[j].aliasText, "PED 2": pb.pedCode, "Category 2": pb.categoryKey ?? "(none)", "Same answer on every plan?": differingPlans(x, y).length ? `No: differs on ${differingPlans(x, y).join(", ")}` : "Yes", "Word overlap": jac.toFixed(2), Proposed: "REVIEW: same thing? (merge) or different conditions (keep both)" });
}
related.sort((p, q) => String(q["Word overlap"]).localeCompare(String(p["Word overlap"])));
writeFileSync(`${outDir}/ped-library-related-wording.csv`, csv(related));
console.log(`Related-wording pairs to review: ${related.length}`);

const visPerPed = new Map<number, number>();
for (const a of visible) visPerPed.set(a.pedId, (visPerPed.get(a.pedId) ?? 0) + 1);
const extraVisible = [...visPerPed.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
const md = `# PED Library audit (read-only)

Source: ${meta.environment} snapshot captured ${meta.capturedAt}. No database was read or changed.

| Measure | Count |
|---|---|
| Conditions | ${peds.length} |
| Names (aliases) | ${aliases.length} |
| Visible names (dropdown lines) | ${aliases.filter((a) => a.isVisible).length} |
| Hidden names | ${aliases.filter((a) => !a.isVisible).length} |
| Conditions with more than one visible name | ${[...visPerPed.values()].filter((n) => n > 1).length} (${extraVisible} extra dropdown lines) |
| Candidate groups found | ${gid} |
| of which: same condition, several visible names | ${summary.sameCondition} |
| of which: same thing written differently, same answers and category (merge candidates) | ${summary.mergeSafe} |
| of which: same thing written differently, but answers or category differ (needs your decision) | ${summary.needsDecision} |
| of which: possible misspellings to review | ${summary.hideOnly} |
| Other findings (missing condition, no name, deprecated, formatting) | ${other.length} |
`;
writeFileSync(`${outDir}/ped-library-audit-summary.md`, md);
console.log(md);
