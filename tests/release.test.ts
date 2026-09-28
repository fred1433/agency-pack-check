// Release control: what stops a draft leaving the firm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics, sourceChecks, type Decisions } from '../src/engine.ts';
import { checkDraft } from '../src/claims.ts';
import { releaseGates, canRelease, canSignOff, type ReleaseState } from '../src/release.ts';

const s = loadSources();
const GOOD_APPROVED = 'August revenue was [[revenue.month.actual]], [[revenue.month.vs_budget_pct]] ahead of budget. August gross margin was [[gross_margin.month.actual]], below budget by [[gross_margin.month.vs_budget_pp]]. Marlow & Finch billed [[client.marlow-finch.revenue.month.actual]] in August, [[client.marlow-finch.revenue.month.vs_avg3m_pct]] below its May to July average. Orchard Lane Foods accounted for [[client.orchard-lane.share.month.actual]] of August revenue.';
const GOOD_POSTED = GOOD_APPROVED.replace('below budget by [[gross_margin.month.vs_budget_pp]]', 'above budget by [[gross_margin.month.vs_budget_pp]]');

function state(d: Decisions, markup: string, draftFor: Decisions, reviewed = new Set<number>()): ReleaseState {
  const ms = computeMetrics(s, d);
  const { checks, questions } = sourceChecks(s, d);
  const draft = checkDraft(markup, ms, computeMetrics(s, draftFor).snapshotFingerprint);
  return { checks, questions, draft, snapshotFingerprint: ms.snapshotFingerprint, reviewed, signoff: null };
}
const sign = (st: ReleaseState): ReleaseState => ({ ...st, signoff: { by: 'Reviewer', at: '2026-09-03T10:00:00Z', snapshotFingerprint: st.snapshotFingerprint, draftFingerprint: st.draft.draftFingerprint } });

test('a numerically correct draft cannot leave while the close question is open', () => {
  const st = state({ accrual: 'open' }, GOOD_POSTED, { accrual: 'open' });
  assert.equal(st.draft.counts.fail, 0, JSON.stringify(st.draft.sentences.map((x) => x.findings)));
  assert.equal(canSignOff(st), false);
  assert.equal(canRelease(sign(st)), false);
  assert.equal(releaseGates(st)[1].ok, false);
});

test('holding the question keeps the draft blocked', () => {
  assert.equal(canSignOff(state({ accrual: 'held' }, GOOD_POSTED, { accrual: 'held' })), false);
});

test('after approval, the old draft is stale and fails its margin claim', () => {
  const st = state({ accrual: 'approved' }, GOOD_POSTED, { accrual: 'open' });
  assert.equal(st.draft.stale, true);
  assert.ok(st.draft.counts.fail >= 1);
  assert.equal(canSignOff(st), false);
});

test('the draft written for the approved snapshot can be signed off and released', () => {
  const st = state({ accrual: 'approved' }, GOOD_APPROVED, { accrual: 'approved' });
  assert.equal(canSignOff(st), true, JSON.stringify(releaseGates(st)));
  assert.equal(canRelease(st), false);
  assert.equal(canRelease(sign(st)), true);
});

test('editing the text after sign-off voids it', () => {
  const signed = sign(state({ accrual: 'approved' }, GOOD_APPROVED, { accrual: 'approved' }));
  const edited = state({ accrual: 'approved' }, GOOD_APPROVED.replace('ahead of budget', 'above budget'), { accrual: 'approved' });
  assert.equal(canRelease({ ...edited, signoff: signed.signoff }), false);
});

test('changing the snapshot after sign-off voids it', () => {
  const signed = sign(state({ accrual: 'approved' }, GOOD_APPROVED, { accrual: 'approved' }));
  const back = state({ accrual: 'open' }, GOOD_APPROVED, { accrual: 'approved' });
  assert.equal(canRelease({ ...back, signoff: signed.signoff }), false);
});

test('a statement the checker cannot verify needs the reviewer before sign-off', () => {
  const txt = GOOD_APPROVED + ' The team had a strong month.';
  const st = state({ accrual: 'approved' }, txt, { accrual: 'approved' });
  assert.equal(canSignOff(st), false);
  const idx = st.draft.sentences.findIndex((x) => x.status === 'review');
  assert.equal(canSignOff({ ...st, reviewed: new Set([idx]) }), true);
});

test('a failing claim blocks sign-off even if everything else holds', () => {
  const st = state({ accrual: 'approved' }, GOOD_APPROVED + ' August revenue was [[revenue.month.vs_budget_pct]] below budget.', { accrual: 'approved' });
  assert.equal(canSignOff(st), false);
});
