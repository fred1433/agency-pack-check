// Writes the synthetic source snapshot in the shapes of Xero Accounting API responses.
// Every figure below is fictional. Shapes follow XeroAPI/Xero-OpenAPI xero_accounting.yaml
// (ReportWithRows, Budgets, Invoices, CreditNotes, Organisation, TrackingCategories, ManualJournals).
// The payroll workpaper is not a Xero source: it stands for the payroll bureau's run report.
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../data/source/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const write = (name: string, obj: unknown) =>
  writeFileSync(new URL(name, OUT), JSON.stringify(obj, null, 2) + '\n');

// Deterministic UUID-shaped ids from a label, so fixtures are stable across rebuilds.
function uid(label: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (const ch of label + round) {
      h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
    }
    hex.push((h1 ^ h2).toString(16).padStart(8, '0'));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
const msDate = (iso: string) => `/Date(${Date.parse(iso)}+0000)/`;
const envelope = (extra: object) => ({
  Id: uid('env' + JSON.stringify(extra).length),
  Status: 'OK',
  ProviderName: 'agency-pack-check (synthetic fixture)',
  DateTimeUTC: msDate('2026-09-02T09:14:00Z'),
  ...extra,
});

type Acct = { code: string; name: string; section: 'Income' | 'Less Cost of Sales' | 'Less Operating Expenses' };
const ACCOUNTS: Acct[] = [
  { code: '200', name: 'Sales - fees', section: 'Income' },
  { code: '310', name: 'Delivery staff costs', section: 'Less Cost of Sales' },
  { code: '320', name: 'Freelancers', section: 'Less Cost of Sales' },
  { code: '325', name: 'Client delivery software', section: 'Less Cost of Sales' },
  { code: '469', name: 'Rent', section: 'Less Operating Expenses' },
  { code: '477', name: 'Admin salaries', section: 'Less Operating Expenses' },
  { code: '485', name: 'Subscriptions & software', section: 'Less Operating Expenses' },
  { code: '400', name: 'Advertising & marketing', section: 'Less Operating Expenses' },
  { code: '463', name: 'Training', section: 'Less Operating Expenses' },
  { code: '489', name: 'Recruitment fees', section: 'Less Operating Expenses' },
  { code: '429', name: 'General expenses', section: 'Less Operating Expenses' },
];
const acctId = (code: string) => uid('account-' + code);
const money = (n: number) => n.toFixed(2);

// Account balances per P&L report (positive numbers, as Xero shows them).
type Col = Record<string, number>;
function cell(value: string, code?: string) {
  return code ? { Value: value, Attributes: [{ Value: acctId(code), Id: 'account' }] } : { Value: value };
}
function profitAndLoss(title: string, fromDate: string, toDate: string, columns: { header: string; values: Col }[], params: object) {
  const rows: any[] = [{ RowType: 'Header', Cells: [{ Value: '' }, ...columns.map((c) => ({ Value: c.header }))] }];
  const sectionTotal = (sec: Acct['section'], ci: number) =>
    ACCOUNTS.filter((a) => a.section === sec).reduce((s, a) => s + (columns[ci].values[a.code] ?? 0), 0);
  const titles: Record<Acct['section'], string> = {
    Income: 'Total Income',
    'Less Cost of Sales': 'Total Cost of Sales',
    'Less Operating Expenses': 'Total Operating Expenses',
  };
  for (const sec of ['Income', 'Less Cost of Sales'] as const) {
    const accts = ACCOUNTS.filter((a) => a.section === sec && columns.some((c) => (c.values[a.code] ?? 0) !== 0));
    rows.push({
      RowType: 'Section',
      Title: sec,
      Rows: [
        ...accts.map((a) => ({
          RowType: 'Row',
          Cells: [cell(`${a.name}`, a.code), ...columns.map((c) => cell(money(c.values[a.code] ?? 0), a.code))],
        })),
        { RowType: 'SummaryRow', Cells: [{ Value: titles[sec] }, ...columns.map((_, i) => ({ Value: money(sectionTotal(sec, i)) }))] },
      ],
    });
  }
  rows.push({
    RowType: 'Section',
    Title: '',
    Rows: [{ RowType: 'Row', Cells: [{ Value: 'Gross Profit' }, ...columns.map((_, i) => ({ Value: money(sectionTotal('Income', i) - sectionTotal('Less Cost of Sales', i)) }))] }],
  });
  const opex = ACCOUNTS.filter((a) => a.section === 'Less Operating Expenses' && columns.some((c) => (c.values[a.code] ?? 0) !== 0));
  rows.push({
    RowType: 'Section',
    Title: 'Less Operating Expenses',
    Rows: [
      ...opex.map((a) => ({ RowType: 'Row', Cells: [cell(a.name, a.code), ...columns.map((c) => cell(money(c.values[a.code] ?? 0), a.code))] })),
      { RowType: 'SummaryRow', Cells: [{ Value: 'Total Operating Expenses' }, ...columns.map((_, i) => ({ Value: money(sectionTotal('Less Operating Expenses', i)) }))] },
    ],
  });
  rows.push({
    RowType: 'Section',
    Title: '',
    Rows: [{
      RowType: 'Row',
      Cells: [{ Value: 'Net Profit' }, ...columns.map((_, i) => ({ Value: money(sectionTotal('Income', i) - sectionTotal('Less Cost of Sales', i) - sectionTotal('Less Operating Expenses', i)) }))],
    }],
  });
  return envelope({
    _request: { endpoint: 'GET /api.xro/2.0/Reports/ProfitAndLoss', params: { fromDate, toDate, standardLayout: true, paymentsOnly: false, ...params } },
    Reports: [{
      ReportID: 'ProfitAndLoss',
      ReportName: 'Profit and Loss',
      ReportType: 'ProfitAndLoss',
      ReportTitles: ['Profit and Loss', 'Lowther Studio Ltd (fictional)', title],
      ReportDate: '2 September 2026',
      UpdatedDateUTC: msDate('2026-09-02T09:14:00Z'),
      Fields: [],
      Rows: rows,
    }],
  });
}

// ---------- The fictional month ----------
const aug26: Col = { '200': 200000, '310': 96000, '320': 21000, '325': 3000, '469': 9000, '477': 28000, '485': 4500, '400': 3200, '463': 1000, '489': 4800 };
const ytd26: Col = { '200': 960000, '310': 470000, '320': 98000, '325': 15000, '469': 45000, '477': 140000, '485': 22500, '400': 17000, '463': 6000, '489': 4800, '429': 18700 };
const aug25: Col = { '200': 170000, '310': 84000, '320': 19750, '325': 2500, '469': 8500, '477': 26000, '485': 4000, '400': 3000, '463': 1500, '429': 3000 };
const ytd25: Col = { '200': 845000, '310': 418000, '320': 98125, '325': 12000, '469': 42500, '477': 130000, '485': 20000, '400': 16000, '463': 7500, '429': 24000 };

write('xero_pl_2026-08.json', profitAndLoss('For the month ended 31 August 2026', '2026-08-01', '2026-08-31', [{ header: '31 Aug 26', values: aug26 }], {}));
write('xero_pl_ytd_2026-04_2026-08.json', profitAndLoss('1 April 2026 to 31 August 2026', '2026-04-01', '2026-08-31', [{ header: '1 Apr 26 - 31 Aug 26', values: ytd26 }], {}));
write('xero_pl_2025-08.json', profitAndLoss('For the month ended 31 August 2025', '2025-08-01', '2025-08-31', [{ header: '31 Aug 25', values: aug25 }], {}));
write('xero_pl_ytd_2025-04_2025-08.json', profitAndLoss('1 April 2025 to 31 August 2025', '2025-04-01', '2025-08-31', [{ header: '1 Apr 25 - 31 Aug 25', values: ytd25 }], {}));

// P&L by the "Client" tracking category. Delivery staff costs carry no tracking: Xero shows them as Unassigned.
const CLIENTS = ['Orchard Lane Foods', 'Kestrel Mobility', 'Brightwater Housing', 'Marlow & Finch', 'Other clients'];
const clientRevenue: Record<string, number[]> = {
  // Apr, May, Jun, Jul, Aug 2026
  'Orchard Lane Foods': [53000, 57000, 58000, 58000, 62000],
  'Kestrel Mobility': [43000, 44000, 45000, 46000, 48000],
  'Brightwater Housing': [33000, 34000, 34500, 35000, 36000],
  'Marlow & Finch': [30000, 31000, 30500, 28500, 18000],
  'Other clients': [26000, 24000, 24000, 25500, 36000],
};
const augTracked: Record<string, { f: number; s: number }> = {
  'Orchard Lane Foods': { f: 8000, s: 1000 },
  'Kestrel Mobility': { f: 6000, s: 800 },
  'Brightwater Housing': { f: 3000, s: 400 },
  'Marlow & Finch': { f: 1500, s: 300 },
  'Other clients': { f: 2500, s: 500 },
};
const TRACKING_ID = uid('tracking-client');
const monthNames = ['April', 'May', 'June', 'July', 'August'];
const monthEnds = ['2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31'];
for (let m = 1; m <= 4; m++) {
  const cols = CLIENTS.map((c) => ({ header: c, values: { '200': clientRevenue[c][m], ...(m === 4 ? { '320': augTracked[c].f, '325': augTracked[c].s } : {}) } as Col }));
  // Unassigned column: untracked costs (and for May-Jul we only fetch income lines' tracking for the average).
  const unassigned: Col = m === 4 ? { '310': 96000 } : {};
  cols.push({ header: 'Unassigned', values: unassigned });
  const from = monthEnds[m].slice(0, 8) + '01';
  const name = `xero_pl_by_client_2026-${String(m + 4).padStart(2, '0')}.json`;
  const report: any = profitAndLoss(`For the month ended ${monthEnds[m].slice(8)} ${monthNames[m]} 2026, by Client`, from, monthEnds[m], cols, { trackingCategoryID: TRACKING_ID });
  if (m < 4) report._note = 'Income rows only are used from this month (for the three-month client average); cost rows omitted from the fixture.';
  write(name, report);
}
{
  const cols = CLIENTS.map((c) => ({ header: c, values: { '200': clientRevenue[c].reduce((a, b) => a + b, 0) } as Col }));
  cols.push({ header: 'Unassigned', values: {} });
  const r: any = profitAndLoss('1 April 2026 to 31 August 2026, by Client', '2026-04-01', '2026-08-31', cols, { trackingCategoryID: TRACKING_ID });
  r._note = 'Income rows only.';
  write('xero_pl_by_client_ytd_2026.json', r);
}

// Trial balance at 31 August 2026. Debit/Credit read here as the month's movement for P&L accounts, YTD columns as the
// financial year to date. (Cell semantics to confirm on a real organisation: see README, "Not wired".)
{
  const tbRow = (name: string, code: string, dr: number | '', cr: number | '', ydr: number | '', ycr: number | '') => ({
    RowType: 'Row',
    Cells: [cell(`${name} (${code})`, code), ...[dr, cr, ydr, ycr].map((v) => cell(v === '' ? '' : money(v), code))],
  });
  const pl = ACCOUNTS.filter((a) => (ytd26[a.code] ?? 0) !== 0);
  const rev = pl.filter((a) => a.section === 'Income');
  const exp = pl.filter((a) => a.section !== 'Income');
  const bs = { assets: [['Business current account', '090', 310000], ['Accounts Receivable', '610', 245000]], liabilities: [['Accounts Payable', '800', 38000], ['VAT', '820', 41000], ['PAYE & NIC payable', '825', 36000], ['Accruals', '821', 0]], equity: [['Share capital', '970', 100], ['Retained earnings', '960', 316900]] } as const;
  const sumDr = exp.reduce((s, a) => s + ytd26[a.code], 0) + 310000 + 245000;
  const sumCr = rev.reduce((s, a) => s + ytd26[a.code], 0) + 38000 + 41000 + 36000 + 100 + 316900;
  if (sumDr !== sumCr) throw new Error(`trial balance does not balance: ${sumDr} vs ${sumCr}`);
  write('xero_trial_balance_2026-08-31.json', envelope({
    _request: { endpoint: 'GET /api.xro/2.0/Reports/TrialBalance', params: { date: '2026-08-31', paymentsOnly: false } },
    Reports: [{
      ReportID: 'TrialBalance',
      ReportName: 'Trial Balance',
      ReportType: 'TrialBalance',
      ReportTitles: ['Trial Balance', 'Lowther Studio Ltd (fictional)', 'As at 31 August 2026'],
      ReportDate: '2 September 2026',
      UpdatedDateUTC: msDate('2026-09-02T09:14:00Z'),
      Fields: [],
      Rows: [
        { RowType: 'Header', Cells: ['Account', 'Debit', 'Credit', 'YTD Debit', 'YTD Credit'].map((v) => ({ Value: v })) },
        { RowType: 'Section', Title: 'Revenue', Rows: rev.map((a) => tbRow(a.name, a.code, '', aug26[a.code] ?? 0, '', ytd26[a.code])) },
        { RowType: 'Section', Title: 'Expenses', Rows: exp.map((a) => tbRow(a.name, a.code, aug26[a.code] ?? 0, '', ytd26[a.code], '')) },
        { RowType: 'Section', Title: 'Assets', Rows: bs.assets.map(([n, c, v]) => tbRow(n, c, '', '', v, '')) },
        { RowType: 'Section', Title: 'Liabilities', Rows: bs.liabilities.map(([n, c, v]) => tbRow(n, c, '', '', '', v)) },
        { RowType: 'Section', Title: 'Equity', Rows: bs.equity.map(([n, c, v]) => tbRow(n, c, '', '', '', v)) },
        { RowType: 'Section', Title: '', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total' }, { Value: '' }, { Value: '' }, { Value: money(sumDr) }, { Value: money(sumCr) }] }] },
      ],
    }],
  }));
}

// Budget: one OVERALL budget, flat-phased. Its version and approval live in Description (Xero has no approval field).
{
  const monthly: Col = { '200': 190000, '310': 94000, '320': 21000, '325': 2800, '469': 9000, '477': 28500, '485': 4800, '400': 4000, '463': 2500, '429': 3200 };
  const periods = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  write('xero_budget.json', envelope({
    _request: { endpoint: 'GET /api.xro/2.0/Budgets/{BudgetID}', params: { DateFrom: '2026-04-01', DateTo: '2026-09-30' } },
    Budgets: [{
      BudgetID: uid('budget-fy27'),
      Type: 'OVERALL',
      Description: 'FY2026-27 budget v2 (approved by the board 12 Mar 2026)',
      UpdatedDateUTC: msDate('2026-03-12T16:02:00Z'),
      BudgetLines: Object.entries(monthly).map(([code, amt]) => ({
        AccountID: acctId(code),
        AccountCode: code,
        BudgetBalances: periods.map((p) => ({ Period: p, Amount: String(amt), Notes: '' })),
      })),
      Tracking: [],
    }],
  }));
}

// Invoices (ACCREC) raised in August, pulled on 1 September; an incremental pull on 2 September
// (If-Modified-Since) returned INV-2291 again after its Reference was edited. Same InvoiceID, two records.
{
  const contacts: Record<string, string> = {
    'Orchard Lane Foods': 'Orchard Lane Foods', 'Kestrel Mobility': 'Kestrel Mobility', 'Brightwater Housing': 'Brightwater Housing',
    'Marlow & Finch': 'Marlow & Finch', 'Tidewell Distillery': 'Other clients', 'Pennant Rowing Club': 'Other clients', 'Arden Lettings': 'Other clients',
  };
  const inv = (n: number, contact: string, date: string, amount: number, desc: string, updated = '2026-08-31T18:00:00Z', reference = '') => ({
    Type: 'ACCREC',
    InvoiceID: uid('inv-' + n),
    InvoiceNumber: `INV-${n}`,
    Reference: reference,
    Contact: { ContactID: uid('contact-' + contact), Name: contact },
    DateString: `${date}T00:00:00`,
    Date: msDate(date + 'T00:00:00Z'),
    DueDateString: `${date}T00:00:00`,
    Status: 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
    LineItems: [{
      Description: desc, Quantity: 1, UnitAmount: amount, AccountCode: '200', TaxType: 'OUTPUT2', TaxAmount: amount * 0.2, LineAmount: amount,
      Tracking: [{ TrackingCategoryID: TRACKING_ID, Name: 'Client', Option: contacts[contact] }],
    }],
    SubTotal: amount, TotalTax: amount * 0.2, Total: amount * 1.2, CurrencyCode: 'GBP',
    UpdatedDateUTC: msDate(updated),
  });
  const list = [
    inv(2281, 'Orchard Lane Foods', '2026-08-01', 24000, 'August retainer'),
    inv(2282, 'Kestrel Mobility', '2026-08-01', 20000, 'August retainer'),
    inv(2283, 'Brightwater Housing', '2026-08-03', 12000, 'Tenant portal design, stage 2'),
    inv(2284, 'Marlow & Finch', '2026-08-03', 12000, 'August retainer'),
    inv(2285, 'Tidewell Distillery', '2026-08-07', 9000, 'Packaging refresh'),
    inv(2286, 'Orchard Lane Foods', '2026-08-12', 24000, 'Autumn campaign, phase 2'),
    inv(2287, 'Pennant Rowing Club', '2026-08-14', 7500, 'Website rebuild, deposit'),
    inv(2288, 'Kestrel Mobility', '2026-08-18', 28000, 'App onboarding redesign'),
    inv(2289, 'Brightwater Housing', '2026-08-20', 24000, 'Tenant portal build, stage 3'),
    inv(2290, 'Arden Lettings', '2026-08-24', 19500, 'Brand identity'),
    inv(2291, 'Orchard Lane Foods', '2026-08-27', 14000, 'Autumn campaign, production'),
    inv(2292, 'Marlow & Finch', '2026-08-28', 12000, 'Seasonal catalogue'),
  ];
  write('xero_invoices_pull_2026-09-01.json', envelope({
    _request: { endpoint: 'GET /api.xro/2.0/Invoices', params: { where: 'Type=="ACCREC" AND Date>=DateTime(2026,08,01) AND Date<=DateTime(2026,08,31)', page: 1 } },
    Invoices: list,
  }));
  write('xero_invoices_pull_2026-09-02_modified.json', envelope({
    _request: { endpoint: 'GET /api.xro/2.0/Invoices', headers: { 'If-Modified-Since': '2026-09-01T09:00:00Z' }, params: { where: 'Type=="ACCREC"', page: 1 } },
    Invoices: [inv(2291, 'Orchard Lane Foods', '2026-08-27', 14000, 'Autumn campaign, production', '2026-09-02T08:41:00Z', 'PO 7781')],
  }));
  write('xero_credit_notes_2026-08.json', envelope({
    _request: { endpoint: 'GET /api.xro/2.0/CreditNotes', params: { where: 'Type=="ACCRECCREDIT" AND Date>=DateTime(2026,08,01) AND Date<=DateTime(2026,08,31)' } },
    CreditNotes: [{
      Type: 'ACCRECCREDIT',
      CreditNoteID: uid('cn-0147'),
      CreditNoteNumber: 'CN-0147',
      Reference: 'Against INV-2261 (July): scope reduced after sign-off',
      Contact: { ContactID: uid('contact-Marlow & Finch'), Name: 'Marlow & Finch' },
      DateString: '2026-08-29T00:00:00',
      Date: msDate('2026-08-29T00:00:00Z'),
      Status: 'AUTHORISED',
      LineAmountTypes: 'Exclusive',
      LineItems: [{ Description: 'Credit: July catalogue scope reduction', Quantity: 1, UnitAmount: 6000, AccountCode: '200', TaxType: 'OUTPUT2', TaxAmount: 1200, LineAmount: 6000, Tracking: [{ TrackingCategoryID: TRACKING_ID, Name: 'Client', Option: 'Marlow & Finch' }] }],
      SubTotal: 6000, TotalTax: 1200, Total: 7200, CurrencyCode: 'GBP',
      UpdatedDateUTC: msDate('2026-08-29T15:20:00Z'),
    }],
  }));
  write('xero_manual_journals_2026-08.json', envelope({
    _request: { endpoint: 'GET /api.xro/2.0/ManualJournals', params: { where: 'Date>=DateTime(2026,08,01) AND Date<=DateTime(2026,08,31)' } },
    ManualJournals: [],
  }));
}

write('xero_accounts.json', envelope({
  _request: { endpoint: 'GET /api.xro/2.0/Accounts' },
  Accounts: [
    ...ACCOUNTS.map((a) => ({ AccountID: acctId(a.code), Code: a.code, Name: a.name, Type: a.section === 'Income' ? 'REVENUE' : a.section === 'Less Cost of Sales' ? 'DIRECTCOSTS' : 'OVERHEADS', Class: a.section === 'Income' ? 'REVENUE' : 'EXPENSE', Status: 'ACTIVE' })),
    { AccountID: acctId('260'), Code: '260', Name: 'Recharged production costs', Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE' },
    { AccountID: acctId('821'), Code: '821', Name: 'Accruals', Type: 'CURRLIAB', Class: 'LIABILITY', Status: 'ACTIVE' },
  ],
}));
write('xero_organisation.json', envelope({
  _request: { endpoint: 'GET /api.xro/2.0/Organisation' },
  Organisations: [{ OrganisationID: uid('org'), Name: 'Lowther Studio Ltd (fictional)', BaseCurrency: 'GBP', CountryCode: 'GB', FinancialYearEndDay: 31, FinancialYearEndMonth: 3, OrganisationType: 'COMPANY' }],
}));
write('xero_tracking_categories.json', envelope({
  _request: { endpoint: 'GET /api.xro/2.0/TrackingCategories' },
  TrackingCategories: [{ TrackingCategoryID: TRACKING_ID, Name: 'Client', Status: 'ACTIVE', Options: [...CLIENTS.map((c) => ({ TrackingOptionID: uid('opt-' + c), Name: c, Status: 'ACTIVE' }))] }],
}));

// Payroll bureau run report for the September payroll (not Xero). Six August-earned lines, then September basic pay.
{
  const lines = [
    ['employee_ref', 'team', 'element', 'earned_period', 'gross', 'employer_nic', 'employer_pension'],
    ['D03', 'Delivery', 'August overtime and delivery bonus', '2026-08', '2000.00', '300.00', '100.00'],
    ['D07', 'Delivery', 'August overtime and delivery bonus', '2026-08', '1500.00', '225.00', '75.00'],
    ['D08', 'Delivery', 'August overtime and delivery bonus', '2026-08', '2500.00', '375.00', '125.00'],
    ['D11', 'Delivery', 'August overtime and delivery bonus', '2026-08', '1000.00', '150.00', '50.00'],
    ['D14', 'Delivery', 'August overtime and delivery bonus', '2026-08', '1800.00', '270.00', '90.00'],
    ['D19', 'Delivery', 'August overtime and delivery bonus', '2026-08', '1200.00', '180.00', '60.00'],
    ['ALL', 'Delivery', 'September basic pay', '2026-09', '74000.00', '9600.00', '3700.00'],
  ];
  mkdirSync(new URL('../data/workpapers/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../data/workpapers/payroll_run_2026-09.csv', import.meta.url), lines.map((l) => l.join(',')).join('\n') + '\n');
}
console.log('fixtures written');
