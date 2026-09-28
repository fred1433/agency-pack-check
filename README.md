# agency-pack-check

A synthetic prototype of a monthly management-pack workflow for an agency: Claude writes the commentary with
references instead of numbers, code supplies every figure, two sets of checks run, and a close question holds the
release until a reviewer decides it. One page exports to an editable PowerPoint slide.

Everything is fictional: Lowther Studio Ltd, its clients and its figures do not exist.

Live page: https://theaipipe.com/agency-pack/

## The case

The posted August figures are right, and the figures in the draft Claude wrote from them agree. In this fictional
case, the payroll workpaper (approved 1 September) identifies £12,000 of August overtime, bonuses, employer NIC and
pension not included in the posted figures; the adapter does not discover this in Xero. Approving the accrual moves
August gross margin from 40.0% (2.0 points above budget) to 34.0% (4.0 points below). The draft written for the posted
figures, re-read against the approved figures, now makes false claims, and the release control will not let it
through. A draft written for the approved figures passes, the reviewer applies two labelled edits, accepts every
sentence, signs off, and the page exports. Editing the text or changing the approved figures voids the sign-off. The
figures fingerprint binds the figures shown, not the source files.

`REFERENCE.md` has every figure calculated by hand, and `tests/expected.json` holds them for the tests.

## Layout

| Path | What |
|---|---|
| `data/source/` | The frozen source snapshot, in the shapes of Xero Accounting API responses |
| `data/workpapers/` | The payroll input approved on 1 September 2026 (not a Xero source), before the 2 September snapshot |
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
npm test                               # 96 tests: reference case, calculation edge cases, claims, release
node scripts/evaluate.ts heldout2      # natural drafts and corrupted copies
node scripts/build-site.ts && node scripts/export-pptx.ts && npx wrangler deploy
```

Node 22.18 or later (TypeScript runs natively).

## Results (checker v4, held-out batch 2 rerun)

No sentence is ever ticked. The code supplies every figure; each figure is marked when the words around it name its
measure, client or agency, period, comparator (for a variance or budget figure) and direction. The checker flags the
errors it recognises (a typed figure or unit, an unapproved figure stated as fact, a level used as the size of a
difference, two figures whose stated relation is reversed, a month or year outside the snapshot, a measure the pack does
not calculate, an adverse material movement left out) and lists the words it does not read. Every sentence then goes to
the reviewer, and release needs each one accepted.

Batch 2 is an existing batch of twenty `claude-sonnet-5` drafts rerun under v4, not a fresh validation: reviewers had
read some of its sentences. 99 sentences, all to the reviewer: 8 with an error flagged, 62 with another finding, 29
with nothing flagged; 665 figures cited, 6 flagged. Of the 8, 4 are real errors in the drafts (a unit written twice, two
figures typed instead of cited, a 14.4% share said to be below a 9.0% one) and 4 are the checker being wrong
(`data/results/adjudication_checker-v4_heldout2.json`).

Generated mutations of the 29 sentences with nothing flagged, one change at a time: 992 cases; 984 with an error
flagged, 8 with another finding (period not stated), 0 with nothing flagged. They are generated, not individually
adjudicated. Mutating only sentences with no finding keeps a mutation from repairing an error (v3 counted a flipped
"14.4% below 9.0%" as a corruption, though it made the sentence true).

History in `data/results/`: v1 and v2 (held-out batches 1 and 2), v3 after a fresh review (ticked 38 of 99), v4 after
the ChatGPT 6 Pro verdict, which showed a ticked sentence could be false and reach release ("August revenue was above
budget by £200,000"). Its six counterexamples and its omission draft are in `tests/claims.test.ts`.

These are counts on one synthetic month: not an accuracy rate, not a measure of review time saved.

## Reviewer edits

Draft B plus two edits a finance director would make, labelled as hers on the page and in the export: the
operating-profit bridge (revenue £10,000 above budget, direct costs £14,200 above, overheads £1,500 below, operating profit
£2,700 below) and the Marlow & Finch credit note (£6,000 of its £12,000 fall is a credit on July work; excluding it,
August revenue was £24,000, 20.0% below its May to July average). The credit-note figures are metrics the reviewer can
cite; they were not in Claude's prompt.

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
