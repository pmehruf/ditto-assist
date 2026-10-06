import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  blunderPctHundredths, fmtPct, fmtHundredths, parseDecimal, parseCount, validate, extractNumbers,
  allowedNumbers, fmtDateLong, fmtDateShort, fmtMonthYear, fmtMonthOnly, categoryFacts, emptyAdvisor, emptyCategory
} from './core';
import { sampleInputs } from './synthetic';

test('Blunder % = blunder instances / total instances, 2 decimals', () => {
  const cases = [[2, 10, '20.00%'], [17, 59, '28.81%'], [7, 25, '28.00%'], [5, 14, '35.71%'], [6, 13, '46.15%'], [0, 8, '0.00%'], [8, 8, '100.00%'], [1, 6, '16.67%'], [1, 3, '33.33%'], [2, 3, '66.67%'], [1, 16, '6.25%'], [1, 32, '3.13%'], [3, 8, '37.50%']];
  for (const [b, n, want] of cases) assert.equal(fmtPct(blunderPctHundredths(b, n)), want, `${b}/${n}`);
});
test('Blunder % rejects impossible input', () => {
  assert.equal(blunderPctHundredths(1, 0), null);
  assert.equal(blunderPctHundredths(-1, 5), null);
  assert.equal(blunderPctHundredths(1.5, 5), null);
});
test('number parsing is strict', () => {
  assert.equal(parseDecimal('3.5'), 350); assert.equal(parseDecimal('4'), 400); assert.equal(parseDecimal('3.456'), null); assert.equal(parseDecimal('abc'), null); assert.equal(parseDecimal('-1'), null);
  assert.equal(parseCount('12'), 12); assert.equal(parseCount('1.5'), null); assert.equal(parseCount(''), null);
});
test('gap from benchmark and over-limit use exact integer maths', () => {
  const i = sampleInputs();
  const f = categoryFacts(i, i.advisors[0], 'pay'); // 3.36 vs 3.5, 35.71% vs 25
  assert.equal(fmtHundredths(f.gapH), '0.14'); assert.equal(fmtHundredths(f.overH), '10.71');
  assert.equal(fmtHundredths(350 - 300), '0.5');
});
test('date and month formats', () => {
  assert.equal(fmtMonthYear('2026-08'), 'August 2026'); assert.equal(fmtMonthOnly('2026-07'), 'July');
  assert.equal(fmtDateLong('2026-01-12'), '12 January 2026'); assert.equal(fmtDateShort('2026-01-12'), '12/01/26');
  assert.equal(fmtDateLong('2026-02-30'), '');
});
test('valid sample passes validation', () => assert.deepEqual(validate(sampleInputs()), []));
test('validation catches each required field', () => {
  const i = sampleInputs();
  const a = i.advisors[0];
  a.name = ''; a.pronoun = ''; a.categories.pay.score = ''; a.categories.pay.instances = '0'; a.categories.lead.blunders = '99';
  i.requestMonth = ''; i.benchmark = 'x';
  const msgs = validate(i).map((e) => e.msg).join('\n');
  for (const s of ['Request month is required', 'benchmark must be a number', 'name is required', 'choose he or she', 'Payments QA Score is required', 'total instances must be a whole number of 1 or more', 'cannot be more than total instances']) assert.match(msgs, new RegExp(s), s);
});
test('no category selected is an error; both categories are allowed', () => {
  const i = sampleInputs(); i.advisors[1].categories.pay.on = false;
  assert.match(validate(i).map((e) => e.msg).join(), /select at least one category/);
  const j = sampleInputs(); assert.equal(Object.values(j.advisors[0].categories).filter((c: any) => c.on).length, 2); assert.deepEqual(validate(j), []);
});
test('duplicate advisor names and bad dates are caught', () => {
  const i = sampleInputs(); i.advisors[1].name = 'test advisor one'; i.advisors[0].evalStartDate = '2026-13-01';
  const msgs = validate(i).map((e) => e.msg).join('\n');
  assert.match(msgs, /entered twice/); assert.match(msgs, /evaluation start date is not a valid date/);
});
test('past-months rows are checked', () => {
  const i = sampleInputs(); i.advisors[0].trend.push({ category: 'pay', month: '', score: '', instances: '', blunders: '' }, { category: 'pay', month: 'May', score: '3.5', instances: '4', blunders: '9' });
  const msgs = validate(i).map((e) => e.msg).join('\n');
  assert.match(msgs, /month is required/); assert.match(msgs, /blunder instances cannot be more than total/);
});
test('number extraction normalises 07-01-2026 / 4.40 / 5th', () => {
  assert.deepEqual(extractNumbers('07-01-2026'), ['7', '1', '2026']); assert.deepEqual(extractNumbers('4.40 and 5th'), ['4.4', '5']);
});
test('allowed numbers include inputs and calculated values only', () => {
  const s = allowedNumbers(sampleInputs());
  for (const n of ['3.36', '14', '35.71', '0.14', '10.71', '5', '2026']) assert.ok(s.has(n), n);
  assert.ok(!s.has('99'));
});
