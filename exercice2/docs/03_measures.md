# Phase 3: DAX measures

There are **65 measures**, written in [`dax/measures.dax`](../dax/measures.dax). That file is the single source: `tools/build-pbip.ps1` reads it and puts the measures into the model, in a `_Measures` table. Each measure has:
- a **display folder**,
- a **format string** (`#,0.00 "TND"`, `0.0%`, `#,0`),
- a **plain-language description**, which Power BI shows when you hover the measure in the Data pane.

Everything was tested against the loaded model on 17 Nov 2026 (results below) and saved in `BOI360.pbix`.

## Business rules built into the measures

| Rule | Where | Value |
|---|---|---|
| Revenue excludes **Cancelled** transactions | `[Revenue]`, `[Profit]`, `[Cost]`, `[Transactions]`, `[Units Sold]`, AOV, margin | 2,626,958.24 TND |
| Collected = **Paid**; Receivables = **Pending + Overdue** | `[Collected Revenue]`, `[Receivables]` | 921,017.76 / 1,705,940.48 |
| Cancelled is reported on its own | `[Cancelled Revenue]`, `[Cancellation Rate %]` | 1,023,241.33 (28.0 %) |
| Expenses = **Approved** only; Pending is the pipeline; Rejected is excluded | `[Approved Expenses]`, `[Pending Expenses]`, `[Rejected Expenses]` | 215,363.87 / 258,096.31 / 179,911.20 |
| "Today" = **Reference Date** = last sales date | `[Reference Date]`, used by overdue and past-deadline measures | 2026-11-16 |
| Project measures use the **owning department** | `USERELATIONSHIP(projects[department_id], departments[department_id])` | |

## The DAX techniques, and why

| Technique | Example | Why |
|---|---|---|
| **Build on base measures** | `[Profit Margin %] = DIVIDE([Profit], [Revenue])` | Each rule is defined once. Change `[Revenue]` and every measure that uses it follows. |
| **`DIVIDE` instead of `/`** | `DIVIDE([Revenue], [Transactions])` | Returns blank instead of an error when the divisor is 0 or blank. |
| **`KEEPFILTERS` inside `CALCULATE`** | `CALCULATE([Gross Revenue], KEEPFILTERS(payment_status <> "Cancelled"))` | Without it, `CALCULATE` *replaces* a filter the user set on the same column. With it, a visual filtered to "Cancelled" correctly shows a blank `[Revenue]`, not 2.6 M. |
| **Variables (`VAR … RETURN`)** | `[Overdue Tasks]` stores `[Reference Date]` once | Easier to read, and each expression is calculated only once. |
| **Recalculate ratios, never sum them** | `[Target Achievement %] = DIVIDE(SUM(actual), SUM(target))` | Averaging the stored `achievement_pct` gives **95.81 %**; the correct figure is **96.15 %**. Big months must weigh more than small ones. |
| **Weighted averages** | `[Average Discount %] = 1 - Revenue / (quantity × unit price)` | A 15 % discount on a 24,000 TND order matters more than one on a 500 TND order. Result: 5.97 %. |
| **`USERELATIONSHIP`** | `[Project Budget]`, `[Tasks Created]`, `[Hires]`, `[Projects Due in Period]` | Switches on an inactive relationship from Phase 2 for that one calculation. |
| **Context transition in an iterator** | `[Sellers Below Target]`: `ADDCOLUMNS(VALUES(employees[employee_id]), "@target", [Target Amount], …)` | Evaluates each measure *per seller*, then counts the sellers below 100 %. |
| **Time intelligence on the marked Date table** | `DATEADD`, `SAMEPERIODLASTYEAR`, `DATESBETWEEN` | These functions need a contiguous, marked date table (Phase 2). |
| **No `+ 0` in measures** | — | `+ 0` makes visuals list every member (all 48 employees, the "(Blank)" department) with a 0. Empty cards are handled in Phase 4 instead. |

## Time intelligence: the edge cases

The dataset covers 1 Jan – 16 Nov 2026 only, which shapes these measures:

| Measure | By month | On a card with no date filter |
|---|---|---|
| `[Revenue PM]`, `[Revenue MoM %]` | Previous month and % change | **Blank**: "previous month of everything" has no meaning |
| `[Revenue PY]`, `[Revenue YoY %]` | **Blank**: there is no 2025 data | Blank |
| `[Revenue Running Total]` | Cumulative up to that month, then stops after 16 Nov | 2,626,958.24 |
| `[Revenue YTD]` | Same as the running total for 2026 | 2,626,958.24 |
| `[Revenue Rolling 3M]` | That month and the two before it | **Sep 1 – Nov 16**: 638,441.81 |

> **November 2026 is a partial month.** Its MoM is −64.6 % only because the data stops on the 16th. Phase 4 visuals will label it.

YoY is kept on purpose: when 2027 data arrives, it works without changes.

## Measure catalogue (display folders)

| Folder | Measures |
|---|---|
| 00 Reference | Reference Date |
| 01 Sales | Gross Revenue, **Revenue**, Collected Revenue, Receivables, Overdue Revenue, Cancelled Revenue, Cancellation Rate %, Collection Rate %, Cost, Profit, Profit Margin %, Transactions, Average Order Value, Units Sold, Average Discount %, Revenue per Customer, Customers with Sales |
| 02 Time Intelligence | Revenue PM, Revenue MoM %, Revenue PY, Revenue YoY %, Revenue Running Total, Revenue YTD, Revenue Rolling 3M |
| 03 Targets | Target Amount, Target Actual Sales, Target Achievement %, Gap to Target, Sellers Below Target |
| 04 Finance | Approved Expenses, Pending Expenses, Rejected Expenses, Submitted Expenses, Expense Approval Rate %, Expense Claims |
| 05 Projects | Project Budget, Project Actual Cost, Budget Variance, Budget Utilization %, Projects, Projects Over Budget, Projects Past Deadline, Projects Due in Period |
| 06 Tasks | Tasks, Open Tasks, Completed Tasks, Blocked Tasks, Overdue Tasks, Task Completion Rate %, Overdue Rate %, Average Days Overdue, Tasks Created |
| 07 People | Employees, Active Employees, Employees On Leave, Hires, Leave Requests, Leave Days, Approved Leave Days, Pending Leave Days, Leave Approval Rate % |
| 09 Data Quality | Employees with Shared Email, Expenses Without Project, Cross-Department Project Expenses |

The what-if measures (target change, commission rate) come in Phase 6 with their parameters.

## Validation

**All 65 measures load with no errors** (state *Ready*). 31 of them were compared with values computed **directly from the CSVs in PowerShell**, independently of DAX. **31 / 31 match.**

| Measure | Expected (CSV) | Model |
|---|---:|---:|
| Revenue | 2,626,958.24 | ✅ |
| Profit / Profit Margin % | 971,081.16 / 36.97 % | ✅ |
| Transactions / AOV / Units | 444 / 5,916.57 / 1,927 | ✅ |
| Collected / Receivables / Cancelled | 921,017.76 / 1,705,940.48 / 1,023,241.33 | ✅ |
| Average Discount % (weighted) | 5.97 % | ✅ |
| Target Amount / Achievement % / Sellers Below Target | 2,770,000 / 96.15 % / 6 | ✅ |
| Approved / Pending Expenses | 215,363.87 / 258,096.31 | ✅ |
| Project Budget / Utilization % / Over Budget / Past Deadline | 1,755,000 / 58.15 % / 3 / 11 | ✅ |
| Open / Overdue Tasks / Completion % / Avg Days Overdue | 67 / 67 / 25.6 % / 148.5 | ✅ |
| Employees / Active / Leave Days / Approved Leave Days / Leave Approval % | 48 / 41 / 271 / 92 / 48.6 % | ✅ |
| Expenses Without Project / Cross-Department Project Expenses | 59,620.07 / 120,721.99 | ✅ |

**Context tests:**
- **By month:** the 11 monthly revenues add up to the total. Rolling 3M for April = Feb + Mar + Apr = 660,203.12 ✅.
- **By payment status:** `[Revenue]` is blank for Cancelled, `[Collected Revenue]` appears only on Paid, and `[Receivables]` only on Pending and Overdue ✅.
- **By department:** project budget is Sales 645,000 + Operations 720,000 + IT 390,000 = 1,755,000. Marketing, Finance and HR own no projects, so they're blank ✅.

## Try it yourself

In Power BI Desktop, open **DAX query view** (fourth icon in the left bar) and run:

```dax
EVALUATE
SUMMARIZECOLUMNS (
    'Date'[Year Month Number], 'Date'[Year Month],
    "Revenue", [Revenue],
    "MoM %", [Revenue MoM %],
    "Running total", [Revenue Running Total],
    "Rolling 3M", [Revenue Rolling 3M],
    "Target achievement", [Target Achievement %]
)
ORDER BY 'Date'[Year Month Number]
```

**Question:** if `[Revenue]` had no `KEEPFILTERS`, what would a table of `[Revenue]` by payment status show?
(Answer: 2,626,958.24 on every row, Cancelled included. The `<> "Cancelled"` filter would *replace* each row's own status filter.)
