# Phase 5: Action Center: create / edit / delete, saved in the report

> Banner on the page: **"Changes are saved in this report (.pbix) — not in the CSV source or the data model."**

## What it does

Page 8 of the report, drawn by the BOI 360 Page visual (`src/actions.ts`):

| Feature | Detail |
|---|---|
| Entities | Tasks (90), Projects (18), Employees (48), as tabs |
| Table | Search, sort by any header, 16 rows per page, click to select, double-click to edit |
| Create / Edit / Delete | Forms with validation; delete asks for confirmation. A project that still has tasks, or an employee who still has tasks or manages a project, cannot be deleted |
| Validation | Required fields; 80-character text limit; email format and uniqueness; budget 1,000–5,000,000 TND; actual cost 0–5,000,000 TND; valid status, priority, source, project, manager and department; due ≥ created; deadline ≥ start; hire date ≤ data date |
| Saved changes panel | Every operation, with date and time. **Undo all** removes every change |
| Action queue | Overdue tasks, projects at risk, pending expenses, submitted leave. It recounts with your edits |
| Data minimisation | No salary field; salary is never sent to the visual |

## How saving works (changed on 17 Nov 2026, visual 1.0.0.10)

1. Each create, edit or delete is recorded as an operation, e.g. `Created TSK091 {title, project, assignee…}`.
2. The visual writes the list of operations into **its own saved property in the report** (`crud.changes`), with Power BI's `persistProperties`. This is the same mechanism that remembers the page filters.
3. Desktop marks the report as modified. **Save the file (Ctrl+S)** and the operations are stored inside the `.pbix` (or the `.pbip` files).
4. When the report opens, and after every **Refresh**, the visual loads the model data and then **re-applies the saved operations** on top. Your edits are back.

Tested on 17 Nov 2026 outside Power BI with the packaged visual:
- An empty form gives 3 validation errors.
- Creating "Prepare Q4 board pack" saves `Created TSK091`.
- A new visual started from only the saved state shows **Tasks (91)** and the change in its log, which is the equivalent of reopening the file.

## What it does NOT do

- **The CSV files and the Power BI data model are not changed.** A custom visual receives the model read-only, and Power BI has no API for a visual to write into the model.
- So **other pages and the DAX measures don't include the edits**: Task Operations still shows 90 tasks. Only the Action Center applies them.
- **In the Power BI Service**, a viewer's edits are not saved; only an author editing the report saves them.
- The saved operations belong to this one visual on page 8. If the visual is deleted, they go with it.

## Making a change part of the real data (all pages, all measures)

1. Open `exercice2\data\tasks.csv`, `projects.csv` or `employees.csv` in Excel.
2. Apply the change and **keep the IDs**:
   - Use the same new ID the Action Center gave, e.g. `TSK091`.
   - Foreign keys must exist.
   - Dates are `yyyy-mm-dd`.
3. Save as **CSV UTF-8**, then **Home › Refresh** in Power BI.
4. In the Action Center, **Undo all**, then save. The rows now come from the model, so you don't need the saved copy.

## Real write-back (outside this exercise's rules)

Writing the edits back to the source for every page would need a service outside the report:
- a Power Apps visual with Dataverse or SharePoint;
- a Power Automate flow;
- Fabric translytical task flows;
- or a small local service that rewrites the CSVs.

All of these break the exercise's "no backend / no external service" rule and may need extra licences. None is implemented.
