# Data Dictionary — Mission Control Enterprise Intelligence

All monetary values are in Tunisian dinars (TND). Dates use ISO format YYYY-MM-DD.
The dataset is synthetic and intended for portfolio/demo use, not real business decisions.

| File | Grain | Primary key | Main relationships / purpose |
|---|---|---|---|
| dim_date.csv | One row per calendar day | date_key | Date dimension; relate to fact date columns as role-playing date relationships |
| departments.csv | One row per department | department_id | Department dimension |
| employees.csv | One row per employee | employee_id | Employee dimension; department_id -> departments |
| customers.csv | One row per customer | customer_id | Customer dimension |
| products.csv | One row per product | product_id | Product dimension |
| suppliers.csv | One row per supplier | supplier_id | Supplier dimension |
| sales_orders.csv | One row per order | order_id | customer_id -> customers; sales_owner_id -> employees |
| sales_order_items.csv | One row per order line | order_line_id | order_id -> sales_orders; product_id -> products |
| payments.csv | One row per payment/order | payment_id | order_id -> sales_orders; customer_id -> customers |
| expenses.csv | One row per expense | expense_id | department_id -> departments; submitted_by_employee_id -> employees |
| inventory_snapshots.csv | One row per product/warehouse snapshot | inventory_snapshot_id | product_id -> products; supplier_id -> suppliers |
| projects.csv | One row per project | project_id | department_id -> departments; project_owner_id -> employees |
| tasks.csv | One row per task | task_id | project_id -> projects; department_id and assignee_employee_id |
| incidents.csv | One row per incident | incident_id | department_id -> departments; incident_owner_id -> employees |
| alerts.csv | One row per alert | alert_id | Operational alert register; affected_area is a business area label |
| decisions.csv | One row per decision | decision_id | Department and decision owner; expected vs actual impact |
| scenarios.csv | One row per scenario | scenario_id | Scenario assumptions for What-If and crisis simulation |
| kpi_targets.csv | One row per department/month | target_id | Department monthly targets |
| customer_interactions.csv | One row per customer interaction | interaction_id | customer_id -> customers; owner_employee_id -> employees |
| data_quality_issues.csv | One row per data-quality issue | issue_id | Data-quality issue register |
| activity_log.csv | One row per user activity event | activity_id | employee_id -> employees; demo audit history |
| calendar_events.csv | One row per scheduled event | event_id | owner_employee_id -> employees; department_id -> departments; optional related_project_id / related_task_id |

| missions.csv | One row per strategic mission | mission_id | Mission progress, priority, department and target dates |
| risk_register.csv | One row per registered risk | risk_id | Risk category, severity, confidence, exposure, owner and mitigation status |
| investigation_cases.csv | One row per investigation case | case_id | Case owner, department, severity and status |
| investigation_evidence.csv | One row per evidence item | evidence_id | case_id -> investigation_cases; source record references |
| entity_relationships.csv | One row per entity relationship edge | relationship_id | Graph edge list; keep separate from conventional star relationships |
| notifications.csv | One row per notification | notification_id | recipient_employee_id -> employees; inbox state and source module |
| collaboration_comments.csv | One row per contextual comment | comment_id | author_employee_id -> employees; linked item type/reference |
| approval_requests.csv | One row per approval request | approval_id | requester_employee_id and approver_employee_id -> employees |
| strategic_goals.csv | One row per strategic goal | goal_id | Department goals, current vs target value and status |
| data_sources.csv | One row per logical data source | source_id | Data source inventory and lineage metadata |

## Suggested relationships
- departments (1) -> employees, expenses, projects, tasks, incidents, kpi_targets
- employees (1) -> sales_orders, expenses, projects, tasks, incidents, customer_interactions, activity_log
- customers (1) -> sales_orders, payments, customer_interactions
- sales_orders (1) -> sales_order_items and payments
- products (1) -> sales_order_items and inventory_snapshots
- suppliers (1) -> inventory_snapshots
- projects (1) -> tasks

Use single-direction relationships wherever possible. Avoid ambiguous many-to-many paths. For multiple date roles, use one active date relationship per fact table and inactive relationships with USERELATIONSHIP where appropriate.

## Intentional demo anomalies
- sales_orders.csv includes a deliberately exaggerated gross amount on one record.
- sales_orders.csv includes a promised delivery date before the order date on one record.
- Other files include synthetic statuses, outliers, and varied values to support investigation exercises.
- data_quality_issues.csv is a sample issue register and should not be assumed to be a perfect ground-truth label set.

## Important modeling notes
- Order-level amounts live in sales_orders.csv; line-level amounts and quantities live in sales_order_items.csv. Do not sum order gross amounts after joining to multiple order lines without correcting for duplication.
- Payment amounts may be partial and do not always equal order gross amount.
- Completion percentages and scenario assumptions are decimal fractions (0.15 = 15%).
- The synthetic records are not guaranteed to form a statistically representative population.


## Calendar event notes
- `calendar_events.csv` contains 240 synthetic events with local demo timestamps.
- `recurrence_pattern` is descriptive metadata; a visual must implement recurrence expansion if it wants to display future occurrences.
- Event edits in the backend-free prototype are session-only and do not update the CSV.


## Additional module coverage
- `missions.csv` and `strategic_goals.csv` support Business Missions, Mission Control, progress tracking and goal status.
- `risk_register.csv` supports Risk Radar and Executive War Room.
- `investigation_cases.csv`, `investigation_evidence.csv`, and `entity_relationships.csv` support Business Detective, case workflows, evidence boards and network graphs.
- `notifications.csv` supports the notification inbox.
- `collaboration_comments.csv` supports contextual discussion and notes.
- `approval_requests.csv` supports approval queues and workflow demonstrations.
- `data_sources.csv` supports the data-source inventory and lineage panel.
- Layout preferences, themes, command palette history, market-style KPI tickers, comparison UI, story navigation, and sandbox experiments can be generated from the other facts and in-memory UI state; they do not require separate source tables.
