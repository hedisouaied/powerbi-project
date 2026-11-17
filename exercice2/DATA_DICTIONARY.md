# Business Operations Intelligence 360 — Data Dictionary

All records are synthetic and intended for learning. Currency: TND. Dataset period: 2026.

## Files
- departments.csv: department dimension.
- employees.csv: employee dimension and contact details. employee_id is the primary key; department_id references departments.
- projects.csv: project master data. project_manager_id references employees; department_id references departments.
- targets.csv: monthly seller targets and actual sales. employee_id references employees (sales department).
- tasks.csv: work items. project_id references projects; assignee_id references employees.
- customers.csv: customer dimension.
- products.csv: product dimension.
- sales_transactions.csv: sales fact table. customer_id/product_id/seller_id reference customers/products/employees.
- expenses.csv: expense fact table. department_id references departments; project_id may be blank.
- leave_requests.csv: leave request records. employee_id references employees.

## Relationships (recommended model)
- departments[department_id] 1:* employees[department_id]
- departments[department_id] 1:* projects[department_id]
- employees[employee_id] 1:* projects[project_manager_id]
- employees[employee_id] 1:* targets[employee_id]
- employees[employee_id] 1:* tasks[assignee_id]
- projects[project_id] 1:* tasks[project_id]
- customers[customer_id] 1:* sales_transactions[customer_id]
- products[product_id] 1:* sales_transactions[product_id]
- employees[employee_id] 1:* sales_transactions[seller_id]
- departments[department_id] 1:* expenses[department_id]
- projects[project_id] 1:* expenses[project_id] (blank project IDs are allowed)
- employees[employee_id] 1:* leave_requests[employee_id]

Use single-direction filtering from dimensions to facts where possible. Be careful: employees participates in multiple roles (seller, manager, assignee). If the model creates ambiguous filter paths, use role-playing employee dimensions or inactive relationships with USERELATIONSHIP.

## Suggested measures
- Total Revenue = SUM(sales_transactions[revenue_tnd])
- Total Profit = SUM(sales_transactions[profit_tnd])
- Profit Margin % = DIVIDE([Total Profit], [Total Revenue])
- Transactions = DISTINCTCOUNT(sales_transactions[transaction_id])
- Average Order Value = DIVIDE([Total Revenue], [Transactions])
- Total Expenses = SUM(expenses[amount_tnd]) (optionally filter Approved)
- Project Budget = SUM(projects[budget_tnd])
- Project Actual Cost = SUM(projects[actual_cost_tnd])
- Budget Utilization % = DIVIDE([Project Actual Cost], [Project Budget])
- Target Amount = SUM(targets[target_amount_tnd])
- Actual Target Sales = SUM(targets[actual_sales_tnd])
- Target Achievement % = DIVIDE([Actual Target Sales], [Target Amount])
- Open Tasks = CALCULATE(COUNTROWS(tasks), tasks[task_status] <> "Done")
- Overdue Tasks = CALCULATE(COUNTROWS(tasks), tasks[task_status] <> "Done", tasks[due_date] < TODAY())
- Employees = DISTINCTCOUNT(employees[employee_id])

## Data caveats
- Synthetic data is generated for practice, not financial reporting.
- Sales transactions include multiple payment statuses; decide whether cancelled or unpaid transactions belong in each KPI and document the definition.
- Targets are monthly records; avoid summing achievement_pct. Recalculate achievement from summed actual and target amounts.
- Actual sales in targets.csv is a separately generated planning/achievement dataset and will not exactly reconcile to transaction sales.
- Project costs can exceed budget by design to enable variance analysis.
- Dates are ISO YYYY-MM-DD. Parse as Date in Power Query.
- employee salary and leave details are sensitive in real organizations; use role-based access and data minimization in production.
