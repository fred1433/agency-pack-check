// Calculation edge cases: rounding, zero and negative bases, missing inputs, credit notes, duplicates, signs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics, sourceChecks, pctChange } from '../src/engine.ts';
import { roundHalfAway, displayValue, roundsToZero } from '../src/format.ts';

const fresh = () => structuredClone(loadSources());

test('rounding is half away from zero', () => {
  assert.equal(roundHalfAway(0.05, 1), 0.1);
  assert.equal(roundHalfAway(-0.05, 1), -0.1);
  assert.equal(roundHalfAway(2.45, 1), 2.5);
  assert.equal(roundHalfAway(1.005, 2), 1.01);
  assert.equal(roundHalfAway(-2.5, 0), -3);
  assert.equal(displayValue(0.0208, 'pp', true), '0.0 percentage points');
  assert.equal(displayValue(1, 'pp', true), '1.0 percentage point');
  assert.equal(displayValue(-4200, 'gbp', true), '£4,200');
  assert.equal(displayValue(-4200, 'gbp', false), '-£4,200');
  assert.ok(roundsToZero(0.0208, 'pp'));
  assert.ok(!roundsToZero(0.05, 'pp'));
});

test('percentage change is not meaningful on a zero or negative base', () => {
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(100, -50), null);
  assert.equal(pctChange(null, 10), null);
  assert.equal(displayValue(null, 'pct', true), 'n/m');
  assert.ok(Math.abs(pctChange(-50, 100)! - -150) < 1e-9);
});

test('a missing budget line is disclosed, and counts as nil', () => {
  const { checks } = sourceChecks(fresh(), { accrual: 'open' });
  const b = checks.find((c) => c.id === 'budget')!;
  assert.equal(b.status, 'note');
  assert.match(b.detail, /489 Recruitment fees/);
});

test('removing the credit note breaks the revenue reconciliation', () => {
  const s = fresh();
  s.creditNotes.CreditNotes = [];
  const inv = sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'invoices')!;
  assert.equal(inv.status, 'fail');
});

test('duplicates: the latest record wins, whatever the pull order', () => {
  const s = fresh();
  s.invoicePulls.reverse();
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'invoices')!.status, 'pass');
  const s2 = fresh();
  s2.invoicePulls[1].Invoices[0].SubTotal = 15000; // the edit changed the amount: latest wins, reconciliation must now fail
  assert.equal(sourceChecks(s2, { accrual: 'open' }).checks.find((c) => c.id === 'invoices')!.status, 'fail');
});

test('an invoice in another currency fails the currency control', () => {
  const s = fresh();
  s.invoicePulls[0].Invoices[3].CurrencyCode = 'EUR';
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'currency')!.status, 'fail');
});

test('a negative P&L line fails the sign control', () => {
  const s = fresh();
  const row = s.plMonth.Reports[0].Rows.find((r: any) => r.Title === 'Less Cost of Sales').Rows[1];
  row.Cells[1].Value = '-21000.00';
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'signs')!.status, 'fail');
});

test('a report run on a cash basis fails the basis control', () => {
  const s = fresh();
  s.plYtd._request.params.paymentsOnly = true;
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'basis')!.status, 'fail');
});

test('a year-to-date report with the wrong start date fails the period control', () => {
  const s = fresh();
  s.plYtd._request.params.fromDate = '2026-01-01';
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'periods')!.status, 'fail');
});

test('revenue left untracked fails the client completeness control', () => {
  const s = fresh();
  const rep = s.plByClient['2026-08'].Reports[0];
  const inc = rep.Rows.find((r: any) => r.Title === 'Income').Rows[0];
  inc.Cells[1].Value = '60000.00'; // Orchard Lane loses 2,000 that no column picks up
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'tracking')!.status, 'fail');
});

test('a P&L that disagrees with the trial balance fails the tie-out', () => {
  const s = fresh();
  const row = s.plMonth.Reports[0].Rows.find((r: any) => r.Title === 'Less Operating Expenses').Rows[0];
  row.Cells[1].Value = '9100.00';
  assert.equal(sourceChecks(s, { accrual: 'open' }).checks.find((c) => c.id === 'trial-balance')!.status, 'fail');
});

test('a missing input stops with a clear error, never a zero', () => {
  const s = fresh() as any;
  s.plMonth = {};
  assert.throws(() => computeMetrics(s, { accrual: 'open' }), /Not a ReportWithRows response/);
});

test('September-earned payroll is never accrued into August', () => {
  const s = fresh();
  s.payrollCsv = s.payrollCsv.split('\n').filter((l) => !l.includes('August overtime')).join('\n');
  const ms = computeMetrics(s, { accrual: 'approved' });
  assert.equal(ms.metrics.get('direct_costs.month.actual')!.value, 120000);
});
