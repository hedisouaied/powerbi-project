# Phase 1: Import the data into Power BI Desktop

Goal: one `.pbix` file with 10 clean, correctly typed tables. All cleaning is done in Power Query, and the source CSVs are never edited.

> **Already done for you.** `tools/build-pbip.ps1` generated `BOI360.pbip` from the `.pq` files, the model was refreshed, and the result was saved as `BOI360.pbix`. The steps below are the manual equivalent, for learning.

Files used:

| Path | What it is |
|---|---|
| `exercice2\data\*.csv` | The 10 source tables. Read-only from now on. |
| `exercice2\powerquery\*.pq` | The M code for each query, to paste into the Advanced Editor |
| `exercice2\docs\01_data_quality_report.md` | What the profiling found |

## Step 1: Open Power BI Desktop and create the file

Power BI Desktop is already installed on this PC (you used it for exercice1). On another PC, install it from the Microsoft Store ("Power BI Desktop"); it's free.

1. Open Power BI Desktop and choose **Blank report**.
2. **File › Save as** → `C:\Users\DELL\Downloads\powerBiProject\exercice2\BOI360.pbix`.
   - A `.pbix` stores the data inside the file, so it opens anywhere.
   - In exercice1 you used `.pbip`, which stores no data. A `.pbix` is simpler for this exercise.
3. **File › Options and settings › Options › Current file › Regional settings**: set **Locale for import** to **English (United States)**.
   - Your Windows is set to French, where `,` is the decimal separator.
   - The CSVs use `.` (`1466.18`). In French, that value would be read wrongly or turn into an error.
   - The queries below also pass `"en-US"` explicitly, so they are safe either way.
4. In the same dialog, under **Current file › Data load**, untick **Auto date/time**.
   - Otherwise Power BI adds a hidden date table for every date column (10 of them here).
   - You'll build one proper Date table in Phase 2.

## Step 2: Create a parameter for the data folder

One parameter means that moving the project only needs one change.

1. **Home › Transform data** opens the Power Query Editor.
2. **Home › Manage parameters › New parameter**:
   - Name: `DataFolder`
   - Type: **Text**
   - Suggested values: Any value
   - Current value: `C:\Users\DELL\Downloads\powerBiProject\exercice2\data`
3. Click **OK**.

## Step 3: Learn the click path once with `departments`

Import one file by hand so you see what Power BI generates.

1. In Power BI Desktop, **Home › Get data › Text/CSV** → `exercice2\data\departments.csv` → **Open**.
2. In the preview dialog, set:
   - **File origin:** 65001: Unicode (UTF-8)
   - **Delimiter:** Comma
   - **Data type detection:** *Do not detect data types*. You'll set types yourself; automatic detection guesses from the first 200 rows and uses your French locale.
3. Click **Transform data** (not Load).
4. Look at the Applied Steps on the right: *Source* and *Promoted Headers*.
5. Turn on profiling:
   - **View** tab: tick **Column quality**, **Column distribution** and **Column profile**.
   - At the bottom-left of the status bar, click *"Column profiling based on top 1000 rows"* and switch it to **entire data set**.
6. Click a column. The panel shows *Valid / Error / Empty*, and the number of distinct and unique values.

Now replace the generated code with the project version:

1. **Home › Advanced Editor**.
2. Select all, then paste the contents of `exercice2\powerquery\01_departments.pq`.
3. Click **Done**.

The query name must stay `departments`.

## Step 4: Create the cleaning function

`fnCleanText` trims spaces, removes invisible characters and turns empty strings into null, in every column.

- Why null matters: an empty `project_id` in `expenses` must be a true blank, not the text `""`. Otherwise relationships and "No project" counts behave differently.

Steps:
1. **Home › New source › Blank query**.
2. Rename the query to `fnCleanText` (right-click the query › Rename).
3. **Advanced Editor** → paste `exercice2\powerquery\00_fnCleanText.pq` → **Done**.
4. Right-click `fnCleanText` and untick **Enable load**. It's a helper, not a table.

## Step 5: Create the other 9 queries

For each file below:
1. **Home › New source › Blank query**.
2. Rename the query.
3. **Advanced Editor** → paste the `.pq` file → **Done**.

| Query name | Paste from |
|---|---|
| employees | `exercice2\powerquery\02_employees.pq` |
| projects | `exercice2\powerquery\03_projects.pq` |
| targets | `exercice2\powerquery\04_targets.pq` |
| tasks | `exercice2\powerquery\05_tasks.pq` |
| customers | `exercice2\powerquery\06_customers.pq` |
| products | `exercice2\powerquery\07_products.pq` |
| sales_transactions | `exercice2\powerquery\08_sales_transactions.pq` |
| expenses | `exercice2\powerquery\09_expenses.pq` |
| leave_requests | `exercice2\powerquery\10_leave_requests.pq` |

Every query follows the same 4 steps:

| Step | What it does | Why |
|---|---|---|
| `Source` | `Csv.Document(File.Contents(DataFolder & "\x.csv"), [Encoding = 65001, …])` | Reads the file as UTF-8 with the exact column count |
| `PromotedHeaders` | First row becomes column names | |
| `CleanedText` | `fnCleanText` | Same cleanup on every table, in one place |
| `ChangedType` | `Table.TransformColumnTypes(…, "en-US")` | Sets the types, and reads `.` as the decimal separator whatever the PC's language |

Type choices:

| Type | Used for | Why |
|---|---|---|
| `type date` | every date | The data has dates without times |
| `Currency.Type` (*Fixed decimal number*) | all `_tnd` amounts | Stored as exact decimals (4 places), so sums of money don't drift like floating-point numbers do |
| `Int64.Type` | `quantity`, `working_days` | Whole numbers |
| `Percentage.Type` | `discount_pct` | The value is a fraction: 0.05 shows as 5 % |
| `type number` | `achievement_pct` | Reference only; it will be hidden and never summed |
| `type text` | IDs, names, statuses | IDs such as `E001` must stay text |

Extra columns. They are added, and no source value is changed:
- `employees.full_name`: first and last name, for slicers and labels.
- `employees.dq_shared_email`: TRUE for the 6 employees whose email is shared (data quality issue #1).

## Step 6: Check every query before loading

For each query, check that **Column quality** shows **0 % Error** in every column.

Then compare the row count (bottom-left of the editor) with this table:

| Query | Rows | Expected empty cells |
|---|---:|---|
| departments | 6 | none |
| employees | 48 | none |
| projects | 18 | none |
| targets | 96 | none |
| tasks | 90 | none |
| customers | 80 | none |
| products | 8 | none |
| sales_transactions | 600 | none |
| expenses | 150 | `project_id`: 42 (28 %) |
| leave_requests | 60 | `comment`: 18 (30 %) |

Spot checks:
- In `sales_transactions`, `revenue_tnd` on the first row (TX00001) shows **10263.27** and `discount_pct` shows **0.00 %**.
- In `employees`, filter `dq_shared_email` = TRUE. You should get **6 rows**.

## Step 7: Load and save

1. **Home › Close & Apply**.
2. In **Table view**, click each table and check the row count at the bottom-left.
3. Set the TND display format on the money columns:
   - Select a `_tnd` column.
   - **Column tools › Format**: type the custom format `#,0.00 "TND"`.
   - Do this for `revenue_tnd` and `amount_tnd` now. The rest will come through measures in Phase 3, where formatting matters most.
4. **File › Save**.

## Why Power Query and not editing the CSVs

- Every transformation is a recorded, repeatable step. If a new CSV arrives, **Refresh** reapplies them.
- The raw files stay the single source of truth, and anyone can audit the steps in the Applied Steps pane.
