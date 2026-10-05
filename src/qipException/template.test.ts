import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildDocument, checkOutput, documentText, HEADINGS, calculatedLines, aiKey, buildAdvisorFacts, buildSharedFacts } from './template';
import { sampleInputs, sampleAi } from './synthetic';

const heads = (d) => d.blocks.filter((b) => b.type === 'heading').map((b) => b.text);

test('fixed headings appear in the fixed order, Conclusion last', () => {
  const d = buildDocument(sampleInputs(), sampleAi());
  assert.deepEqual(heads(d), ['Background', 'QIP Analysis Data – July', 'Individual Analysis and Overview', 'Performance Trend', 'Current Performance', 'Conclusion']);
  assert.equal(d.blocks[0].text, 'QIP Exception Request | August 2026');
});
test('opening sentence uses the wording of the past documents (one and several advisors)', () => {
  const i = sampleInputs(); const d = buildDocument(i, sampleAi());
  assert.equal(d.blocks[1].runs[0].text, "We'd like to request an exception to the QIP process for two of our advisors: Test Advisor One and Test Advisor Two.");
  i.advisors.pop(); assert.equal(buildDocument(i, sampleAi()).blocks[1].runs[0].text, "We'd like to request an exception to the QIP process for Test Advisor One.");
});
test('closing sentence differs for one vs several advisors', () => {
  const i = sampleInputs(); const last = (d) => d.blocks[d.blocks.length - 1].runs[0].text;
  assert.equal(last(buildDocument(i, sampleAi())), 'I would like to request a QIP exception review for the above advisors.');
  i.advisors.pop(); assert.equal(last(buildDocument(i, sampleAi())), "Hence, we are requesting an exception from QIP considering the advisor's overall quality track record.");
});
test('analysis table: one row per advisor per category, blunder % calculated', () => {
  const t = buildDocument(sampleInputs(), sampleAi()).blocks.find((b) => b.id === 'analysis');
  assert.deepEqual(t.headers, ['Advisor', 'QA Score', 'Instances', 'Category', 'Blunder %']);
  assert.deepEqual(t.rows, [['Test Advisor One', '3.42', '59', 'Lead Score', '28.81% (17/59)'], ['Test Advisor One', '3.36', '14', 'Payments', '35.71% (5/14)'], ['Test Advisor Two', '3.15', '13', 'Payments', '46.15% (6/13)']]);
});
test('both categories get their own subsection; one category gets none', () => {
  const d = buildDocument(sampleInputs(), sampleAi());
  const paras = d.blocks.filter((b) => b.type === 'para').map((b) => b.runs[0].text);
  assert.equal(paras.filter((t) => t === 'Lead Score').length, 2); assert.equal(paras.filter((t) => t === 'Payments').length, 2); // one subsection label + one trend-table label each
  assert.ok(d.blocks.some((b) => b.id === 'trend:lead') && d.blocks.some((b) => b.id === 'trend:pay'));
  assert.ok(d.blocks.some((b) => b.ai === aiKey.cat('adv1', 'lead')) && d.blocks.some((b) => b.ai === aiKey.cat('adv1', 'pay')));
  assert.ok(!d.blocks.some((b) => b.ai === aiKey.cat('adv2', 'lead')));
});
test('calculated lines: below benchmark, at/above benchmark, within and above blunder limit', () => {
  const i = sampleInputs(); const a = i.advisors[0];
  assert.deepEqual(calculatedLines(i, a, 'pay').slice(0, 2), ['Missed the QA benchmark of 3.5 by 0.14 points over 14 instances.', 'Blunder% is 35.71%, which is 10.71 points above the accepted limit of 25%.']);
  a.categories.pay.score = '3.5'; a.categories.pay.blunders = '3'; // 21.43%
  assert.deepEqual(calculatedLines(i, a, 'pay').slice(0, 2), ['Payments QA Score of 3.5 is at or above the QA benchmark of 3.5 over 14 instances.', 'Blunder% is within acceptable range (21.43% against the 25% limit).']);
  a.categories.pay.score = '3.49'; a.categories.pay.instances = '1'; a.categories.pay.blunders = '0';
  assert.match(calculatedLines(i, a, 'pay')[0], /by 0.01 points over 1 instance\./);
});
test('exactly 25% counts as within the limit', () => {
  const i = sampleInputs(); const a = i.advisors[1]; a.categories.pay.instances = '8'; a.categories.pay.blunders = '2';
  assert.match(calculatedLines(i, a, 'pay')[1], /within acceptable range \(25.00% against the 25% limit\)/);
});
test('all checks pass on a clean document', () => {
  const i = sampleInputs(); const r = checkOutput(i, buildDocument(i, sampleAi()));
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []); assert.equal(r.passed.length, 7);
});
test('check: an invented number in the written text is an error', () => {
  const i = sampleInputs(); const ai = sampleAi(); ai.advisors.adv1.pay = ['She handled 77 payments.'];
  const r = checkOutput(i, buildDocument(i, ai)); assert.match(r.errors.join('\n'), /77/);
});
test('check: numbers typed by the user in Additional Instructions are allowed', () => {
  const i = sampleInputs(); const ai = sampleAi(); ai.advisors.adv1.pay = ['Feedback was shared on 5 August.'];
  assert.deepEqual(checkOutput(i, buildDocument(i, ai)).errors, []);
});
test('check: empty written section is an error', () => {
  const i = sampleInputs(); const ai = sampleAi(); ai.conclusion = []; ai.advisors.adv2.pay = [];
  const e = checkOutput(i, buildDocument(i, ai)).errors.join('\n'); assert.match(e, /Conclusion/); assert.match(e, /Test Advisor Two - Payments/);
});
test('check: tampered table value is detected', () => {
  const i = sampleInputs(); const d = buildDocument(i, sampleAi());
  d.blocks.find((b) => b.id === 'analysis').rows[0][1] = '3.52';
  assert.match(checkOutput(i, d).errors.join('\n'), /does not match the input/);
  const d2 = buildDocument(i, sampleAi()); d2.blocks.find((b) => b.id === 'analysis').rows.pop();
  assert.match(checkOutput(i, d2).errors.join('\n'), /no Payments row/);
});
test('check: placeholder text and wrong pronouns', () => {
  const i = sampleInputs(); const ai = sampleAi(); ai.advisors.adv1.overview = ['[insert reason]']; ai.advisors.adv2.pay = ['She is improving.'];
  const r = checkOutput(i, buildDocument(i, ai)); assert.match(r.errors.join('\n'), /Placeholder/); assert.match(r.warnings.join('\n'), /Test Advisor Two/);
});
test('past-months table shows NA for blanks and adds Blunder % only when entered', () => {
  const i = sampleInputs(); const t = buildDocument(i, sampleAi()).blocks.find((b) => b.id === 'trend:pay');
  assert.deepEqual(t.headers.at(-1), 'Blunder %'); assert.deepEqual(t.rows[0], ['Test Advisor One', 'Payments', 'June', '4.17', '18', '11.11% (2/18)']); assert.equal(t.rows[1][5], 'NA');
  i.advisors[0].trend.forEach((r) => { r.blunders = ''; });
  assert.ok(!buildDocument(i, sampleAi()).blocks.find((b) => b.id === 'trend:pay').headers.includes('Blunder %'));
});
test('optional sections vanish when empty', () => {
  const i = sampleInputs(); const a = i.advisors[0]; a.trend = []; a.blunderRows = []; a.categories.pay.currentScore = ''; a.categories.pay.currentInstances = '';
  const h = heads(buildDocument(i, sampleAi())); for (const x of ['Performance Trend', 'Current Performance']) assert.ok(!h.includes(x), x);
});
test('words that only appear in the template come from the approved wording', () => {
  const text = documentText(buildDocument(sampleInputs(), sampleAi()));
  assert.ok(!/QAP|PIP|\bInst\b|\bLS\b/.test(text));
});
test('facts sent to the writer carry real names and the exact numbers', () => {
  const i = sampleInputs(); const f = buildAdvisorFacts(i, i.advisors[0]);
  for (const s of ['Test Advisor One', 'she / her', '35.71%', 'Mention that feedback was shared on 5 August.']) assert.ok(f.includes(s), s);
  assert.ok(!/data:image/.test(f));
  assert.ok(buildSharedFacts(i).includes('Test Advisor Two'));
});

test('plain-language check warns about fancy words, long sentences and dashes', () => {
  const i = sampleInputs(); const ai = sampleAi();
  ai.background = ['We will leverage her strong trajectory; furthermore she demonstrates growth.'];
  ai.conclusion = ['This is a sentence that goes on and on with many many words so that it is clearly far too long for anyone to read comfortably in one go today.'];
  const w = checkOutput(i, buildDocument(i, ai)).warnings.join('\n');
  assert.match(w, /leverage/); assert.match(w, /trajectory/); assert.match(w, /furthermore/); assert.match(w, /longer than 25 words/); assert.match(w, /dash or semicolon/);
  assert.ok(checkOutput(i, buildDocument(i, sampleAi())).passed.some((x) => /simple words/.test(x)));
});
