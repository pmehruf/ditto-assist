// Made-up data only (no real people). Ported from the standalone QIP Exception Doc Generator tests.
// Made-up data only (no real people). Used by tests that must run anywhere, including the public repository.
import { emptyAdvisor, emptyCategory, emptyInputs } from './core';

export function sampleInputs() {
  const i = emptyInputs();
  i.requestMonth = '2026-08'; i.dataMonth = '2026-07';
  const a = emptyAdvisor('adv1');
  a.name = 'Test Advisor One'; a.pronoun = 'she';
  a.categories.pay = { ...emptyCategory(), on: true, score: '3.36', instances: '14', blunders: '5', currentScore: '4.1', currentInstances: '6' };
  a.categories.lead = { ...emptyCategory(), on: true, score: '3.42', instances: '59', blunders: '17', chatScore: '3.65', chatInstances: '52', callScore: '3.72', callInstances: '37' };
  a.notes = 'Newer to payments, missed benchmark narrowly. Mention that feedback was shared on 5 August.';
  
  a.evalStartDate = '2025-10-30';
  a.trend = [
    { category: 'pay', month: 'June', score: '4.17', instances: '18', blunders: '2' },
    { category: 'pay', month: 'May', score: '3.5', instances: '12', blunders: '' },
    { category: 'lead', month: 'June', score: '3.9', instances: '40', blunders: '8' }
  ];
  a.blunderRows = [{ date: '2026-07-12', chatId: 'CH000111', severity: '2', marking: 'Consent not taken', comment: 'Rescheduled payment' }];
  const b = emptyAdvisor('adv2');
  b.name = 'Test Advisor Two'; b.pronoun = 'he';
  b.categories.pay = { ...emptyCategory(), on: true, score: '3.15', instances: '13', blunders: '6' };
  b.notes = 'Mistakes were around one narrative point that is now clarified.';
  i.advisors.push(a, b);
  return i;
}

export function sampleAi() {
  return {
    background: ['Both advisors are close to the benchmark.', 'Recent months show improvement.'],
    conclusion: ['Considering the gap from benchmark and the recent trend, these look like temporary dips.'],
    advisors: {
      adv1: { overview: ['She is newer to payments.'], lead: ['Chat and call both look stable.'], pay: ['Feedback shared on 5 August.'] },
      adv2: { overview: [], lead: [], pay: ['The point is clarified and being monitored.'] }
    }
  };
}
