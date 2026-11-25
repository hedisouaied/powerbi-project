# MISSION CONTROL — web app (exercice4)

The exercice3 Power BI dashboard as a full web application:
- **Laravel 13** API with **MySQL**;
- a **React + TypeScript** frontend;
- user accounts, with sign-in required.

The dashboard looks and computes exactly like the Power BI version, because it runs the same TypeScript engine, modules and design system. In the web app, edits are **saved for real** in MySQL.

| Power BI (exercice3) | Web app (exercice4) |
|---|---|
| CSV → Power Query → semantic model | CSV → `php artisan mc:import` → MySQL (same 31 tables + `dim_date`) |
| 61 model relationships | The same 61: 54 foreign keys, plus 7 indexed role-playing date links (inactive in Power BI too) |
| 31 `Feed <table>` DAX measures | `GET /api/feeds`: same columns and format, **identical values** (checked table by table) |
| Edits: session-only or kept in the report | Edits written to MySQL and logged in `activity_log` with the user's name |
| Preferences in the visual's settings | Preferences on the user's account (`users.preferences`) |
| No sign-in | `users` table + Sanctum token auth (register, sign in, sign out) |

## Run it

Requirements:
- **WSL Ubuntu** with PHP 8.5, Composer and MySQL 8, all already installed here;
- portable **Node 22** on Windows (`C:\Users\DELL\tools\node-v22.23.5-win-x64`).

```powershell
powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1        # checks MySQL, starts Laravel, builds the frontend if needed
```

Then open **http://localhost:8000**. Create an account, or use the demo account `demo@missioncontrol.local` / `Demo12345`.

**Frontend hot reload** while coding: `start.ps1 -Dev`, then open http://localhost:5173/app/. Vite proxies `/api` to Laravel.

### First-time setup (already done on this PC)

```bash
# in WSL
mysql -u root -e "CREATE DATABASE mission_control; CREATE USER 'mission_control'@'localhost' IDENTIFIED BY '<password>'; GRANT ALL ON mission_control.* TO 'mission_control'@'localhost';"
cd exercice4/backend && composer install && cp .env.example .env && php artisan key:generate   # set DB_* in .env
php artisan migrate && php artisan mc:import
```
```powershell
# on Windows, in exercice4\frontend (Node 22; cmd AutoRun must be paused for npm on this PC)
npm install
node node_modules\vite\bin\vite.js build      # writes backend/public/app
```

## API

| Method | Path | |
|---|---|---|
| POST | `/api/auth/register` | name, email, password, password_confirmation → `{user, token}` |
| POST | `/api/auth/login` | email, password → `{user, token}`. Limited to 10 per minute. |
| GET | `/api/auth/me` · POST `/api/auth/logout` | Bearer token |
| GET | `/api/feeds` | The 31 tables as `{c: columns, r: rows}`. Cached until the next write. Salary is never included. |
| GET / PUT | `/api/me/preferences` | `{preferences, workspace}` for the signed-in user |
| POST | `/api/tables/{table}` | Create a row in an editable table. The primary key is required. |
| PATCH / DELETE | `/api/tables/{table}/{id}` | Update or delete a row |

**Editable tables:** tasks, calendar_events, approval_requests, decisions, collaboration_comments, notifications, investigation_cases, alerts, incidents, products, activity_log.

**Read-only tables** answer 404 to writes.

**Foreign keys are enforced.** A broken link returns 422, and the dashboard undoes the change on screen and says why.

## Tests

```bash
# WSL, exercice4/backend — 13 tests on a separate database (mission_control_test)
php artisan test
php artisan mc:import --check      # 61 relationships, and revenue / incidents / alerts = the Power BI values
```
```powershell
# Windows: end-to-end in a hidden Chrome (sign in, KPIs = Power BI, all 33 modules, task create → MySQL → reload, theme kept, sign out)
node exercice4\tools\e2e.js
```

| Test | Result |
|---|---|
| Backend tests | 13 / 13 |
| End-to-end | 16 / 16 |
| API feeds vs. Power BI feeds | 31 / 31 tables identical |

## Layout

| Path | Contents |
|---|---|
| `backend/` | Laravel. `app/Support/MissionData.php` (table metadata, feeds, typing), `app/Http/Controllers/Api/*`, `app/Console/Commands/ImportMissionControl.php`, migrations, `database/data/*.csv` |
| `backend/config/mission_control.php` | Tables, columns, types, keys and relationships. **Generated** by `tools/gen-schema.js` from exercice3. |
| `frontend/src/mc/` | The dashboard: exercice3's visual code, adapted for the web by `tools/webify.js` (API sync, signed-in user, wording) |
| `frontend/src/*.tsx` | React shell: sign-in / register page, dashboard host, API client |
| `tools/` | `start.ps1`, `e2e.js`, `gen-schema.js`, `webify.js` |

## Notes

- **The AI assistant is rule-based.** The API-key field shows only a fake placeholder. A real key would live in `backend/.env`, never in the browser.
- **The token is kept in `localStorage`.** That's fine for this local app. For a public deployment, switch to Sanctum's cookie (SPA) authentication.
- **`backend/.env` holds the MySQL password and the app key.** It is git-ignored.
