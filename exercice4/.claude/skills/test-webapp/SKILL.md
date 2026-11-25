---
name: test-webapp
description: Use when testing or verifying the exercice4 Mission Control web app — the end-to-end headless Chrome test (sign-in, KPIs vs Power BI, all modules, task create → MySQL → reload, theme persistence, sign-out), Laravel feature tests, comparing /api/feeds with the Power BI feeds, or taking screenshots of the web app.
---

# Test the Mission Control web app

The app must be running first (`run-webapp` skill).

## 1. End-to-end in a hidden Chrome (doesn't touch the user's screen)

```powershell
node exercice4\tools\e2e.js [outDir] [email] [password]     # default: demo account; screenshots in %TEMP%\mc-web-e2e
```

Expect **PASS 16/16**. It checks:
- the login page, and that a wrong password is refused;
- that the dashboard loads;
- that the 12-month revenue is **30.90M TND** and the ribbon shows **120 · 31 critical**, the same as Power BI;
- that all 33 modules render;
- a task created through the UI: visible on the board, returned by the API from MySQL, still found after a reload;
- that the light theme is kept after a reload, and that there are no JavaScript errors;
- that it deletes its own test task, then signs out and removes the token.

Read the screenshots (`01-login`, `02-dashboard-dark`, `03-task-created`, `04-dashboard-light`). Compare them with the Power BI screenshots in `exercice3/docs/screenshots`; they should look the same.

## 2. Backend feature tests (separate `mission_control_test` database)

```bash
wsl -e bash -lc 'cd /mnt/c/Users/DELL/Downloads/powerBiProject/exercice4/backend && php artisan test --compact'   # 13 tests
```

They cover:
- auth: register, validation, login, token, logout;
- per-user preferences;
- the import reference values;
- the feed format, and that salary is excluded;
- task create, update and delete with audit;
- that writes bump the feed version;
- foreign-key enforcement, read-only tables, duplicate ids.

## 3. API feeds = Power BI feeds

Get a token with `POST /api/auth/login`, save `GET /api/feeds` to a file, then compare it with `exercice3/tools/csv-feeds.js`. Rows are compared sorted. The expected result is 0 tables differing out of 31. That comparison has already passed once, with the snippet used during the build. If you change typing in `MissionData::value()`, run it again.

## Cleanup

Tests must not leave rows in the user's database. If a manual check created any, remove them:
- tasks titled `Web task %`;
- `activity_log` rows whose `activity_id` starts with `WEB`.

The e2e test already deletes its own task.
