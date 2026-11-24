# Mission Control — Power BI Dataset Pack

This pack contains a synthetic enterprise dataset and a master implementation prompt for a TypeScript-powered Power BI custom-visual project.

## Quick start
1. Extract the ZIP.
2. Open Power BI Desktop.
3. Use Get Data → Text/CSV to import the CSV files.
4. Use `DATA_DICTIONARY.md` for table grains and relationships.
5. Open `MASTER_BUILD_PROMPT.md` and provide it, the reference screenshot, and this dataset folder to Claude Code/OpenCode.
6. Build the model and validate measures before implementing advanced modules.

## Dataset profile
- Currency: TND
- Date coverage: 2025-01-01 to 2026-12-31 for the date dimension; fact records mostly through 2026-11-23.
- Synthetic records: 80 employees, 300 customers, 50 products, 25 suppliers, 1,800 orders, 400 tasks, 220 incidents, 300 alerts, 100 decisions, and supporting facts.
- Intentionally includes a few anomalies for Data Doctor / Investigator demonstrations.

## Important
The initial build is backend-free. UI edits, task creation, notes, acknowledgements and scenario saves are session/in-memory demonstrations unless implemented using supported Power BI persistence. They do not modify the CSV files or source model. Real multi-user collaboration, secure AI, durable CRUD and notifications require external services.


## Definitive scope: all 29 functionalities
The master prompt includes a mandatory numbered 29-functionality coverage matrix. Every item must be implemented and tested:
1 Global Command Palette; 2 Notification Center; 3 Customizable Dashboard Builder; 4 Personalization Engine; 5 Advanced Data Explorer; 6 AI Business Assistant; 7 What-If Simulator; 8 Business Time Machine; 9 Root Cause Analyzer; 10 Smart Anomaly Detection; 11 Business Digital Twin; 12 Decision Impact Analyzer; 13 Task Management System; 14 Project Management; 15 Approval Workflow; 16 Calendar & Event Manager; 17 Activity Audit Log; 18 Team Collaboration; 19 3D Interactive Environment; 20 Interactive Network Graph; 21 Geographical Intelligence; 22 Financial Market-Style Interface; 23 Interactive Data Storytelling; 24 Comparison Studio; 25 Business Crisis Simulator; 26 Mission Control / Business Missions; 27 Business Detective Mode; 28 Executive War Room; 29 Business Sandbox.

The prompt requires an interactive implementation, data inputs, user actions, persistence classification, Power BI constraints and at least one acceptance test for each item. It also requires a 29-row checklist in the project README.

## Important implementation truth
A Power BI custom visual runs inside a constrained host. The no-backend version can deliver extensive interactive UI, local/session simulations, selection/filter interactions and supported persisted properties. It cannot honestly promise unrestricted web-app capabilities, durable multi-user CRUD, true push reminders, real AI inference, or background processing without appropriate external services. The prompt requires these limitations to be documented rather than faked.
