// The locked template. Every heading, fixed sentence and table layout lives here, in code.
// Wording is taken from the user's past documents. The page cannot edit this file's output;
// only the AI-written text blocks (keys listed in `aiKeys`) can be edited in the preview.

import {
  CATS, CAT_KEYS, activeCats, categoryFacts, fmtHundredths, fmtPct, plural,
  fmtMonthYear, fmtMonthOnly, fmtDateLong, fmtDateShort,
  parseDecimal, parseCount, blunderPctHundredths, isBlank, extractNumbers, allowedNumbers
} from './core';

export const HEADINGS = Object.freeze({
  background: 'Background',
  analysis: (dataMonth) => `QIP Analysis Data – ${dataMonth}`,
  individual: 'Individual Analysis and Overview',
  trend: 'Performance Trend',
  current: 'Current Performance',
  blunders: 'Sharing the details regarding the blunders below for reference',
  conclusion: 'Conclusion'
});

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function listNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export const aiKey = {
  background: 'background',
  conclusion: 'conclusion',
  overview: (id) => `adv:${id}:overview`,
  cat: (id, k) => `adv:${id}:${k}`
};

const run = (text, o = {}) => ({ text, ...o });
const para = (text, o = {}) => ({ type: 'para', runs: [run(text, o)] });
const bullet = (text, level = 0, o = {}) => ({ runs: [run(text, o)], level });

// Lines the tool writes itself from the numbers (no AI).
export function calculatedLines(inputs, adv, key) {
  const f = categoryFacts(inputs, adv, key);
  const c = adv.categories[key];
  const bench = String(inputs.benchmark).trim();
  const limit = String(inputs.limit).trim();
  const benchLabel = key === 'lead' ? 'Lead Score benchmark' : 'QA benchmark';
  const lines = [];
  const unit = (h) => (fmtHundredths(h) === '1' ? 'point' : 'points');
  if (f.gapH > 0) lines.push(`Missed the ${benchLabel} of ${bench} by ${fmtHundredths(f.gapH)} ${unit(f.gapH)} over ${plural(f.instances, 'instance', 'instances')}.`);
  else lines.push(`${key === 'lead' ? 'Lead Score' : 'Payments QA Score'} of ${f.score} is at or above the ${benchLabel} of ${bench} over ${plural(f.instances, 'instance', 'instances')}.`);
  if (f.overH > 0) lines.push(`Blunder% is ${f.pct}, which is ${fmtHundredths(f.overH)} ${unit(f.overH)} above the accepted limit of ${limit}%.`);
  else lines.push(`Blunder% is within acceptable range (${f.pct} against the ${limit}% limit).`);
  if (key === 'lead' && (!isBlank(c.chatScore) || !isBlank(c.callScore))) {
    const parts = [];
    if (!isBlank(c.chatScore)) parts.push(`chat (${String(c.chatScore).trim()}${isBlank(c.chatInstances) ? '' : `, ${plural(parseCount(c.chatInstances), 'instance', 'instances')}`})`);
    if (!isBlank(c.callScore)) parts.push(`call (${String(c.callScore).trim()}${isBlank(c.callInstances) ? '' : `, ${plural(parseCount(c.callInstances), 'instance', 'instances')}`})`);
    lines.push(`Lead Score split by channel: ${parts.join(' and ')}.`);
  }
  return lines;
}

// ai = { background:[...], conclusion:[...], advisors:{ [id]: { overview:[...], lead:[...], pay:[...] } } }
export function buildDocument(inputs, ai: any = {}) {
  const advisors = inputs.advisors;
  const multi = advisors.length > 1;
  const blocks = [];
  const aiList = (arr) => (Array.isArray(arr) ? arr : []);

  blocks.push({ type: 'title', text: `QIP Exception Request | ${fmtMonthYear(inputs.requestMonth)}` });

  const names = advisors.map((a) => a.name.trim());
  blocks.push(para(
    multi
      ? `We'd like to request an exception to the QIP process for ${advisors.length <= 10 ? NUM_WORDS[advisors.length] : advisors.length} of our advisors: ${listNames(names)}.`
      : `We'd like to request an exception to the QIP process for ${names[0]}.`
  ));

  blocks.push({ type: 'heading', level: 2, text: HEADINGS.background });
  blocks.push({ type: 'paras', ai: aiKey.background, items: aiList(ai.background).map((t) => ({ runs: [run(t)] })) });

  // ---- analysis table: one row per advisor per category
  blocks.push({ type: 'heading', level: 2, text: HEADINGS.analysis(fmtMonthOnly(inputs.dataMonth)) });
  const analysisRows = [];
  advisors.forEach((a) => activeCats(a).forEach((k) => {
    const f = categoryFacts(inputs, a, k);
    analysisRows.push([a.name.trim(), f.score, String(f.instances), f.label, `${f.pct} (${f.blunders}/${f.instances})`]);
  }));
  blocks.push({ type: 'table', id: 'analysis', headers: ['Advisor', 'QA Score', 'Instances', 'Category', 'Blunder %'], rows: analysisRows, widths: [2600, 1300, 1400, 1700, 2026] });

  // ---- individual analysis
  blocks.push({ type: 'heading', level: 2, text: HEADINGS.individual });
  advisors.forEach((a) => {
    const cats = activeCats(a);
    const id = a.id;
    const advAi = (ai.advisors && ai.advisors[id]) || {};
    blocks.push({ type: 'para', runs: [run(a.name.trim(), { bold: true })], keepNext: true });
    const facts = [];
    if (!isBlank(a.evalStartDate)) facts.push(bullet(`Evaluation Start Date: ${fmtDateLong(a.evalStartDate)}`));
    if (facts.length) blocks.push({ type: 'bullets', items: facts });
    blocks.push({ type: 'paras', ai: aiKey.overview(id), items: aiList(advAi.overview).map((t) => ({ runs: [run(t)] })) });
    cats.forEach((k) => {
      if (cats.length > 1) blocks.push({ type: 'para', runs: [run(CATS[k], { bold: true })], keepNext: true, indent: 360 });
      blocks.push({ type: 'bullets', items: calculatedLines(inputs, a, k).map((t) => bullet(t)) });
      blocks.push({ type: 'paras', ai: aiKey.cat(id, k), items: aiList(advAi[k]).map((t) => ({ runs: [run(t)] })) });
    });
  });

  // ---- performance trend: one dedicated table per category
  const trendTables = CAT_KEYS.map((k) => {
    const rowsIn = [];
    advisors.forEach((a) => (a.trend || []).forEach((r) => { if (r.category === k) rowsIn.push([a, r]); }));
    return { k, rowsIn };
  }).filter((t) => t.rowsIn.length);
  if (trendTables.length) blocks.push({ type: 'heading', level: 2, text: HEADINGS.trend });
  trendTables.forEach(({ k, rowsIn }) => {
    const anyBlunder = rowsIn.some(([, r]) => !isBlank(r.blunders));
    const rows = rowsIn.map(([a, r]) => {
      const row = [a.name.trim(), CATS[r.category], r.month.trim(), isBlank(r.score) ? 'NA' : String(r.score).trim(), isBlank(r.instances) ? 'NA' : String(r.instances).trim()];
      if (anyBlunder) {
        const n = parseCount(r.instances), bl = parseCount(r.blunders);
        row.push(isBlank(r.blunders) ? 'NA' : `${fmtPct(blunderPctHundredths(bl, n))} (${bl}/${n})`);
      }
      return row;
    });
    if (trendTables.length > 1) blocks.push({ type: 'para', runs: [run(CATS[k], { bold: true })], keepNext: true });
    blocks.push({
      type: 'table', id: `trend:${k}`,
      headers: anyBlunder ? ['Advisor', 'Category', 'Month', 'QA Score', 'Instances', 'Blunder %'] : ['Advisor', 'Category', 'Month', 'QA Score', 'Instances'],
      rows,
      widths: anyBlunder ? [2100, 1400, 1300, 1300, 1300, 1626] : [2500, 1700, 1600, 1600, 1626]
    });
  });

  // ---- current performance
  const curRows = [];
  advisors.forEach((a) => activeCats(a).forEach((k) => {
    const c = a.categories[k];
    if (!isBlank(c.currentScore)) curRows.push([a.name.trim(), CATS[k], String(c.currentScore).trim(), isBlank(c.currentInstances) ? 'NA' : String(c.currentInstances).trim()]);
  }));
  if (curRows.length) {
    blocks.push({ type: 'heading', level: 2, text: HEADINGS.current });
    blocks.push({ type: 'table', id: 'current', headers: ['Advisor', 'Category', 'QA Score', 'Instances'], rows: curRows, widths: [3000, 2200, 1900, 1926] });
  }

  // ---- blunder details
  advisors.forEach((a) => {
    const rows = a.blunderRows || [];
    if (!rows.length) return;
    if (multi) blocks.push({ type: 'para', runs: [run(a.name.trim(), { bold: true })], keepNext: true });
    blocks.push({ type: 'para', runs: [run(HEADINGS.blunders, { bold: true })], keepNext: true });
    blocks.push({
      type: 'table', id: `blunders:${a.id}`,
      headers: ['Date of Marking', 'Chat ID', 'Severity', 'Marking', 'Comment'],
      rows: rows.map((r) => [fmtDateShort(r.date), r.chatId.trim(), isBlank(r.severity) ? '' : String(r.severity).trim(), r.marking.trim(), isBlank(r.comment) ? '' : r.comment.trim()]),
      widths: [1400, 1300, 1000, 2900, 2426]
    });
  });

  // ---- conclusion (always last)
  blocks.push({ type: 'heading', level: 2, text: HEADINGS.conclusion });
  blocks.push({ type: 'paras', ai: aiKey.conclusion, items: aiList(ai.conclusion).map((t) => ({ runs: [run(t)] })) });
  blocks.push(para(
    multi
      ? 'I would like to request a QIP exception review for the above advisors.'
      : "Hence, we are requesting an exception from QIP considering the advisor's overall quality track record.",
    { bold: true }
  ));

  return { blocks };
}

// ---------- reading the document back as text (used by the checks and the tests) ----------
export const blockText = (b) => {
  if (b.type === 'title' || b.type === 'heading') return b.text;
  if (b.type === 'para') return b.runs.map((r) => r.text).join('');
  if (b.type === 'bullets' || b.type === 'paras') return b.items.map((i) => i.runs.map((r) => r.text).join('')).join('\n');
  if (b.type === 'table') return [b.headers.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n');
  return '';
};
export const documentText = (doc) => doc.blocks.map(blockText).join('\n');

// Which AI keys are needed for these inputs
export function requiredAiKeys(inputs) {
  const keys = [aiKey.background, aiKey.conclusion];
  inputs.advisors.forEach((a) => activeCats(a).forEach((k) => keys.push(aiKey.cat(a.id, k))));
  return keys;
}

// ---------- the safety checks ----------
// Returns { errors:[], warnings:[], passed:[] }. Export is blocked while errors exist.
export function checkOutput(inputs, doc) {
  const errors = [], warnings = [], passed = [];
  const full = documentText(doc);
  const lines = full.split('\n');

  // 1. Required values must appear in the output exactly as entered
  let missing = 0;
  const analysis = doc.blocks.find((b) => b.type === 'table' && b.id === 'analysis');
    inputs.advisors.forEach((a) => {
    const name = a.name.trim();
    if (!full.includes(name)) { errors.push(`${name}: name is missing from the document.`); missing++; }
    activeCats(a).forEach((k) => {
      const f = categoryFacts(inputs, a, k);
      const row = analysis && analysis.rows.find((r) => r[0] === name && r[3] === f.label);
      if (!row) { errors.push(`${name}: no ${f.label} row in the analysis table.`); missing++; return; }
      if (row[1] !== f.score) { errors.push(`${name} (${f.label}): QA Score in the table (${row[1]}) does not match the input (${f.score}).`); missing++; }
      if (row[2] !== String(f.instances)) { errors.push(`${name} (${f.label}): instances in the table (${row[2]}) do not match the input (${f.instances}).`); missing++; }
      if (row[4] !== `${f.pct} (${f.blunders}/${f.instances})`) { errors.push(`${name} (${f.label}): Blunder % in the table (${row[4]}) does not match the calculation.`); missing++; }
    });
    (a.trend || []).forEach((r) => {
      const trend = doc.blocks.find((b) => b.type === 'table' && b.id === `trend:${r.category}`);
      const hit = trend && trend.rows.some((x) => x[0] === name && x[1] === CATS[r.category] && x[2] === r.month.trim() && (isBlank(r.score) || x[3] === String(r.score).trim()) && (isBlank(r.instances) || x[4] === String(r.instances).trim()));
      if (!hit) { errors.push(`${name}: past-months row for ${r.month} is missing or changed.`); missing++; }
    });
    (a.blunderRows || []).forEach((r) => { if (!full.includes(r.chatId.trim())) { errors.push(`${name}: blunder detail ${r.chatId} is missing.`); missing++; } });
    if (!isBlank(a.evalStartDate) && !full.includes(fmtDateLong(a.evalStartDate))) { errors.push(`${name}: evaluation start date is missing.`); missing++; }
  });
  if (!missing) passed.push('Every name, score, instance count, blunder count and date you entered appears in the document, unchanged.');

  // 2. All AI text must exist
  let empty = 0;
  for (const key of requiredAiKeys(inputs)) {
    const b = doc.blocks.find((x) => x.ai === key);
    const txt = b ? b.items.map((i) => i.runs.map((r) => r.text).join('')).join('').trim() : '';
    if (!txt) { empty++; errors.push(`Written section is empty: ${describeKey(inputs, key)}.`); }
  }
  if (!empty) passed.push('All written sections (Background, each category, Conclusion) have text.');

  // 3. Numbers in AI-written text must come from the inputs
  const allowed = allowedNumbers(inputs);
  let stray = 0;
  doc.blocks.filter((b) => b.ai).forEach((b) => {
    const txt = b.items.map((i) => i.runs.map((r) => r.text).join('')).join('\n');
    const bad = [...new Set(extractNumbers(txt).filter((n) => !allowed.has(n)))];
    if (bad.length) { stray++; errors.push(`Number(s) ${bad.join(', ')} in "${describeKey(inputs, b.ai)}" do not match anything you entered.`); }
  });
  if (!stray) passed.push('Every number in the written text matches your inputs or the tool\'s own calculations.');

  // 4. Leftover placeholders
  const leftovers = lines.filter((l) => /\[[^\]]*\]|\{\{|\}\}|TODO|TBD|lorem ipsum|XX+/i.test(l));
  if (leftovers.length) errors.push(`Placeholder-style text found: "${leftovers[0].slice(0, 60)}".`);
  else passed.push('No placeholder text found.');

  // 5. Pronoun consistency (warning only)
  const maleRe = /\b(he|him|his|himself)\b/i, femaleRe = /\b(she|her|hers|herself)\b/i;
  let pron = 0;
  inputs.advisors.forEach((a) => {
    const keys = [aiKey.overview(a.id), ...CAT_KEYS.map((k) => aiKey.cat(a.id, k))];
    const txt = doc.blocks.filter((b) => keys.includes(b.ai)).map(blockText).join('\n');
    const wrong = a.pronoun === 'she' ? maleRe : femaleRe;
    if (txt && wrong.test(txt)) { pron++; warnings.push(`${a.name.trim()}: the text uses "${a.pronoun === 'she' ? 'he/him/his' : 'she/her'}" - check the pronouns.`); }
  });
  if (!pron) passed.push('Pronouns match your selection.');

  // 5b. Plain-language check (warning only)
  const FANCY = /\b(utili[sz]e[sd]?|utili[sz]ing|leverag\w*|ensur\w*|robust|holistic|trajectory|pertinent|furthermore|moreover|additionally|notably|underscor\w*|demonstrat\w*|indicat\w*|deviation|benchmark-compliant|stabili[sz]ation|facilitat\w*|commence\w*|endeavou?r\w*|subsequent\w*|aforementioned|in order to|it is worth noting|it is important to)\b/i;
  const aiText = doc.blocks.filter((b) => b.ai).map(blockText).join('\n');
  const fancy = [...new Set((aiText.match(new RegExp(FANCY.source, 'gi')) || []).map((w) => w.toLowerCase()))];
  const longSentences = aiText.split(/(?<=[.!?])\s+|\n/).filter((x) => x.trim().split(/\s+/).length > 25);
  const dashes = /[\u2014\u2013;]/.test(aiText);
  if (fancy.length) warnings.push(`Simpler words would read better than: ${fancy.join(', ')}.`);
  if (longSentences.length) warnings.push(`${longSentences.length} sentence${longSentences.length === 1 ? ' is' : 's are'} longer than 25 words. Short sentences are easier to read.`);
  if (dashes) warnings.push('The written text has a dash or semicolon. Plain full stops read more naturally.');
  if (!fancy.length && !longSentences.length && !dashes) passed.push('Written text uses simple words and short sentences.');

  // 6. Conclusion is last and headings are in the fixed order
  const heads = doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  if (heads[heads.length - 1] !== HEADINGS.conclusion) errors.push('Conclusion is not the last section.');
  else passed.push('Conclusion is the last section.');

  return { errors, warnings, passed };
}

function describeKey(inputs, key) {
  if (key === 'background') return 'Background';
  if (key === 'conclusion') return 'Conclusion';
  const m = /^adv:([^:]+):(.+)$/.exec(key);
  const a = m && inputs.advisors.find((x) => x.id === m[1]);
  const nm = a ? a.name.trim() : 'advisor';
  if (m && m[2] === 'overview') return `${nm} - overview`;
  if (m && CATS[m[2]]) return `${nm} - ${CATS[m[2]]}`;
  return key;
}

// ---------- facts sent to the writer (names and numbers exactly as entered) ----------
export function buildAdvisorFacts(inputs, adv) {
  const L = [];
  const month = fmtMonthOnly(inputs.dataMonth);
  L.push(`Advisor: ${adv.name.trim()}`);
  L.push(`Pronoun to use: ${adv.pronoun === 'she' ? 'she / her' : 'he / him / his'}`);
  L.push(`Month of the data: ${month}`);
  L.push(`QA benchmark: ${String(inputs.benchmark).trim()}. Accepted blunder percentage limit: ${String(inputs.limit).trim()}%.`);
  if (!isBlank(adv.notes)) L.push(`Notes and instructions from the program manager: ${adv.notes.trim()}`);
  if (!isBlank(adv.evalStartDate)) L.push(`Evaluation start date: ${fmtDateLong(adv.evalStartDate)}`);
  activeCats(adv).forEach((k) => {
    const f = categoryFacts(inputs, adv, k);
    const c = adv.categories[k];
    L.push(`${f.label} (this month): QA Score ${f.score} over ${f.instances} instances; ${f.blunders} blunder instances = ${f.pct}.`
      + (f.gapH > 0 ? ` Below the benchmark by ${fmtHundredths(f.gapH)} points.` : ' At or above the benchmark.')
      + (f.overH > 0 ? ` Blunder percentage is ${fmtHundredths(f.overH)} points above the limit.` : ' Blunder percentage is within the limit.'));
    if (k === 'lead' && !isBlank(c.chatScore)) L.push(`  Lead Score chat: ${String(c.chatScore).trim()}${isBlank(c.chatInstances) ? '' : ` (${c.chatInstances} instances)`}`);
    if (k === 'lead' && !isBlank(c.callScore)) L.push(`  Lead Score call: ${String(c.callScore).trim()}${isBlank(c.callInstances) ? '' : ` (${c.callInstances} instances)`}`);
    if (!isBlank(c.currentScore)) L.push(`  ${f.label} current performance: ${String(c.currentScore).trim()}${isBlank(c.currentInstances) ? '' : ` over ${c.currentInstances} instances`}`);
  });
  (adv.trend || []).forEach((r) => {
    L.push(`Past month - ${r.month.trim()} - ${CATS[r.category]}: score ${isBlank(r.score) ? 'not available' : String(r.score).trim()}, instances ${isBlank(r.instances) ? 'not available' : String(r.instances).trim()}${isBlank(r.blunders) ? '' : `, blunder instances ${String(r.blunders).trim()}`}`);
  });
  (adv.blunderRows || []).forEach((r) => {
    L.push(`Blunder detail: ${fmtDateShort(r.date)}, chat ${r.chatId.trim()}, severity ${isBlank(r.severity) ? 'n/a' : String(r.severity).trim()}, marking: ${r.marking.trim()}${isBlank(r.comment) ? '' : `, comment: ${r.comment.trim()}`}`);
  });
  return L.join('\n');
}

export function buildSharedFacts(inputs) {
  const L = [`Request month: ${fmtMonthYear(inputs.requestMonth)}`, `Data month: ${fmtMonthOnly(inputs.dataMonth)}`,
    `QA benchmark: ${String(inputs.benchmark).trim()}. Accepted blunder percentage limit: ${String(inputs.limit).trim()}%.`,
    `Number of advisors: ${inputs.advisors.length}`];
  inputs.advisors.forEach((a) => {
    L.push('');
    L.push(`--- ${a.name.trim()} (${a.pronoun === 'she' ? 'she/her' : 'he/him'}) ---`);
    if (!isBlank(a.notes)) L.push(`Notes and instructions: ${a.notes.trim()}`);
    activeCats(a).forEach((k) => {
      const f = categoryFacts(inputs, a, k);
      L.push(`${f.label}: QA Score ${f.score}, ${f.instances} instances, blunder ${f.pct} (${f.blunders}/${f.instances}).`);
    });
  });
  return L.join('\n');
}
