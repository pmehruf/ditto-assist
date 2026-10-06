// Core rules: calculations, formatting, validation, number checks.
// Pure functions only (no browser or Node specific code) so the same file runs in the page and in the tests.

export const CATS = { lead: 'Lead Score', pay: 'Payments' };
export const CAT_KEYS = ['lead', 'pay'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// ---------- parsing ----------
export function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

// Decimal with at most 2 places, e.g. 3.5, 4.05, 25
export function parseDecimal(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100); // hundredths, integer
}
export function parseCount(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

// ---------- calculations (integer maths, no floating point surprises) ----------
// Blunder % = blunder instances / total instances, as hundredths of a percent (2 decimals)
export function blunderPctHundredths(blunders, instances) {
  if (!Number.isInteger(blunders) || !Number.isInteger(instances) || instances <= 0 || blunders < 0) return null;
  return Math.round((blunders * 10000) / instances);
}
export function fmtHundredths(h, fixed2 = false) {
  const neg = h < 0;
  const a = Math.abs(h);
  const whole = Math.floor(a / 100);
  const frac = String(a % 100).padStart(2, '0');
  const s = fixed2 ? `${whole}.${frac}` : (frac === '00' ? `${whole}` : (frac.endsWith('0') ? `${whole}.${frac[0]}` : `${whole}.${frac}`));
  return (neg ? '-' : '') + s;
}
export function fmtPct(h) { return fmtHundredths(h, true) + '%'; }
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- date / month formatting ----------
export function fmtMonthYear(iso) { // 2026-08 -> August 2026
  const m = /^(\d{4})-(\d{2})$/.exec(iso || ''); if (!m) return '';
  return `${MONTHS[+m[2] - 1]} ${m[1]}`;
}
export function fmtMonthOnly(iso) { // 2026-07 -> July
  const m = /^(\d{4})-(\d{2})$/.exec(iso || ''); if (!m) return '';
  return MONTHS[+m[2] - 1];
}
export function validIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export function fmtDateLong(iso) { // 12 January 2026
  if (!validIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function fmtDateShort(iso) { // 12/01/26
  if (!validIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

// ---------- empty shapes (used by the form and the tests) ----------
export function emptyCategory() {
  return { on: false, score: '', instances: '', blunders: '', chatScore: '', chatInstances: '', callScore: '', callInstances: '', currentScore: '', currentInstances: '' };
}
export function emptyAdvisor(id) {
  return {
    id: id || 'a' + Math.random().toString(36).slice(2, 8),
    name: '', pronoun: '',
    categories: { lead: emptyCategory(), pay: emptyCategory() },
    notes: '', evalStartDate: '',
    trend: [], blunderRows: []
  };
}
export function emptyInputs() {
  return { requestMonth: '', dataMonth: '', benchmark: '3.5', limit: '25', advisors: [] };
}

export const activeCats = (adv) => CAT_KEYS.filter((k) => adv.categories?.[k]?.on);

// ---------- per-category facts, calculated once and used everywhere ----------
export function categoryFacts(inputs, adv, key) {
  const c = adv.categories[key];
  const bench = parseDecimal(inputs.benchmark);
  const limit = parseDecimal(inputs.limit);
  const score = parseDecimal(c.score);
  const n = parseCount(c.instances);
  const b = parseCount(c.blunders);
  const pctH = blunderPctHundredths(b, n);
  return {
    key, label: CATS[key],
    score: String(c.score).trim(), scoreH: score, instances: n, blunders: b,
    pctH, pct: pctH === null ? null : fmtPct(pctH),
    gapH: score === null || bench === null ? null : bench - score,          // positive = below benchmark
    overH: pctH === null || limit === null ? null : pctH - limit            // positive = above limit
  };
}

// ---------- validation ----------
export function validate(inputs) {
  const errors = [];
  const err = (path, msg) => errors.push({ path, msg });

  if (isBlank(inputs.requestMonth)) err('requestMonth', 'Request month is required.');
  else if (!/^\d{4}-\d{2}$/.test(inputs.requestMonth)) err('requestMonth', 'Request month must be a valid month.');
  if (isBlank(inputs.dataMonth)) err('dataMonth', 'Data month is required.');
  else if (!/^\d{4}-\d{2}$/.test(inputs.dataMonth)) err('dataMonth', 'Data month must be a valid month.');
  const bench = parseDecimal(inputs.benchmark);
  if (bench === null || bench > 500) err('benchmark', 'QA benchmark must be a number with at most 2 decimals.');
  const limit = parseDecimal(inputs.limit);
  if (limit === null || limit > 10000) err('limit', 'Blunder % limit must be a number with at most 2 decimals.');

  const advisors = inputs.advisors || [];
  if (advisors.length === 0) err('advisors', 'Add at least one advisor.');

  const seen = new Set();
  advisors.forEach((a, i) => {
    const p = `advisors[${i}]`;
    const who = isBlank(a.name) ? `Advisor ${i + 1}` : a.name.trim();
    const E = (f, m) => err(`${p}.${f}`, `${who}: ${m}`);

    if (isBlank(a.name)) E('name', 'name is required.');
    else {
      const k = a.name.trim().toLowerCase();
      if (seen.has(k)) E('name', 'this name is entered twice.');
      seen.add(k);
    }
    if (a.pronoun !== 'he' && a.pronoun !== 'she') E('pronoun', 'choose he or she.');
    const cats = activeCats(a);
    if (cats.length === 0) E('categories', 'select at least one category (Lead Score and/or Payments).');

    cats.forEach((k) => {
      const c = a.categories[k];
      const L = CATS[k];
      const sc = parseDecimal(c.score);
      if (isBlank(c.score)) E(`${k}.score`, `${L} QA Score is required.`);
      else if (sc === null) E(`${k}.score`, `${L} QA Score must be a number with at most 2 decimals (e.g. 3.42).`);
      else if (sc > 500) E(`${k}.score`, `${L} QA Score cannot be more than 5.`);
      const n = parseCount(c.instances);
      if (isBlank(c.instances)) E(`${k}.instances`, `${L} total instances is required.`);
      else if (n === null || n < 1) E(`${k}.instances`, `${L} total instances must be a whole number of 1 or more.`);
      const b = parseCount(c.blunders);
      if (isBlank(c.blunders)) E(`${k}.blunders`, `${L} blunder instances is required.`);
      else if (b === null) E(`${k}.blunders`, `${L} blunder instances must be a whole number (0 or more).`);
      else if (n !== null && b > n) E(`${k}.blunders`, `${L} blunder instances (${b}) cannot be more than total instances (${n}).`);
      // optional current-month update and chat/call split
      if (!isBlank(c.currentScore) && (parseDecimal(c.currentScore) === null || parseDecimal(c.currentScore) > 500)) E(`${k}.currentScore`, `${L} current score must be a number.`);
      if (!isBlank(c.currentInstances) && parseCount(c.currentInstances) === null) E(`${k}.currentInstances`, `${L} current instances must be a whole number.`);
      if (!isBlank(c.currentInstances) && isBlank(c.currentScore)) E(`${k}.currentScore`, `${L} current score is needed when current instances are entered.`);
      if (k === 'lead') {
        for (const [f, nm] of [['chatScore', 'Chat score'], ['callScore', 'Call score']]) {
          if (!isBlank(c[f]) && (parseDecimal(c[f]) === null || parseDecimal(c[f]) > 500)) E(`lead.${f}`, `${nm} must be a number.`);
        }
        for (const [f, nm, sf] of [['chatInstances', 'Chat instances', 'chatScore'], ['callInstances', 'Call instances', 'callScore']]) {
          if (!isBlank(c[f]) && parseCount(c[f]) === null) E(`lead.${f}`, `${nm} must be a whole number.`);
          if (!isBlank(c[f]) && isBlank(c[sf])) E(`lead.${sf}`, `${nm} entered without the matching score.`);
        }
      }
    });

    if (!isBlank(a.evalStartDate) && !validIsoDate(a.evalStartDate)) E('evalStartDate', 'evaluation start date is not a valid date.');

    (a.trend || []).forEach((r, j) => {
      const T = (m) => E(`trend[${j}]`, `past-months row ${j + 1}: ${m}`);
      if (isBlank(r.month)) T('month is required.');
      if (r.category !== 'lead' && r.category !== 'pay') T('choose a category.');
      else if (!a.categories[r.category]?.on) T(`category ${CATS[r.category]} is not selected for this advisor.`);
      if (!isBlank(r.score) && (parseDecimal(r.score) === null || parseDecimal(r.score) > 500)) T('QA Score must be a number.');
      if (!isBlank(r.instances) && parseCount(r.instances) === null) T('instances must be a whole number.');
      if (!isBlank(r.blunders)) {
        if (parseCount(r.blunders) === null) T('blunder instances must be a whole number.');
        else if (isBlank(r.instances)) T('blunder instances need total instances.');
        else if (parseCount(r.instances) !== null && parseCount(r.blunders) > parseCount(r.instances)) T('blunder instances cannot be more than total instances.');
      }
      if (isBlank(r.score) && isBlank(r.instances) && isBlank(r.blunders)) T('enter at least a score or instances (or remove the row).');
    });

    const seenTrend = new Set();
    (a.trend || []).forEach((r) => {
      const key = `${r.category}|${String(r.month).trim().toLowerCase()}`;
      if (!isBlank(r.month) && seenTrend.has(key)) E('trend', `${CATS[r.category] || 'category'} past month ${r.month.trim()} is entered twice.`);
      seenTrend.add(key);
    });

    (a.blunderRows || []).forEach((r, j) => {
      const T = (m) => E(`blunderRows[${j}]`, `blunder detail row ${j + 1}: ${m}`);
      if (!validIsoDate(r.date)) T('date of marking is required.');
      if (isBlank(r.chatId)) T('chat ID is required.');
      if (isBlank(r.marking)) T('marking is required.');
    });
  });
  return errors;
}

// ---------- numbers ----------
export function extractNumbers(text) {
  const out = [];
  const re = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(Number(m[0]).toString());
  return out;
}
function walkStrings(v, fn, key = '') {
  if (v === null || v === undefined) return;
  if (typeof v === 'string') { if (key !== 'id') fn(v); return; }
  if (typeof v === 'number') { fn(String(v)); return; }
  if (Array.isArray(v)) { v.forEach((x) => walkStrings(x, fn, key)); return; }
  if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, fn, k);
}
// Every number the writer is allowed to mention: typed by the user, or calculated by the tool.
export function allowedNumbers(inputs) {
  const set = new Set();
  walkStrings(inputs, (s) => extractNumbers(s).forEach((n) => set.add(n)));
  set.add(String((inputs.advisors || []).length));
  (inputs.advisors || []).forEach((a) => {
    activeCats(a).forEach((k) => {
      const f = categoryFacts(inputs, a, k);
      if (f.pctH !== null) { extractNumbers(fmtPct(f.pctH)).forEach((n) => set.add(n)); }
      if (f.gapH !== null) extractNumbers(fmtHundredths(Math.abs(f.gapH))).forEach((n) => set.add(n));
      if (f.overH !== null) extractNumbers(fmtHundredths(Math.abs(f.overH))).forEach((n) => set.add(n));
    });
  });
  return set;
}
