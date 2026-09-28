// Loads the frozen source snapshot from disk (Node). The browser bundle imports the same files.
import { readFileSync } from 'node:fs';
import type { Sources } from './engine.ts';

const dir = new URL('../data/', import.meta.url);
const j = (f: string) => JSON.parse(readFileSync(new URL('source/' + f, dir), 'utf8'));

export function loadSources(): Sources {
  return {
    organisation: j('xero_organisation.json'), accounts: j('xero_accounts.json'), trackingCategories: j('xero_tracking_categories.json'),
    plMonth: j('xero_pl_2026-08.json'), plYtd: j('xero_pl_ytd_2026-04_2026-08.json'), plPyMonth: j('xero_pl_2025-08.json'), plPyYtd: j('xero_pl_ytd_2025-04_2025-08.json'),
    plByClient: {
      '2026-05': j('xero_pl_by_client_2026-05.json'), '2026-06': j('xero_pl_by_client_2026-06.json'), '2026-07': j('xero_pl_by_client_2026-07.json'),
      '2026-08': j('xero_pl_by_client_2026-08.json'), ytd: j('xero_pl_by_client_ytd_2026.json'),
    },
    trialBalance: j('xero_trial_balance_2026-08-31.json'), budget: j('xero_budget.json'),
    invoicePulls: [j('xero_invoices_pull_2026-09-01.json'), j('xero_invoices_pull_2026-09-02_modified.json')],
    creditNotes: j('xero_credit_notes_2026-08.json'), manualJournals: j('xero_manual_journals_2026-08.json'),
    payrollCsv: readFileSync(new URL('workpapers/payroll_input_2026-09-01.csv', dir), 'utf8'),
  };
}
