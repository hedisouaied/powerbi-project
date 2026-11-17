# Phase 1: Data Quality Report

Business Operations Intelligence 360. Profiled on 17 Nov 2026 with `profiling/profile.ps1`. All data is synthetic and in TND.

## Source files

The package was supposed to include 10 CSVs, but only `Business_Operations_Intelligence_360.xlsx` was supplied. Its README says the workbook holds the same tables. Each sheet was exported, unchanged, to `data/<sheet>.csv`:

- UTF-8, comma-separated, ISO dates, `.` as the decimal separator.
- Numbers are written with the 15 significant digits that Excel shows. The workbook stores some values as floating point, for example `607.5599999999999`; the CSV has `607.56`, exactly as Excel displays it.
- No other value was changed. The workbook is untouched.

| Table | Rows | Columns | Key | Role in the model |
|---|---:|---:|---|---|
| departments | 6 | 4 | department_id | Dimension |
| employees | 48 | 10 | employee_id | Dimension, in several roles |
| projects | 18 | 10 | project_id | Dimension for tasks and expenses; also a fact (budget, cost) |
| targets | 96 | 6 | target_id | Fact: monthly seller targets (8 sellers × 12 months) |
| tasks | 90 | 9 | task_id | Fact |
| customers | 80 | 4 | customer_id | Dimension |
| products | 8 | 4 | product_id | Dimension |
| sales_transactions | 600 | 13 | transaction_id | Fact |
| expenses | 150 | 8 | expense_id | Fact |
| leave_requests | 60 | 8 | leave_id | Fact |

## Checks that passed

- **Primary keys:** every primary key is unique and non-blank, and no table contains duplicate rows.
- **Foreign keys:** all 12 relationships in DATA_DICTIONARY.md are valid; no value points to a missing key.
- **Text and emails:** no leading or trailing spaces and no control characters. Every email has a valid format.
- **Dates:** every date parses as `yyyy-MM-dd`. No end date comes before its start date (projects, tasks, leave).
- **Sales maths:**
  - `revenue = quantity × unit_price × (1 − discount)` holds on all 600 rows.
  - `profit = revenue − cost` holds on all 600 rows.
  - No transaction makes a loss.
- **Targets:** exactly one target per seller per month, and every month starts on day 1.
  - `achievement_pct` equals `actual ÷ target × 100`, rounded to 1 decimal, on 95 of 96 rows.
  - The exception, T0047 (27,034 ÷ 28,000 = 96.55, stored as 96.5), is a rounding-boundary case, not an error.
- **Roles are consistent:**
  - All 8 sellers are in Sales, and they are exactly the 8 target owners.
  - Every project manager belongs to the project's department.
  - No seller sold before their hire date.
- **Coverage:** all 80 customers have sales. Only one employee has no role at all: E012, a Software Developer.

## Issues found

These are documented and either flagged or handled by a rule. None are silently fixed.

| # | Table | Finding | Handling |
|---|---|---|---|
| 1 | employees | **3 emails are shared by two people with the same name:** Salma Bouzid (E017, E028), Mariam Mansour (E020, E048), Bilel Gharbi (E025, E040). The two people in each pair are in different departments and jobs. | Kept. Flagged by the `dq_shared_email` column. Email can't be a key; `employee_id` is the key. |
| 2 | expenses | `project_id` is blank on 42 of 150 rows. | Allowed by the dictionary (department overhead). Converted to null and shown as "No project". |
| 3 | expenses | On 84 of the 108 project expenses, the expense's department is not the project's department. | Real modelling issue: "expenses by department" depends on the filter path. Resolved in Phase 2. |
| 4 | expenses vs projects | Expense amounts don't reconcile with `projects.actual_cost_tnd`. Example: P005 has 28,601 TND of expenses but actual cost 0. | Treated as two separate sources: project cost comes from `projects`, spending from `expenses`. Never added together. |
| 5 | expenses | 58 project expenses are dated outside the project's start–deadline window. | Kept; can be flagged on the Finance page. |
| 6 | sales_transactions | `discount_pct` is a fraction (0, 0.02, 0.05, 0.10, 0.15) even though its name says "pct". | Typed as Percentage, so 0.05 displays as 5 %. |
| 7 | sales_transactions | `unit_price_tnd` is between 88 % and 108 % of the product's list price. | Kept. Price variance is a valid analysis. |
| 8 | sales_transactions | `sales_region` matches the customer's city on only 65 of 600 rows and the seller's city on only 50. Regions are 5 cities; customer and employee cities are 8. | Region is an attribute of the transaction itself. It won't be derived from customer or seller. |
| 9 | sales_transactions | **Revenue by payment status:** Cancelled 1,023,241.33 (28 %), Paid 921,017.76, Overdue 898,734.32, Pending 807,206.16. Gross total 3,650,199.57. | Rule to decide in Phase 3. My proposal is below. |
| 10 | targets | Targets cover Jan–Dec 2026, including December 2026, which has actual sales of 228,207 TND even though transactions stop on 16 Nov 2026. Target actuals total 2,663,222, against 3,650,199.57 of transaction revenue. | Expected: the dictionary says targets are a separate planning dataset. Never compared line by line with transactions. |
| 11 | tasks | All 67 tasks that aren't Done are past their due date (latest due date is 3 Nov 2026). So Overdue Tasks will equal Open Tasks. | Kept. The report will show 100 % of open tasks overdue as a finding, not a bug. |
| 12 | tasks | 39 of 90 tasks were created before their project started, and 23 are due after the project deadline. Tasks of Completed projects are still open (16 of 24). | Kept; shown on the Task Operations page as scheduling issues. |
| 13 | projects | 11 of the 14 projects that aren't Completed are past their deadline. That includes 4 Planned projects (P005, P007, P011, P018) with cost 0 whose deadline has already passed. | Kept. Feeds the "deadline risk" visuals. |
| 14 | projects | 3 projects are over budget: P009 (103 %), P014 (109 %) and P015 (104 %). | Kept on purpose, as the dictionary says; used for variance. |
| 15 | leave_requests | `working_days` equals calendar days in all 60 rows, weekends included. For example, LV016 runs 3–10 Jan, is counted as 8, but has 6 weekdays. | Kept. The measure is labelled "Leave days (calendar)". |
| 16 | leave_requests | E034 has overlapping requests: LV016 (Approved, 3–10 Jan) and LV042 (Submitted, 4–8 Jan). | Kept and listed. Possibly a duplicate submission. |
| 17 | leave_requests | `comment` is blank on 18 of 60 rows. | Optional field. Converted to null. |
| 18 | employees | 7 employees have status "On Leave", but none has an approved leave covering 16 Nov 2026. | The two sources are independent. Headcount uses `employment_status`. |
| 19 | employees | `monthly_salary_tnd` is sensitive. | Loaded, but kept out of the employee directory. Only aggregates appear in visuals. Hidden in Phase 2. |

**No outliers need action.** The IQR test only flags the high end of revenue, cost, profit and unit price (up to 37 of 600 sales rows). These are large orders: up to 8 units of the 3,200 TND product. They are consistent with the maths checks above.

## Distributions

| Field | Values |
|---|---|
| payment_status | Cancelled 156, Overdue 155, Paid 152, Pending 137 |
| sales_region | Monastir 138, Tunis 129, Sfax 119, Sousse 113, Nabeul 101 |
| project_status | On Hold 7, Planned 4, Completed 4, In Progress 3 |
| task_status | In Progress 27, Done 23, Blocked 22, To Do 18 |
| task priority | High 30, Critical 21, Medium 20, Low 19 |
| approval_status (expenses) | Pending 56 (258,096.31), Approved 48 (215,363.87), Rejected 46 (179,911.20) |
| request_status (leave) | Submitted 25 (97 days), Rejected 18 (82 days), Approved 17 (92 days) |
| employment_status | Active 41, On Leave 7 |
| customer_segment | Individual 28, Enterprise 27, SME 25 |
| product category | Services 4, Software 3, Hardware 1 |

## Date coverage

| Column | From | To |
|---|---|---|
| sales_transactions.transaction_date | 2026-01-01 | 2026-11-16 |
| expenses.expense_date | 2026-01-01 | 2026-11-12 |
| targets.target_month | 2026-01-01 | 2026-12-01 |
| tasks created / due | 2026-01-03 | 2026-11-03 |
| projects start / deadline | 2026-02-09 | 2027-02-21 |
| leave start / end | 2026-01-02 | 2026-11-11 |
| employees.hire_date | 2021-01-19 | 2026-03-12 |

- **Date table:** it will run from 1 Jan 2021 to 31 Dec 2027.
- **YoY:** sales cover only 2026, so year-over-year comparison isn't possible. MoM, running total and rolling 3 months are possible.

## Assumptions to confirm before Phase 3

1. **Revenue rule (proposal):**
   - **Net Revenue** = every status except Cancelled (2,626,958.24).
   - **Collected** = Paid.
   - **Receivables** = Pending + Overdue.
   - **Cancelled** is reported on its own and never counted in revenue, profit, AOV or margin.
2. **Expense rule (proposal):**
   - **Expenses** = Approved only.
   - **Pending** is shown as pipeline.
   - **Rejected** is excluded from every total and shown only in the approval breakdown.
3. **Reference date for "overdue" and "past deadline":** use the last transaction date (16 Nov 2026) instead of `TODAY()`, so the numbers don't change each day. With either date the result is the same today.
4. **Leave days:** calendar days, as supplied.
