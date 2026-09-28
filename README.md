# agency-pack-check

A synthetic prototype of a monthly management-pack workflow for an agency: Claude writes the commentary with
references instead of numbers, code supplies every figure, two sets of checks run, and a close question holds the
release until a reviewer decides it. One page exports to an editable PowerPoint slide.

Everything is fictional: Lowther Studio Ltd, its clients and its figures do not exist.

Live page: https://theaipipe.com/agency-pack/

## The case

The posted August figures are right, and the draft Claude wrote from them agrees with every one. The payroll
input approved on 1 September for the September run holds £12,000 of overtime, bonuses, employer NIC and pension earned in August, and nothing for it is in the
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
npm test                               # 86 tests: reference case, calculation edge cases, claims, release
node scripts/evaluate.ts heldout2      # natural drafts and corrupted copies
node scripts/build-site.ts && node scripts/export-pptx.ts && npx wrangler deploy
```

Node 22.18 or later (TypeScript runs natively).

## Results (checker v3, held-out batch 2)

Twenty drafts by `claude-sonnet-5` through Claude Code, ten per snapshot, as written: 99 sentences; 38 ticked (every
figure checked, nothing outside the checked list), 54 sent to the reviewer (causes, judgements, rankings, negations,
advice, a figure without its measure), 7 rejected. Of the 7, 3 are real errors in the draft (a unit written twice, two
figures typed instead of cited) and 4 are the checker being wrong (`data/results/adjudication_checker-v3_heldout2.json`).

Corrupted copies of the same sentences, one change at a time: 2,257 cases; 2,230 rejected, 27 sent to the reviewer,
0 ticked.

History, all kept in `data/results/`: v1 was frozen before held-out batch 1; v2 fixed what batch 1 showed and was
frozen before batch 2 (on batch 2 it ticked 79 sentences and let 10 corrupted cases through); a fresh review then wrote
sentences v2 ticked although they were wrong (rankings, "the same amount", "unlike", negations, "September", "revenue
per head"). v3 sends those to the reviewer or rejects them (`NOT_TICKED` in `tests/claims.test.ts`). Batch 2 was not
used to tune v3, but the reviewer had read two of its sentences.

What the checker verifies, for each figure: the measure, the client or agency, the period, the comparator (for a
variance or a budget figure) and the direction word against the sign. It also rejects typed figures, hand-written
units, unapproved figures stated as fact, months outside the snapshot and measures this pack does not calculate.
Everything else it does not read, and sends to the reviewer.

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
