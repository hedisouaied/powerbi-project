---
name: run-webapp
description: Use when starting, stopping or opening the exercice4 Mission Control web app (Laravel API in WSL on :8000, React frontend), rebuilding the frontend, reaching MySQL in WSL, or when the app does not load.
---

# Run the Mission Control web app

## Start

```powershell
powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1          # → http://localhost:8000
powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1 -Dev     # + Vite hot reload → http://localhost:5173/app/
powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1 -Build   # force a frontend rebuild
```

The script:
1. checks that MySQL is active in WSL;
2. starts `php artisan serve --host=0.0.0.0 --port=8000` in WSL with `nohup` (log: `/tmp/mc-serve.log`) if `/api/health` doesn't answer;
3. builds the frontend into `backend/public/app` if it's missing.

WSL forwards `localhost:8000` to Windows.

**Demo account:** `demo@missioncontrol.local` / `Demo12345`. Users can also register.

## Stop

```bash
wsl -e bash -lc 'pkill -f "artisan serve"'
```
For the Vite dev server, stop the minimized `node` window.

## Environment facts (this PC)

- **No PHP, Composer or MySQL on Windows.** Run them through `wsl.exe -e bash -lc '…'`, with the path `/mnt/c/Users/DELL/Downloads/powerBiProject/exercice4/backend`. Pipe the output through `tr -d '\0'`.
- **sudo in WSL needs a password.** You can't start MySQL yourself. If it's stopped, ask the user to run `wsl -e sudo service mysql start`.
- **MySQL access:**
  - `mysql -u root` works without a password inside WSL; use it for admin tasks only.
  - The app user is `mission_control`, with its password in `backend/.env`. Never print it.
  - Databases: `mission_control` (app) and `mission_control_test` (tests).
- **Frontend tooling uses Windows Node 22** (`C:\Users\DELL\tools\node-v22.23.5-win-x64`):
  - run Vite and tsc as `node node_modules/vite/bin/vite.js …` and `node node_modules/typescript/bin/tsc`;
  - `npm install` needs cmd AutoRun (`wsl.exe ~`) paused, otherwise it hangs. Copy the pattern from `exercice3/tools/build-visual.ps1`.
- **Laravel serves the built app at `/app/`.** `/` redirects there (`routes/web.php`). The build uses `base: /app/`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page or 503 on `/app/` | Frontend not built: run `start.ps1 -Build` |
| "Could not load the data" | API down: run `start.ps1`, then look at `/tmp/mc-serve.log` |
| Yellow banner listing tables | `/api/feeds` is missing tables: run `php artisan mc:import --check` |
| 401 → back to the sign-in page | Token revoked or expired; sign in again |
