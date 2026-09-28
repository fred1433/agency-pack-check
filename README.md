# agency-pack-check

A synthetic prototype of a monthly management-pack workflow for an agency: Claude writes the commentary with
references instead of numbers, code supplies every figure, two sets of checks run, and a close question holds the
release until a reviewer decides it. One page exports to an editable PowerPoint slide.

Everything is fictional: Lowther Studio Ltd, its clients and its figures do not exist.

Live page: https://theaipipe.com/agency-pack/

## The case

The posted August figures are right, and the draft Claude wrote from them agrees with every one. The September
payroll run pays £12,000 of overtime, bonuses, employer NIC and pension earned in August, and nothing for it is in the
August ledger. Approving the accrual moves August gross margin from 40.0% (2.0 points above budget) to 34.0% (4.0 points
below). The draft written for the posted figures, re-read against the approved snapshot, now makes false claims, and
the release control will not let it through. A draft written for the approved snapshot passes, the reviewer accepts
what the checker cannot verify, signs off, and the page exports. Editing the text or changing the snapshot voids the
sign-off.

`REFERENCE.md` has every figure calculated by hand, and `tests/expected.json` holds them for the tests.

## Layout

| Path | What |
|---|---|
| `data/source/` | The frozen source snapshot, in the shapes of Xero Accounting API responses |
| `data/workpapers/` | The payroll run report (not a Xero source) |
| `src/xero.ts` | Adapter for `ReportWithRows` and list responses |
| `src/engine.ts` | Metrics, source controls, close questions, coverage rules |
| `src/claims.ts` | The commentary checker and its documented language (`LEXICON`) |
| `src/release.ts` | Release gates and sign-off |
| `src/pack.ts` | Review state, export (PowerPoint) |
| `prompts/commentary.md` | The drafting prompt |
| `data/drafts/` | Every Claude draft, with model, date and prompt: `tuning/` (first batch), `heldout/` (batch 1), `heldout2/` (batch 2) |
| `data/results/` | Evaluation results and the hand adjudication of every natural failure |
| `exports/` | The one-page export produced from the released state |

## Run

```
npm install
npm test                               # 72 tests: reference case, calculation edge cases, claims, release
node scripts/evaluate.ts heldout2      # natural drafts and corrupted copies
node scripts/build-site.ts && node scripts/export-pptx.ts && npx wrangler deploy
```

Node 22.18 or later (TypeScript runs natively).

## Results (checker v2, held-out batch 2)

The checker was frozen (commit history) before batch 2 was drafted. Batch 1 was used to fix it; its results before and
after are kept in `data/results/`.

Twenty drafts by `claude-sonnet-5` through Claude Code, ten per snapshot, as written: 99 sentences; 79 agree to the
snapshot, 13 go to the reviewer (causes, advice, a figure without its measure), 7 do not agree. Of those 7, 3 are real
errors in the draft (a unit written twice, two figures typed instead of cited) and 4 are the checker being wrong
(`data/results/adjudication_heldout2.json`).

Corrupted copies of the same sentences, one change at a time: 2,257 cases; 2,230 rejected, 17 sent to the reviewer,
10 passed. By change: period swapped 507 (494 rejected, 13 to reviewer); measure swapped 381 (381); figure typed 604
(604); comparator swapped 317 (317); client swapped 185 (183, 2 to reviewer); unapproved figure stated as fact 97 (97);
direction word flipped 166 (154, 2 to reviewer, 10 passed). The ten that passed are listed in
`data/results/eval_heldout2.json`: mostly comparisons between two figures in one sentence, which the checker does not
read.

These are counts on one synthetic month, not an accuracy rate.

## Not wired, or approximated

- No Xero organisation: the adapter follows the documented response shapes (Xero-OpenAPI `xero_accounting.yaml`) and has
  not been run against a real or demo organisation. It says "synthetic prototype", not "tested Xero integration".
- Trial balance cells: Debit/Credit are read as the month's movement and YTD columns as the financial year to date; to
  confirm on a real organisation.
- P&L rows do not carry account codes; the adapter maps them through `Accounts`.
- The aged receivables report is not used: nothing in this commentary needs debtor balances.
- Budgets: approval status is read from the budget description; Xero has no approval field.
- Client gross margin is not calculated (delivery staff costs are untracked); utilisation and revenue per head need a
  timesheet and headcount source that is not connected.
- The checker reads a finite language (`LEXICON` in `src/claims.ts`). It does not read comparisons between two figures
  in one sentence, some advisory phrasings ("may wish to"), or causes; causes and advice go to the reviewer.
- Materiality thresholds and the definitions in `REFERENCE.md` are illustrative, set for the demo.
- The page replays frozen drafts: it calls no model. Drafts were produced on the Claude Code subscription with no
  project instructions loaded, and stay as written.
- The PowerPoint is a prototype layout, not a firm's master template.
