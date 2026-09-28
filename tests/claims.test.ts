// Metrics -> commentary control on hand-written sentences: legitimate claims must pass, wrong ones must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics } from '../src/engine.ts';
import { checkDraft } from '../src/claims.ts';

const s = loadSources();
const open = computeMetrics(s, { accrual: 'open' });
const approved = computeMetrics(s, { accrual: 'approved' });
const one = (txt: string, ms = open) => checkDraft(txt, ms, ms.snapshotFingerprint).sentences[0];

export const LEGIT: [string, 'open' | 'approved'][] = [
  ['August revenue was [[revenue.month.actual]], [[revenue.month.vs_budget_pct]] ahead of budget and [[revenue.month.vs_py_pct]] up on August 2025.', 'open'],
  ['Gross margin for August was [[gross_margin.month.actual]], [[gross_margin.month.vs_budget_pp]] above the budgeted [[gross_margin.month.budget]].', 'open'],
  ['In August, revenue of [[revenue.month.actual]] came in above budget by [[revenue.month.vs_budget]] ([[revenue.month.vs_budget_pct]]).', 'open'],
  ['Year to date, revenue of [[revenue.ytd.actual]] is [[revenue.ytd.vs_budget]] ahead of budget and [[revenue.ytd.vs_py]] up on last year.', 'open'],
  ['Operating profit for August was [[operating_profit.month.actual]], above budget by [[operating_profit.month.vs_budget]] and up on last year by [[operating_profit.month.vs_py]].', 'open'],
  ['August overheads of [[overheads.month.actual]] were below budget by [[overheads.month.vs_budget]] but above last year by [[overheads.month.vs_py]].', 'open'],
  ['Orchard Lane Foods accounted for [[client.orchard-lane.share.month.actual]] of agency revenue in August.', 'open'],
  ['Marlow & Finch billed [[client.marlow-finch.revenue.month.actual]] in August, [[client.marlow-finch.revenue.month.vs_avg3m_pct]] below its May to July average.', 'open'],
  ['Year to date, Orchard Lane Foods accounts for [[client.orchard-lane.share.ytd.actual]] of revenue.', 'open'],
  ['In August, direct costs of [[direct_costs.month.actual]] were [[direct_costs.month.vs_budget]] above budget.', 'open'],
  ['August gross margin was [[gross_margin.month.actual]], below budget by [[gross_margin.month.vs_budget_pp]] and below last year by [[gross_margin.month.vs_py_pp]].', 'approved'],
  ['Year to date, gross margin of [[gross_margin.ytd.actual]] is in line with budget.', 'approved'],
  ['Year to date, gross margin is in line with budget at [[gross_margin.ytd.actual]], a difference of [[gross_margin.ytd.vs_budget_pp]].', 'approved'],
  ['In August, gross profit of [[gross_profit.month.actual]] was [[gross_profit.month.vs_budget]] short of budget.', 'approved'],
  ['August operating profit fell [[operating_profit.month.vs_py]] short of last year, at [[operating_profit.month.actual]].', 'approved'],
  ['Direct costs in August rose to [[direct_costs.month.actual]], above budget by [[direct_costs.month.vs_budget_pct]].', 'approved'],
  ['Kestrel Mobility billed [[client.kestrel.revenue.month.actual]] in August, above its May to July average by [[client.kestrel.revenue.month.vs_avg3m]].', 'approved'],
  ['August operating profit of [[operating_profit.month.actual]] was adverse to budget by [[operating_profit.month.vs_budget]].', 'approved'],
  ['Overheads in August were favourable to budget by [[overheads.month.vs_budget]].', 'approved'],
  ['Year to date, operating profit of [[operating_profit.ytd.actual]] is above budget by [[operating_profit.ytd.vs_budget]] ([[operating_profit.ytd.vs_budget_pct]]).', 'approved'],
];

export const WRONG: [string, string, 'open' | 'approved'][] = [
  ['direction flipped', 'August revenue was [[revenue.month.vs_budget_pct]] below budget.', 'open'],
  ['comparator swapped', 'August revenue was [[revenue.month.vs_py_pct]] ahead of budget.', 'open'],
  ['period swapped', 'In August, revenue was [[revenue.ytd.actual]].', 'open'],
  ['period swapped (variance)', 'Year to date, revenue is [[revenue.month.vs_budget]] ahead of budget.', 'open'],
  ['measure swapped', 'August gross profit was [[revenue.month.actual]].', 'open'],
  ['measure swapped (variance)', 'August gross margin was above budget by [[gross_profit.month.vs_budget_pct]].', 'open'],
  ['client swapped', 'Kestrel Mobility billed [[client.marlow-finch.revenue.month.actual]] in August.', 'open'],
  ['client figure as agency total', 'Total revenue in August was [[client.orchard-lane.revenue.month.actual]].', 'open'],
  ['agency figure as client figure', 'Marlow & Finch billed [[revenue.month.actual]] in August.', 'open'],
  ['typed figure', 'August revenue was £200,000, above budget.', 'open'],
  ['typed percentage', 'August gross margin was 40%.', 'open'],
  ['unit by hand', 'August revenue was [[revenue.month.vs_budget_pct]] percent above budget.', 'open'],
  ['unapproved figure as fact', 'August gross margin was [[gross_margin.month.actual@proposed]].', 'open'],
  ['no direction on a variance', 'August revenue differed from budget by [[revenue.month.vs_budget]].', 'open'],
  ['no comparator on a variance', 'August revenue was up by [[revenue.month.vs_budget]].', 'open'],
  ['excluded magnitude word', 'August operating profit nearly doubled on last year to [[operating_profit.month.actual]].', 'open'],
  ['in line when not', 'August gross margin was in line with budget at [[gross_margin.month.actual]], a difference of [[gross_margin.month.vs_budget_pp]].', 'open'],
  ['above when nil', 'Year to date, gross margin was above budget by [[gross_margin.ytd.vs_budget_pp]].', 'approved'],
  ['favourable when adverse', 'August operating profit was favourable to budget by [[operating_profit.month.vs_budget]].', 'approved'],
  ['level with wrong implied direction', 'August gross margin fell to [[gross_margin.month.actual]] against budget.', 'open'],
  ['stale posted draft after approval', 'August gross margin was [[gross_margin.month.actual]], [[gross_margin.month.vs_budget_pp]] above budget.', 'approved'],
  ['unknown reference', 'August revenue was [[revenue.month.actuals]].', 'open'],
];

for (const [txt, st] of LEGIT) {
  test(`passes: ${txt.slice(0, 70)}`, () => {
    const r = one(txt, st === 'open' ? open : approved);
    assert.equal(r.status, 'verified', JSON.stringify(r.findings));
  });
}
for (const [name, txt, st] of WRONG) {
  test(`fails: ${name}`, () => {
    const r = one(txt, st === 'open' ? open : approved);
    assert.equal(r.status, 'fail', `${r.rendered} ${JSON.stringify(r.findings)}`);
  });
}

test('causal and advisory statements are left for the reviewer, never ticked', () => {
  assert.equal(one('August revenue was [[revenue.month.vs_budget_pct]] above budget, driven by Orchard Lane Foods.').status, 'review');
  assert.equal(one('The owner should watch Marlow & Finch closely next month.').status, 'review');
  assert.equal(one('The agency had a busy month.').status, 'review');
});

test('a proposed figure stated conditionally goes to the reviewer', () => {
  assert.equal(one('If the accrual is approved, August gross margin would be [[gross_margin.month.actual@proposed]].').status, 'review');
});

test('a material adverse movement left out is an omission that fails the draft', () => {
  const r = checkDraft('August revenue was [[revenue.month.actual]], [[revenue.month.vs_budget_pct]] ahead of budget.', approved, approved.snapshotFingerprint);
  assert.ok(r.omissions.some((o) => o.severity === 'fail' && /gross margin/.test(o.message)));
});

test('a draft written for another snapshot is stale', () => {
  const r = checkDraft('August revenue was [[revenue.month.actual]].', approved, open.snapshotFingerprint);
  assert.equal(r.stale, true);
});

// Sentences a fresh reviewer wrote to break the checker (28/09). None may get a tick: rejected or sent to the reviewer.
export const NOT_TICKED: [string, string, 'open' | 'approved', 'fail' | 'review' | 'either'][] = [
  ['ranking', 'Marlow & Finch remained the largest client in August at [[client.marlow-finch.share.month.actual]] of agency revenue.', 'open', 'review'],
  ['same amount', 'August revenue was above budget by [[revenue.month.vs_budget_pct]] and above last year by the same amount.', 'open', 'either'],
  ['month outside the snapshot', 'August revenue was [[revenue.month.vs_py_pct]] above September last year.', 'open', 'fail'],
  ['negation', 'August operating profit was not below budget by [[operating_profit.month.vs_budget]].', 'approved', 'either'],
  ['two clients, unlike', 'Marlow & Finch, unlike Orchard Lane Foods, billed [[client.orchard-lane.revenue.month.actual]] in August.', 'open', 'review'],
  ['negation against budget', 'Revenue grew [[revenue.month.vs_py_pct]] year on year in August, but not against budget.', 'open', 'review'],
  ['measure not calculated', 'August revenue per head was [[revenue.month.actual]].', 'open', 'fail'],
  ['first', 'In August, operating profit fell short of budget by [[operating_profit.month.vs_budget]], the first shortfall this year.', 'approved', 'review'],
  ['advice', 'Marlow & Finch billed [[client.marlow-finch.revenue.month.actual]] in August, which the owner may wish to review.', 'open', 'review'],
  ['judgement', 'Year to date the picture is stronger, with revenue of [[revenue.ytd.actual]] above budget by [[revenue.ytd.vs_budget]].', 'approved', 'review'],
  ["contraction negation", "August revenue wasn't below budget by [[revenue.month.vs_budget]].", 'open', 'either'],
  ['degree word', 'August operating profit was slightly down on last year by [[operating_profit.month.vs_py]].', 'approved', 'review'],
];
for (const [name, txt, st, want] of NOT_TICKED) {
  test(`not ticked: ${name}`, () => {
    const r = one(txt, st === 'open' ? open : approved);
    assert.notEqual(r.status, 'verified', r.rendered);
    if (want !== 'either') assert.equal(r.status, want, `${r.rendered} ${JSON.stringify(r.findings)}`);
  });
}
