// The engine against the hand-calculated reference case (REFERENCE.md, tests/expected.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics, sourceChecks, accrualEvidence } from '../src/engine.ts';

const expected = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
const s = loadSources();

for (const state of ['open', 'approved'] as const) {
  test(`metrics match the hand calculation (${state})`, () => {
    const ms = computeMetrics(s, { accrual: state });
    for (const [key, want] of Object.entries(expected[state])) {
      const [id, field] = key.split('|');
      const m = ms.metrics.get(id);
      assert.ok(m, `missing metric ${id}`);
      if (field === 'display') assert.equal(m.display, want, id);
      else assert.ok(Math.abs((m.value as number) - (want as number)) < 1e-9, `${id}: ${m.value} != ${want}`);
    }
  });
}

test('reconciliation totals match the hand calculation', () => {
  const r = expected.reconciliation;
  const acc = accrualEvidence(s);
  assert.equal(acc.total, r.accrual_total);
  assert.equal(acc.gross, r.accrual_gross);
  assert.equal(acc.nic, r.accrual_nic);
  assert.equal(acc.pension, r.accrual_pension);
  const { checks } = sourceChecks(s, { accrual: 'open' });
  const inv = checks.find((c) => c.id === 'invoices')!;
  assert.equal(inv.status, 'pass');
  assert.match(inv.detail, /12 invoices £206,000/);
  assert.match(inv.detail, /equals £200,000/);
  assert.match(inv.detail, /would total £220,000/);
  assert.match(checks.find((c) => c.id === 'trial-balance')!.detail, /£1,392,000/);
});

test('source controls: which pass, which do not, before and after the decision', () => {
  const before = Object.fromEntries(sourceChecks(s, { accrual: 'open' }).checks.map((c) => [c.id, c.status]));
  assert.deepEqual(before, { periods: 'pass', basis: 'pass', currency: 'pass', invoices: 'pass', tracking: 'pass', 'trial-balance': 'pass', budget: 'note', signs: 'pass', accrual: 'fail' });
  const after = Object.fromEntries(sourceChecks(s, { accrual: 'approved' }).checks.map((c) => [c.id, c.status]));
  assert.equal(after.accrual, 'pass');
  const q = sourceChecks(s, { accrual: 'open' }).questions;
  assert.deepEqual(q.filter((x) => x.blocksRelease).map((x) => x.id), ['accrual-aug-payroll']);
  assert.equal(sourceChecks(s, { accrual: 'held' }).questions.filter((x) => x.blocksRelease).length, 1);
  assert.equal(sourceChecks(s, { accrual: 'approved' }).questions.filter((x) => x.blocksRelease).length, 0);
});

test('approval changes the snapshot fingerprint; holding does not', () => {
  const a = computeMetrics(s, { accrual: 'open' }).snapshotFingerprint;
  assert.equal(computeMetrics(s, { accrual: 'held' }).snapshotFingerprint, a);
  assert.notEqual(computeMetrics(s, { accrual: 'approved' }).snapshotFingerprint, a);
});

test('each saved prompt lists exactly the approved figures of its snapshot', async () => {
  const { factsFromPrompt, factsText } = await import('../src/engine.ts');
  for (const batch of ['heldout', 'heldout2']) {
    for (const st of ['open', 'approved'] as const) {
      const prompt = readFileSync(new URL(`../data/drafts/${batch}/prompt_${st}.txt`, import.meta.url), 'utf8');
      assert.equal(factsFromPrompt(prompt), factsText(computeMetrics(s, { accrual: st }).metrics), `${batch} ${st}`);
    }
  }
});
