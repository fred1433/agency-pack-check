// Adapter for the Xero Accounting API report shape (ReportWithRows) and list endpoints.
// Inputs are named exactly: Reports/ProfitAndLoss, Reports/TrialBalance, Budgets, Invoices, CreditNotes,
// ManualJournals, Organisation, TrackingCategories. No ledger endpoint is assumed (Journals is not used).

export type ReportLine = { section: string; name: string; code: string | null; accountId: string | null; values: (number | null)[] };
export type ParsedReport = {
  reportType: string;
  titles: string[];
  columns: string[];
  lines: ReportLine[];
  summaries: Record<string, (number | null)[]>;
  params: Record<string, unknown>;
};

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`Report cell is not a number: "${v}"`);
  return n;
};

// Xero P&L rows carry "Name" only; trial balance rows carry "Name (Code)". Both carry the account ID in Attributes.
const CODE_IN_NAME = /^(.*) \(([^)]+)\)$/;

export function parseReport(response: any): ParsedReport {
  const report = response?.Reports?.[0];
  if (!report || !Array.isArray(report.Rows)) throw new Error('Not a ReportWithRows response');
  const header = report.Rows.find((r: any) => r.RowType === 'Header');
  const columns = header ? header.Cells.slice(1).map((c: any) => c.Value) : [];
  const lines: ReportLine[] = [];
  const summaries: Record<string, (number | null)[]> = {};
  for (const section of report.Rows) {
    if (section.RowType !== 'Section') continue;
    for (const row of section.Rows ?? []) {
      const [label, ...cells] = row.Cells;
      const values = cells.map((c: any) => num(c.Value));
      if (row.RowType === 'SummaryRow' || !label.Attributes) {
        summaries[label.Value] = values;
        continue;
      }
      const accountId = label.Attributes.find((a: any) => a.Id === 'account')?.Value ?? null;
      const m = CODE_IN_NAME.exec(label.Value);
      lines.push({ section: section.Title, name: m ? m[1] : label.Value, code: m ? m[2] : null, accountId, values });
    }
  }
  return { reportType: report.ReportType, titles: report.ReportTitles ?? [], columns, lines, summaries, params: response._request?.params ?? {} };
}

// Section titles as Xero's standard P&L layout names them.
export const PL_SECTIONS = { income: 'Income', costOfSales: 'Less Cost of Sales', opex: 'Less Operating Expenses' } as const;

export function sectionTotal(r: ParsedReport, section: string, col = 0): number {
  return r.lines.filter((l) => l.section === section).reduce((s, l) => s + (l.values[col] ?? 0), 0);
}

export function columnIndex(r: ParsedReport, header: string): number {
  const i = r.columns.indexOf(header);
  if (i < 0) throw new Error(`Column "${header}" not in report ${r.titles.join(' / ')}`);
  return i;
}

// Account codes are not on P&L rows; the chart of accounts maps AccountID to code. Our fixtures derive IDs
// deterministically, so the snapshot carries its own account map (in a real build: GET /Accounts).
export function linesByAccountId(r: ParsedReport, col = 0): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of r.lines) if (l.accountId) m.set(l.accountId, (m.get(l.accountId) ?? 0) + (l.values[col] ?? 0));
  return m;
}

// "/Date(1756598400000+0000)/" -> ISO date
export function msDateToIso(s: string): string {
  const m = /\/Date\((-?\d+)/.exec(s);
  if (!m) throw new Error(`Not a Microsoft JSON date: ${s}`);
  return new Date(Number(m[1])).toISOString();
}
