// Source snapshot -> reconciled metrics. Deterministic: same sources and decisions, same metrics.
import { parseReport, PL_SECTIONS, sectionTotal, columnIndex, msDateToIso, type ParsedReport } from './xero.ts';
import { displayValue, roundsToZero, type Unit } from './format.ts';
import { fingerprint } from './hash.ts';

export type Sources = {
  organisation: any; accounts: any; trackingCategories: any;
  plMonth: any; plYtd: any; plPyMonth: any; plPyYtd: any;
  plByClient: Record<'2026-05' | '2026-06' | '2026-07' | '2026-08' | 'ytd', any>;
  trialBalance: any; budget: any; invoicePulls: any[]; creditNotes: any; manualJournals: any;
  payrollCsv: string;
};

export type Decisions = { accrual: 'open' | 'approved' | 'held' };

export type Measure = 'revenue' | 'direct_costs' | 'gross_profit' | 'gross_margin' | 'overheads' | 'operating_profit' | 'share';
export type Period = 'month' | 'ytd';
export type Scenario = 'actual' | 'budget' | 'py' | 'avg3m';
export type Comparator = 'budget' | 'py' | 'avg3m';

export type Metric = {
  id: string;
  label: string;
  measure: Measure;
  entity: string; // 'agency' or a client name
  period: Period;
  kind: 'level' | 'variance';
  scenario: Scenario; // for variances: the actual side
  comparator: Comparator | null;
  unit: Unit;
  value: number | null;
  display: string; // what the page prints; variances print their magnitude only
  polarity: 1 | -1; // +1: higher is favourable
  status: 'posted' | 'adjusted' | 'proposed';
  calc: string;
  sources: string[];
};

export type CheckResult = { id: string; title: string; status: 'pass' | 'fail' | 'note'; detail: string; evidence: string[] };
export type Question = {
  id: string; title: string; detail: string; effect: string; material: boolean;
  state: 'open' | 'resolved' | 'held'; blocksRelease: boolean; evidence: string[]; hypotheses?: string[];
};

// Illustrative assumptions, set by us, shown on the page. Replace with the firm's own.
export const ASSUMPTIONS = {
  agency: 'Lowther Studio Ltd (fictional)',
  materialityGbp: 10000, // effect on gross profit
  materialityMarginPp: 1.0, // effect on gross margin
  clientSlipPct: 25, // fall against the client's three-month average that we raise as a question
  clientSlipMinShare: 5, // only for clients above this share of revenue
  concentrationPct: 25, // single client share we always mention
  month: { from: '2026-08-01', to: '2026-08-31', label: 'August 2026' },
  pyMonth: { from: '2025-08-01', to: '2025-08-31' },
  avgMonths: ['2026-05', '2026-06', '2026-07'] as const,
};

export const CLIENTS = [
  { name: 'Orchard Lane Foods', slug: 'orchard-lane' },
  { name: 'Kestrel Mobility', slug: 'kestrel' },
  { name: 'Brightwater Housing', slug: 'brightwater' },
  { name: 'Marlow & Finch', slug: 'marlow-finch' },
] as const;

export const ACCRUAL = {
  id: 'accrual-aug-payroll',
  accountCode: '310',
  description: 'August overtime and delivery bonuses, approved on 1 September for the September payroll, with employer NIC and pension',
};

type Parsed = {
  plMonth: ParsedReport; plYtd: ParsedReport; plPyMonth: ParsedReport; plPyYtd: ParsedReport;
  byClient: Record<string, ParsedReport>; tb: ParsedReport;
  codeById: Map<string, string>; typeByCode: Map<string, string>; nameByCode: Map<string, string>;
};

function parseAll(s: Sources): Parsed {
  const accounts: any[] = s.accounts.Accounts;
  const byClient: Record<string, ParsedReport> = {};
  for (const [k, v] of Object.entries(s.plByClient)) byClient[k] = parseReport(v);
  return {
    plMonth: parseReport(s.plMonth), plYtd: parseReport(s.plYtd), plPyMonth: parseReport(s.plPyMonth), plPyYtd: parseReport(s.plPyYtd),
    byClient, tb: parseReport(s.trialBalance),
    codeById: new Map(accounts.map((a) => [a.AccountID, a.Code])),
    typeByCode: new Map(accounts.map((a) => [a.Code, a.Type])),
    nameByCode: new Map(accounts.map((a) => [a.Code, a.Name])),
  };
}

export function parsePayroll(csv: string) {
  const [head, ...rows] = csv.trim().split('\n').map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))).map((r: any) => ({
    ...r, gross: Number(r.gross), employer_nic: Number(r.employer_nic), employer_pension: Number(r.employer_pension),
  }));
}

export function accrualEvidence(s: Sources) {
  const lines = parsePayroll(s.payrollCsv).filter((l) => l.earned_period === '2026-08');
  const gross = lines.reduce((a, l) => a + l.gross, 0);
  const nic = lines.reduce((a, l) => a + l.employer_nic, 0);
  const pension = lines.reduce((a, l) => a + l.employer_pension, 0);
  return { lines, gross, nic, pension, total: gross + nic + pension };
}

// Budget total for account types over periods "YYYY-MM" (inclusive range).
function budgetFor(s: Sources, p: Parsed, types: string[], fromPeriod: string, toPeriod: string) {
  const b = s.budget.Budgets[0];
  let total = 0;
  for (const line of b.BudgetLines) {
    if (!types.includes(p.typeByCode.get(line.AccountCode) ?? '')) continue;
    for (const bal of line.BudgetBalances) if (bal.Period >= fromPeriod && bal.Period <= toPeriod) total += Number(bal.Amount);
  }
  return total;
}

type Base = { revenue: number; direct_costs: number; overheads: number };
const derived = (b: Base) => {
  const gross_profit = b.revenue - b.direct_costs;
  return { ...b, gross_profit, gross_margin: b.revenue === 0 ? null : (gross_profit / b.revenue) * 100, operating_profit: gross_profit - b.overheads };
};
const fromPl = (r: ParsedReport): Base => ({
  revenue: sectionTotal(r, PL_SECTIONS.income), direct_costs: sectionTotal(r, PL_SECTIONS.costOfSales), overheads: sectionTotal(r, PL_SECTIONS.opex),
});

const MEASURE_LABEL: Record<Exclude<Measure, 'share'>, string> = {
  revenue: 'Revenue', direct_costs: 'Direct costs', gross_profit: 'Gross profit', gross_margin: 'Gross margin', overheads: 'Overheads', operating_profit: 'Operating profit',
};
const POLARITY: Record<Measure, 1 | -1> = { revenue: 1, direct_costs: -1, gross_profit: 1, gross_margin: 1, overheads: -1, operating_profit: 1, share: 1 };
const AFFECTED_BY_ACCRUAL = new Set<Measure>(['direct_costs', 'gross_profit', 'gross_margin', 'operating_profit']);

export function pctChange(actual: number | null, base: number | null): number | null {
  if (actual === null || base === null || base === 0 || base < 0) return null; // not meaningful on a zero or negative base
  return ((actual - base) / base) * 100;
}

export type MetricSet = { metrics: Map<string, Metric>; snapshotFingerprint: string; decisions: Decisions };

export function computeMetrics(s: Sources, decisions: Decisions): MetricSet {
  const p = parseAll(s);
  const acc = accrualEvidence(s);
  const approved = decisions.accrual === 'approved';
  const metrics = new Map<string, Metric>();

  const monthPosted = fromPl(p.plMonth);
  const ytdPosted = fromPl(p.plYtd);
  const adj = (b: Base): Base => ({ ...b, direct_costs: b.direct_costs + acc.total });
  const actual = { month: derived(approved ? adj(monthPosted) : monthPosted), ytd: derived(approved ? adj(ytdPosted) : ytdPosted) };
  const proposed = { month: derived(adj(monthPosted)), ytd: derived(adj(ytdPosted)) };
  const bud = (from: string, to: string) => derived({
    revenue: budgetFor(s, p, ['REVENUE'], from, to), direct_costs: budgetFor(s, p, ['DIRECTCOSTS'], from, to), overheads: budgetFor(s, p, ['OVERHEADS', 'EXPENSE'], from, to),
  });
  const budget = { month: bud('2026-08', '2026-08'), ytd: bud('2026-04', '2026-08') };
  const py = { month: derived(fromPl(p.plPyMonth)), ytd: derived(fromPl(p.plPyYtd)) };

  const src = {
    month: 'xero_pl_2026-08.json', ytd: 'xero_pl_ytd_2026-04_2026-08.json', pyMonth: 'xero_pl_2025-08.json', pyYtd: 'xero_pl_ytd_2025-04_2025-08.json', budget: 'xero_budget.json',
  };
  const periodWords = { month: 'August 2026', ytd: 'year to date, 1 April to 31 August 2026' };
  const add = (m: Metric) => metrics.set(m.id, m);

  const measures = ['revenue', 'direct_costs', 'gross_profit', 'gross_margin', 'overheads', 'operating_profit'] as const;
  for (const period of ['month', 'ytd'] as const) {
    for (const measure of measures) {
      const unit: Unit = measure === 'gross_margin' ? 'pct' : 'gbp';
      const varUnit: Unit = measure === 'gross_margin' ? 'pp' : 'gbp';
      const affected = AFFECTED_BY_ACCRUAL.has(measure);
      const status = affected && approved ? 'adjusted' : 'posted';
      const baseId = `${measure}.${period}`;
      const L = MEASURE_LABEL[measure];
      const actualSrc = [period === 'month' ? src.month : src.ytd, ...(affected && approved ? [`approved adjustment ${ACCRUAL.id}`] : [])];
      const calcFor = (set: ReturnType<typeof derived>) => measure === 'gross_margin'
        ? `gross profit ${displayValue(set.gross_profit, 'gbp', false)} / revenue ${displayValue(set.revenue, 'gbp', false)}`
        : measure === 'gross_profit' ? `revenue ${displayValue(set.revenue, 'gbp', false)} - direct costs ${displayValue(set.direct_costs, 'gbp', false)}`
        : measure === 'operating_profit' ? `gross profit ${displayValue(set.gross_profit, 'gbp', false)} - overheads ${displayValue(set.overheads, 'gbp', false)}`
        : `report section total`;
      const level = (id: string, scenario: Scenario, value: number | null, st: Metric['status'], sources: string[], calc: string, label: string) => add({
        id, label, measure, entity: 'agency', period, kind: 'level', scenario, comparator: scenario === 'actual' ? null : (scenario as Comparator), unit, value,
        display: displayValue(value, unit, false), polarity: POLARITY[measure], status: st, calc, sources,
      });
      level(`${baseId}.actual`, 'actual', actual[period][measure], status, actualSrc, calcFor(actual[period]), `${L}, ${periodWords[period]}`);
      level(`${baseId}.budget`, 'budget', budget[period][measure], 'posted', [src.budget], `sum of BudgetBalances for ${period === 'month' ? '2026-08' : '2026-04 to 2026-08'}`, `${L}, budget, ${periodWords[period]}`);
      level(`${baseId}.py`, 'py', py[period][measure], 'posted', [period === 'month' ? src.pyMonth : src.pyYtd], calcFor(py[period]), `${L}, prior year, ${period === 'month' ? 'August 2025' : '1 April to 31 August 2025'}`);
      if (affected && !approved) {
        level(`${baseId}.actual@proposed`, 'actual', proposed[period][measure], 'proposed', [...actualSrc, `proposed adjustment ${ACCRUAL.id}`], calcFor(proposed[period]), `${L}, ${periodWords[period]}, if the proposed accrual is approved`);
      }
      const variances = (suffix: string, act: number | null, st: Metric['status'], labelTail: string) => {
        for (const comp of ['budget', 'py'] as const) {
          const base = comp === 'budget' ? budget[period][measure] : py[period][measure];
          const compWord = comp === 'budget' ? 'budget' : 'prior year';
          const mk = (idTail: string, u: Unit, value: number | null, calc: string) => add({
            id: `${baseId}.${idTail}${suffix}`, label: `${L}, ${periodWords[period]}, ${u === 'pct' ? '% change' : 'difference'} against ${compWord}${labelTail}`,
            measure, entity: 'agency', period, kind: 'variance', scenario: 'actual', comparator: comp, unit: u, value,
            display: displayValue(value, u, true), polarity: POLARITY[measure], status: st, calc, sources: [...(st === 'posted' ? [] : [`${suffix ? 'proposed' : 'approved'} adjustment ${ACCRUAL.id}`]), period === 'month' ? src.month : src.ytd, comp === 'budget' ? src.budget : (period === 'month' ? src.pyMonth : src.pyYtd)],
          });
          if (measure === 'gross_margin') {
            const v = act === null || base === null ? null : act - base;
            mk(`vs_${comp}_pp`, 'pp', v, `actual margin minus ${compWord} margin, unrounded`);
          } else {
            mk(`vs_${comp}`, 'gbp', act === null || base === null ? null : act - base, `actual minus ${compWord}`);
            mk(`vs_${comp}_pct`, 'pct', pctChange(act, base), `(actual - ${compWord}) / ${compWord}`);
          }
        }
      };
      variances('', actual[period][measure], status, '');
      if (affected && !approved) variances('@proposed', proposed[period][measure], 'proposed', ', if the proposed accrual is approved');
    }
  }

  // Clients: revenue by the Client tracking category.
  const revenueByOption = (r: ParsedReport) => {
    const out = new Map<string, number>();
    for (const c of r.columns) out.set(c, sectionTotal(r, PL_SECTIONS.income, columnIndex(r, c)));
    return out;
  };
  const augByClient = revenueByOption(p.byClient['2026-08']);
  const ytdByClient = revenueByOption(p.byClient.ytd);
  const prior = ASSUMPTIONS.avgMonths.map((m) => revenueByOption(p.byClient[m]));
  for (const c of CLIENTS) {
    const mkc = (id: string, measure: Measure, period: Period, kind: Metric['kind'], scenario: Scenario, comparator: Comparator | null, unit: Unit, value: number | null, calc: string, label: string, sources: string[]) => add({
      id: `client.${c.slug}.${id}`, label: `${c.name}: ${label}`, measure, entity: c.name, period, kind, scenario, comparator, unit, value,
      display: displayValue(value, unit, kind === 'variance'), polarity: 1, status: 'posted', calc, sources,
    });
    const aug = augByClient.get(c.name) ?? null;
    const ytd = ytdByClient.get(c.name) ?? null;
    const avg = prior.reduce((a, m) => a + (m.get(c.name) ?? 0), 0) / prior.length;
    mkc('revenue.month.actual', 'revenue', 'month', 'level', 'actual', null, 'gbp', aug, 'Income, Client column', 'revenue, August 2026', ['xero_pl_by_client_2026-08.json']);
    mkc('revenue.ytd.actual', 'revenue', 'ytd', 'level', 'actual', null, 'gbp', ytd, 'Income, Client column', 'revenue, year to date', ['xero_pl_by_client_ytd_2026.json']);
    mkc('share.month.actual', 'share', 'month', 'level', 'actual', null, 'pct', aug === null ? null : (aug / monthPosted.revenue) * 100, 'client revenue / agency revenue', 'share of agency revenue, August 2026', ['xero_pl_by_client_2026-08.json', src.month]);
    mkc('share.ytd.actual', 'share', 'ytd', 'level', 'actual', null, 'pct', ytd === null ? null : (ytd / ytdPosted.revenue) * 100, 'client revenue / agency revenue', 'share of agency revenue, year to date', ['xero_pl_by_client_ytd_2026.json', src.ytd]);
    mkc('revenue.month.avg3m', 'revenue', 'month', 'level', 'avg3m', 'avg3m', 'gbp', avg, 'mean of May, June, July 2026', 'average monthly revenue, May to July 2026', ASSUMPTIONS.avgMonths.map((m) => `xero_pl_by_client_${m}.json`));
    mkc('revenue.month.vs_avg3m', 'revenue', 'month', 'variance', 'actual', 'avg3m', 'gbp', aug === null ? null : aug - avg, 'August minus three-month average', 'revenue, August 2026 against its May to July average, difference', ['xero_pl_by_client_2026-08.json']);
    mkc('revenue.month.vs_avg3m_pct', 'revenue', 'month', 'variance', 'actual', 'avg3m', 'pct', pctChange(aug, avg), '(August - average) / average', 'revenue, August 2026 against its May to July average, % change', ['xero_pl_by_client_2026-08.json']);
  }
  return { metrics, decisions, snapshotFingerprint: fingerprint(factsText(metrics)) };
}

// The approved figures of a snapshot, exactly as the drafting prompt lists them. A draft belongs to the figures it
// was given: its fingerprint is this text's, so a draft is stale as soon as any approved figure changes.
export function factsText(metrics: Map<string, Metric>): string {
  return [...metrics.values()].filter((m) => m.status !== 'proposed')
    .map((m) => `[[${m.id}]] | ${m.label}${m.kind === 'variance' ? ` (prints as a magnitude; it is ${m.value === null ? 'not meaningful' : m.value > 0 ? 'higher' : m.value < 0 ? 'lower' : 'nil'})` : ''} | ${m.display}`).join('\n');
}
export function factsFromPrompt(prompt: string): string {
  const a = prompt.indexOf('Facts (reference | meaning | value):\n');
  const b = prompt.indexOf('\n\nReply with JSON');
  if (a < 0 || b < 0) throw new Error('Prompt has no facts section');
  return prompt.slice(a + 'Facts (reference | meaning | value):\n'.length, b);
}

// ---------- Source -> metrics controls ----------
export function sourceChecks(s: Sources, d: Decisions): { checks: CheckResult[]; questions: Question[] } {
  const p = parseAll(s);
  const checks: CheckResult[] = [];
  const org = s.organisation.Organisations[0];

  // 1. Periods, from the organisation's financial year end.
  {
    const fyStartMonth = (org.FinancialYearEndMonth % 12) + 1;
    const fyStart = `2026-${String(fyStartMonth).padStart(2, '0')}-01`;
    const got = { month: p.plMonth.params, ytd: p.plYtd.params, pyMonth: p.plPyMonth.params, pyYtd: p.plPyYtd.params } as Record<string, any>;
    const want = {
      month: ['2026-08-01', '2026-08-31'], ytd: [fyStart, '2026-08-31'], pyMonth: ['2025-08-01', '2025-08-31'], pyYtd: [fyStart.replace('2026', '2025'), '2025-08-31'],
    } as Record<string, string[]>;
    const bad = Object.keys(want).filter((k) => got[k].fromDate !== want[k][0] || got[k].toDate !== want[k][1]);
    checks.push({
      id: 'periods', title: 'Report periods match the financial year', status: bad.length ? 'fail' : 'pass',
      detail: bad.length ? `Wrong dates on: ${bad.join(', ')}` : `Year end ${org.FinancialYearEndDay}/${org.FinancialYearEndMonth} read from Organisation, so year to date runs ${fyStart} to 2026-08-31. Month, year to date and both prior-year reports carry those dates.`,
      evidence: ['xero_organisation.json', 'xero_pl_*.json _request.params'],
    });
  }
  // 2. Accounting basis.
  {
    const reps = [p.plMonth, p.plYtd, p.plPyMonth, p.plPyYtd, p.tb, ...Object.values(p.byClient)];
    const cash = reps.filter((r) => r.params.paymentsOnly !== false);
    checks.push({ id: 'basis', title: 'Accruals basis on every report', status: cash.length ? 'fail' : 'pass',
      detail: cash.length ? `${cash.length} report(s) not requested with paymentsOnly=false` : 'Every report requested with paymentsOnly=false (P&L month, year to date, both prior-year periods, the five by client, and the trial balance).', evidence: ['_request.params.paymentsOnly'] });
  }
  // 3. Currency.
  {
    const inv = s.invoicePulls.flatMap((x) => x.Invoices);
    const other = [...inv, ...s.creditNotes.CreditNotes].filter((i: any) => i.CurrencyCode !== org.BaseCurrency);
    checks.push({ id: 'currency', title: 'One currency', status: other.length ? 'fail' : 'pass',
      detail: other.length ? `${other.length} document(s) not in ${org.BaseCurrency}` : `Base currency ${org.BaseCurrency}; every invoice and credit note is in ${org.BaseCurrency}.`, evidence: ['xero_organisation.json', 'xero_invoices_*.json'] });
  }
  // 4. Invoices and credit notes reconcile to recognised revenue (policy: fees recognised when invoiced).
  {
    const all = s.invoicePulls.flatMap((x) => x.Invoices);
    const latest = new Map<string, any>();
    for (const i of all) {
      const prev = latest.get(i.InvoiceID);
      if (!prev || msDateToIso(i.UpdatedDateUTC) > msDateToIso(prev.UpdatedDateUTC)) latest.set(i.InvoiceID, i);
    }
    const inMonth = (i: any) => i.DateString.slice(0, 10) >= '2026-08-01' && i.DateString.slice(0, 10) <= '2026-08-31' && ['AUTHORISED', 'PAID'].includes(i.Status);
    const invoiced = [...latest.values()].filter(inMonth).reduce((a, i) => a + i.SubTotal, 0);
    const naive = all.filter(inMonth).reduce((a, i) => a + i.SubTotal, 0);
    const credited = s.creditNotes.CreditNotes.filter(inMonth).reduce((a: number, c: any) => a + c.SubTotal, 0);
    const revenue = sectionTotal(p.plMonth, PL_SECTIONS.income);
    const dupes = all.length - latest.size;
    const ok = Math.abs(invoiced - credited - revenue) < 0.005;
    checks.push({
      id: 'invoices', title: 'Invoices less credit notes reconcile to revenue', status: ok ? 'pass' : 'fail',
      detail: `${latest.size} invoices ${displayValue(invoiced, 'gbp', false)}, less credit notes ${displayValue(credited, 'gbp', false)}, equals ${displayValue(invoiced - credited, 'gbp', false)} against revenue of ${displayValue(revenue, 'gbp', false)} in the P&L.` +
        (dupes ? ` ${dupes === 1 ? "One record" : `${dupes} records`} arrived twice (the 2 September incremental pull returned an edited invoice); kept the latest by UpdatedDateUTC. Without that, invoices would total ${displayValue(naive, 'gbp', false)} and the reconciliation would fail.` : ''),
      evidence: ['xero_invoices_pull_2026-09-01.json', 'xero_invoices_pull_2026-09-02_modified.json', 'xero_credit_notes_2026-08.json', 'xero_pl_2026-08.json'],
    });
  }
  // 5. Client tracking completeness.
  {
    const r = p.byClient['2026-08'];
    const byCol = r.columns.map((c, i) => ({ c, rev: sectionTotal(r, PL_SECTIONS.income, i), cos: sectionTotal(r, PL_SECTIONS.costOfSales, i) }));
    const revTotal = byCol.reduce((a, x) => a + x.rev, 0);
    const cosTotal = byCol.reduce((a, x) => a + x.cos, 0);
    const un = byCol.find((x) => x.c === 'Unassigned') ?? { rev: 0, cos: 0 };
    const plRev = sectionTotal(p.plMonth, PL_SECTIONS.income);
    const plCos = sectionTotal(p.plMonth, PL_SECTIONS.costOfSales);
    const ok = Math.abs(revTotal - plRev) < 0.005 && Math.abs(cosTotal - plCos) < 0.005 && un.rev === 0;
    checks.push({
      id: 'tracking', title: 'Every pound of revenue carries a client', status: ok ? 'pass' : 'fail',
      detail: `Client columns total ${displayValue(revTotal, 'gbp', false)} of revenue (P&L ${displayValue(plRev, 'gbp', false)}); unassigned revenue ${displayValue(un.rev, 'gbp', false)}. Direct costs: ${displayValue(un.cos, 'gbp', false)} of ${displayValue(plCos, 'gbp', false)} carry no client (delivery staff costs are not tracked), so client gross margin is not calculated.`,
      evidence: ['xero_pl_by_client_2026-08.json'],
    });
  }
  // 6. Trial balance tie-out.
  {
    const tb = p.tb;
    const col = { dr: 0, cr: 1, ydr: 2, ycr: 3 };
    const tbSum = (sec: string, c: number, types?: string[]) => tb.lines.filter((l) => l.section === sec && (!types || types.includes(p.typeByCode.get(l.code ?? '') ?? ''))).reduce((a, l) => a + (l.values[c] ?? 0), 0);
    const pairs: [string, number, number][] = [
      ['revenue, month', tbSum('Revenue', col.cr), sectionTotal(p.plMonth, PL_SECTIONS.income)],
      ['revenue, year to date', tbSum('Revenue', col.ycr), sectionTotal(p.plYtd, PL_SECTIONS.income)],
      ['direct costs, month', tbSum('Expenses', col.dr, ['DIRECTCOSTS']), sectionTotal(p.plMonth, PL_SECTIONS.costOfSales)],
      ['direct costs, year to date', tbSum('Expenses', col.ydr, ['DIRECTCOSTS']), sectionTotal(p.plYtd, PL_SECTIONS.costOfSales)],
      ['overheads, month', tbSum('Expenses', col.dr, ['OVERHEADS']), sectionTotal(p.plMonth, PL_SECTIONS.opex)],
      ['overheads, year to date', tbSum('Expenses', col.ydr, ['OVERHEADS']), sectionTotal(p.plYtd, PL_SECTIONS.opex)],
    ];
    const totalRow = tb.summaries['Total'];
    const balanced = totalRow && totalRow[2] !== null && totalRow[2] === totalRow[3];
    const bad = pairs.filter(([, a, b]) => Math.abs(a - b) >= 0.005);
    checks.push({
      id: 'trial-balance', title: 'P&L ties to the trial balance', status: bad.length || !balanced ? 'fail' : 'pass',
      detail: bad.length ? `Differences on ${bad.map((b) => b[0]).join(', ')}` : `Six totals agree (revenue, direct costs and overheads, month and year to date). Trial balance year-to-date debits equal credits at ${displayValue(totalRow?.[2] ?? 0, 'gbp', false)}.`,
      evidence: ['xero_trial_balance_2026-08-31.json', 'xero_pl_2026-08.json', 'xero_pl_ytd_2026-04_2026-08.json'],
    });
  }
  // 7. Budget source and coverage.
  {
    const b = s.budget.Budgets[0];
    const budgeted = new Set(b.BudgetLines.map((l: any) => l.AccountCode));
    const active = new Set<string>();
    for (const r of [p.plMonth, p.plYtd]) for (const l of r.lines) if (l.accountId && (l.values[0] ?? 0) !== 0) active.add(p.codeById.get(l.accountId) ?? '?');
    const missing = [...active].filter((c) => !budgeted.has(c));
    checks.push({
      id: 'budget', title: 'Budget source and coverage', status: missing.length ? 'note' : 'pass',
      detail: `Budget: "${b.Description}", type ${b.Type}, from the Budgets endpoint (version and approval are in its description; Xero has no approval field).` +
        (missing.length ? ` No budget line for ${missing.map((c) => `${c} ${p.nameByCode.get(c)}`).join(', ')}: its budget counts as nil, so the overheads variance includes it in full.` : ''),
      evidence: ['xero_budget.json'],
    });
  }
  // 8. Signs.
  {
    const neg = [p.plMonth, p.plYtd].flatMap((r) => r.lines.filter((l) => (l.values[0] ?? 0) < 0));
    checks.push({ id: 'signs', title: 'Signs', status: neg.length ? 'fail' : 'pass',
      detail: neg.length ? `Negative lines: ${neg.map((l) => l.name).join(', ')}` : 'Income and cost lines are all positive as reported; the credit note reduces income rather than appearing as a cost.', evidence: ['xero_pl_2026-08.json'] });
  }
  // 9. Payroll workpaper against the ledger: August-earned pay with no August cost.
  const acc = accrualEvidence(s);
  const accrualJournals = s.manualJournals.ManualJournals.filter((j: any) => /accru/i.test(j.Narration ?? ''));
  checks.push({
    id: 'accrual', title: 'Payroll costs earned in August are in August', status: d.accrual === 'approved' ? 'pass' : 'fail',
    detail: `The payroll input approved on 1 September for the September run holds ${acc.lines.length} August-earned lines: ${displayValue(acc.gross, 'gbp', false)} gross, ${displayValue(acc.nic, 'gbp', false)} employer NIC, ${displayValue(acc.pension, 'gbp', false)} employer pension, ${displayValue(acc.total, 'gbp', false)} in all. August manual journals with an accrual: ${accrualJournals.length}.` +
      (d.accrual === 'approved' ? ' Accrual approved as a reporting adjustment.' : ' No August cost recorded for them.'),
    evidence: ['data/workpapers/payroll_input_2026-09-01.csv', 'xero_manual_journals_2026-08.json'],
  });

  // ---------- Questions for the finance director ----------
  const month = computeMetrics(s, { accrual: 'open' }).metrics;
  const gm = month.get('gross_margin.month.actual')!.value!;
  const gmAdj = month.get('gross_margin.month.actual@proposed')!.value!;
  const questions: Question[] = [{
    id: ACCRUAL.id,
    title: `Accrue ${displayValue(acc.total, 'gbp', false)} of August delivery pay?`,
    detail: `${ACCRUAL.description}. Basis: ${displayValue(acc.gross, 'gbp', false)} gross, employer NIC at 15% (${displayValue(acc.nic, 'gbp', false)}), employer pension at 5% (${displayValue(acc.pension, 'gbp', false)}). Rates as they appear in the payroll input; NIC assumes each employee is above the secondary threshold.`,
    effect: `Gross margin for August moves from ${displayValue(gm, 'pct', false)} to ${displayValue(gmAdj, 'pct', false)}.`,
    material: acc.total >= ASSUMPTIONS.materialityGbp || Math.abs(gm - gmAdj) >= ASSUMPTIONS.materialityMarginPp,
    state: d.accrual === 'approved' ? 'resolved' : d.accrual === 'held' ? 'held' : 'open',
    blocksRelease: d.accrual !== 'approved',
    evidence: ['data/workpapers/payroll_input_2026-09-01.csv'],
  }];
  for (const cn of s.creditNotes.CreditNotes) questions.push({
    id: `credit-note-${cn.CreditNoteNumber.toLowerCase()}`, title: `Credit note ${cn.CreditNoteNumber}, issued ${new Date(cn.DateString.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`,
    detail: `${cn.Contact.Name}, ${displayValue(cn.SubTotal, 'gbp', false)}. ${cn.Reference}. Treated under the stated policy: credit notes reduce revenue in the month they are issued.`,
    effect: `Without it, August revenue would be ${displayValue(sectionTotal(p.plMonth, PL_SECTIONS.income) + cn.SubTotal, 'gbp', false)}. It is ${displayValue(cn.SubTotal, 'gbp', false)} of the ${displayValue(Math.abs(month.get('client.marlow-finch.revenue.month.vs_avg3m')!.value ?? 0), 'gbp', false)} fall at ${cn.Contact.Name} against its May to July average: a credit on July work, posted in August.`,
    material: false, state: 'resolved', blocksRelease: false, evidence: ['xero_credit_notes_2026-08.json'],
  });
  const mf = month.get('client.marlow-finch.revenue.month.vs_avg3m_pct')!;
  const mfShare = month.get('client.marlow-finch.share.month.actual')!;
  if (mf.value !== null && -mf.value >= ASSUMPTIONS.clientSlipPct && (mfShare.value ?? 0) >= ASSUMPTIONS.clientSlipMinShare) {
    questions.push({
      id: 'client-marlow-finch', title: `Marlow & Finch revenue ${mf.display} below its May to July average`,
      detail: 'The ledger shows less revenue; it does not show why. Ask the account lead before the commentary names a cause.',
      effect: 'Commentary states the fall and makes no claim about its cause until answered.',
      hypotheses: ['Timing: work delivered but not yet invoiced, or phased into September', 'Scope: the July reduction (credit note CN-0147) continuing', 'Relationship: a reduced retainer or a client at risk'],
      material: false, state: 'open', blocksRelease: false, evidence: ['xero_pl_by_client_2026-05.json to _2026-08.json'],
    });
  }
  questions.push({
    id: 'recruitment-fee', title: 'Recruitment fee of £4,800: one-off for adjusted EBITDA?',
    detail: 'Account 489, not budgeted. Whether it is excluded from an adjusted profit measure is a policy decision, not something the ledger can settle.',
    effect: 'No effect on the reported figures; affects adjusted measures only if the policy says so.',
    material: false, state: 'open', blocksRelease: false, evidence: ['xero_pl_2026-08.json'],
  });
  return { checks, questions };
}

// Which movements the commentary must cover (draft-level omission check). Adverse and material = must be mentioned.
export type Coverage = { key: string; description: string; adverse: boolean; matches: (m: Metric) => boolean };
export function requiredCoverage(ms: MetricSet): Coverage[] {
  const g = (id: string) => ms.metrics.get(id)!;
  const out: Coverage[] = [];
  const gm = g('gross_margin.month.vs_budget_pp');
  if (gm.value !== null && Math.abs(gm.value) >= ASSUMPTIONS.materialityMarginPp) {
    out.push({ key: 'gm-budget', description: `gross margin against budget for August (${gm.display} ${gm.value < 0 ? 'below' : 'above'})`, adverse: gm.value < 0,
      matches: (m) => m.measure === 'gross_margin' && m.period === 'month' && m.comparator === 'budget' && m.status !== 'proposed' });
  }
  const rev = g('revenue.month.vs_budget_pct');
  if (rev.value !== null && Math.abs(rev.value) >= 5) {
    out.push({ key: 'rev-budget', description: `revenue against budget for August (${rev.display} ${rev.value < 0 ? 'below' : 'above'})`, adverse: rev.value < 0,
      matches: (m) => m.measure === 'revenue' && m.entity === 'agency' && m.period === 'month' && m.comparator === 'budget' });
  }
  for (const c of CLIENTS) {
    const share = g(`client.${c.slug}.share.month.actual`);
    if ((share.value ?? 0) >= ASSUMPTIONS.concentrationPct) {
      out.push({ key: `conc-${c.slug}`, description: `${c.name} share of August revenue (${share.display})`, adverse: false, matches: (m) => m.entity === c.name && m.measure === 'share' });
    }
    const slip = g(`client.${c.slug}.revenue.month.vs_avg3m_pct`);
    if (slip.value !== null && -slip.value >= ASSUMPTIONS.clientSlipPct && (share.value ?? 0) >= ASSUMPTIONS.clientSlipMinShare) {
      out.push({ key: `slip-${c.slug}`, description: `${c.name} revenue against its three-month average (${slip.display} below)`, adverse: true,
        matches: (m) => m.entity === c.name && m.comparator === 'avg3m' });
    }
  }
  return out;
}

export { roundsToZero };
