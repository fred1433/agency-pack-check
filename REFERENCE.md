# Reference case, calculated by hand

Every figure here was worked out by hand from the scenario, before and independently of the engine, and typed into
`tests/expected.json`. `tests/reference.test.ts` compares the engine to it. If you want to check the code without
trusting either Claude or us, check this page against the source files, then run the tests.

All data is fictional. Lowther Studio Ltd does not exist.

## Definitions (illustrative assumptions, replace with your own)

| Measure | Definition |
|---|---|
| Revenue | P&L section "Income" (account 200 Sales - fees). Fees recognised when invoiced; credit notes reduce revenue in the month issued. Recharged costs (account 260): no activity in the period. |
| Direct costs | P&L section "Less Cost of Sales" (310 Delivery staff costs, 320 Freelancers, 325 Client delivery software), plus approved reporting adjustments. |
| Gross profit | Revenue minus direct costs. |
| Gross margin | Gross profit / revenue, as a percentage. |
| Overheads | P&L section "Less Operating Expenses". |
| Operating profit | Gross profit minus overheads (Xero's "Net Profit" here: the fixture has no interest or tax lines). |
| Budget | Xero Budgets endpoint, OVERALL budget "FY2026-27 budget v2", sum of BudgetBalances by account type for the periods. |
| Year to date | 1 April to 31 August 2026 (year end 31 March, read from Organisation). |
| Prior year | Same periods of 2025. |
| Client revenue | P&L by the "Client" tracking category, Income rows. |
| Three-month average | Mean of May, June and July 2026 client revenue. |
| Rounding | Half away from zero at display precision: whole pounds, one decimal for % and percentage points. Variances are computed from unrounded values, then rounded. |
| % change | (actual - comparator) / comparator. Not meaningful ("n/m") when the comparator is zero or negative. |

## Source totals

August 2026 (posted): revenue 200,000. Direct costs 96,000 + 21,000 + 3,000 = 120,000.
Overheads 9,000 + 28,000 + 4,500 + 3,200 + 1,000 + 4,800 = 50,500.

Year to date 2026 (posted): revenue 960,000. Direct costs 470,000 + 98,000 + 15,000 = 583,000.
Overheads 45,000 + 140,000 + 22,500 + 17,000 + 6,000 + 4,800 + 18,700 = 254,000.

August 2025: revenue 170,000; direct costs 84,000 + 19,750 + 2,500 = 106,250; overheads 8,500 + 26,000 + 4,000 + 3,000 + 1,500 + 3,000 = 46,000.

Year to date 2025: revenue 845,000; direct costs 418,000 + 98,125 + 12,000 = 528,125; overheads 42,500 + 130,000 + 20,000 + 16,000 + 7,500 + 24,000 = 240,000.

Budget, per month (flat): revenue 190,000; direct costs 94,000 + 21,000 + 2,800 = 117,800; overheads 9,000 + 28,500 + 4,800 + 4,000 + 2,500 + 3,200 = 52,000. No line for 489 Recruitment fees.
Year to date (5 months): revenue 950,000; direct costs 589,000; overheads 260,000.

## The close question

Payroll run report for September, lines earned in August:

| Ref | Gross | Employer NIC 15% | Employer pension 5% |
|---|---|---|---|
| D03 | 2,000 | 300 | 100 |
| D07 | 1,500 | 225 | 75 |
| D08 | 2,500 | 375 | 125 |
| D11 | 1,000 | 150 | 50 |
| D14 | 1,800 | 270 | 90 |
| D19 | 1,200 | 180 | 60 |
| Total | 10,000 | 1,500 | 500 |

Accrual: 10,000 + 1,500 + 500 = 12,000, to account 310, August. The "September basic pay" line (earned 2026-09) is excluded.

## August 2026

| | Posted | After the accrual | Budget | August 2025 |
|---|---|---|---|---|
| Revenue | 200,000 | 200,000 | 190,000 | 170,000 |
| Direct costs | 120,000 | 132,000 | 117,800 | 106,250 |
| Gross profit | 80,000 | 68,000 | 72,200 | 63,750 |
| Gross margin | 80,000 / 200,000 = 40.0% | 68,000 / 200,000 = 34.0% | 72,200 / 190,000 = 38.0% | 63,750 / 170,000 = 37.5% |
| Overheads | 50,500 | 50,500 | 52,000 | 46,000 |
| Operating profit | 29,500 | 17,500 | 20,200 | 17,750 |

Variances, posted: revenue +10,000 on budget (10,000 / 190,000 = 5.263% → 5.3%), +30,000 on last year (30,000 / 170,000 = 17.647% → 17.6%).
Gross margin +2.0 points on budget, +2.5 on last year. Gross profit +7,800 on budget (7,800 / 72,200 = 10.803% → 10.8%).
Operating profit +9,300 on budget (46.04% → 46.0%), +11,750 on last year (66.197% → 66.2%).

Variances, after the accrual: gross margin -4.0 points on budget, -3.5 on last year. Gross profit -4,200 on budget
(4,200 / 72,200 = 5.817% → 5.8% below). Direct costs +14,200 on budget (14,200 / 117,800 = 12.054% → 12.1%).
Operating profit -2,700 on budget (2,700 / 20,200 = 13.366% → 13.4% below), -250 on last year (250 / 17,750 = 1.408% → 1.4% below).

## Year to date

| | Posted | After the accrual | Budget | 2025 |
|---|---|---|---|---|
| Revenue | 960,000 | 960,000 | 950,000 | 845,000 |
| Direct costs | 583,000 | 595,000 | 589,000 | 528,125 |
| Gross profit | 377,000 | 365,000 | 361,000 | 316,875 |
| Gross margin | 39.2708% → 39.3% | 38.0208% → 38.0% | 38.0% | 37.5% |
| Overheads | 254,000 | 254,000 | 260,000 | 240,000 |
| Operating profit | 123,000 | 111,000 | 101,000 | 76,875 |

Gross margin against budget after the accrual: 38.0208 - 38.0 = +0.0208 points, which shows as 0.0: the commentary
may only call it "in line with budget". Revenue +10,000 on budget (1.053% → 1.1%), +115,000 on last year
(13.609% → 13.6%). Operating profit posted +46,125 on last year (46,125 / 76,875 = 60.0%).

## Clients (Client tracking category)

| | Apr | May | Jun | Jul | Aug | Year to date |
|---|---|---|---|---|---|---|
| Orchard Lane Foods | 53,000 | 57,000 | 58,000 | 58,000 | 62,000 | 288,000 |
| Kestrel Mobility | 43,000 | 44,000 | 45,000 | 46,000 | 48,000 | 226,000 |
| Brightwater Housing | 33,000 | 34,000 | 34,500 | 35,000 | 36,000 | 172,500 |
| Marlow & Finch | 30,000 | 31,000 | 30,500 | 28,500 | 18,000 | 138,000 |
| Other clients | 26,000 | 24,000 | 24,000 | 25,500 | 36,000 | 135,500 |
| Total | 185,000 | 190,000 | 192,000 | 193,000 | 200,000 | 960,000 |

Orchard Lane Foods: 62,000 / 200,000 = 31.0% of August revenue; 288,000 / 960,000 = 30.0% year to date.
Marlow & Finch: May to July average (31,000 + 30,500 + 28,500) / 3 = 30,000; August 18,000 is 12,000 below, 40.0%.
Of that fall, 6,000 is credit note CN-0147 (July work, issued 29 August).

## Reconciliations

- Invoices dated August: 24,000 + 20,000 + 12,000 + 12,000 + 9,000 + 24,000 + 7,500 + 28,000 + 24,000 + 19,500 + 14,000 + 12,000 = 206,000 across 12 invoices.
  Credit notes: 6,000. 206,000 - 6,000 = 200,000 = August revenue. The 2 September pull repeats INV-2291 (14,000); counted twice, invoices would be 220,000.
- Trial balance, year to date: debits 583,000 + 254,000 + 310,000 + 245,000 = 1,392,000; credits 960,000 + 38,000 + 41,000 + 36,000 + 100 + 316,900 = 1,392,000.
- Client columns, August: 62,000 + 48,000 + 36,000 + 18,000 + 36,000 = 200,000, unassigned revenue nil. Direct costs unassigned: 96,000 of 120,000.
