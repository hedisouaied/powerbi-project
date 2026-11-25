---
name: edit-backend
description: Use when changing the exercice4 Laravel backend — API routes/controllers, Sanctum auth, the users table, MissionData (feeds, typing, validation), the generated tables/relationships config, migrations, the CSV importer (php artisan mc:import), or backend feature tests.
---

# Edit the Mission Control Laravel backend

First read `backend/CLAUDE.md` (Laravel Boost guidelines) and follow it:
- use `php artisan make:*` with `--no-interaction`;
- curly braces always, typed signatures, PHPDoc array shapes;
- format with `vendor/bin/pint --dirty`;
- every change gets feature tests.

## Map

| File | Role |
|---|---|
| `config/mission_control.php` | **Generated** (`node tools/gen-schema.js`) from exercice3. Holds the 32 tables (columns, types S/D/T/I/N/C/P/B/G, primary key, `feedColumns`, `editable`) and the 61 relationships (`activeInPowerBI`). |
| `database/migrations/…create_mission_control_tables.php` | Builds the tables and foreign keys from the config. `isSoft()`: inactive date links to `dim_date` are indexes, not FKs. Text widths come from `MissionData::stringLength()`: ids compact, free text 191, long text `TEXT`. |
| `…add_workspace_to_users_table.php` | Adds `users.role`, `preferences` (JSON) and `workspace` (JSON) |
| `app/Support/MissionData.php` | Metadata helpers; `feeds()` (cached per version, bumped on every write); `value()` (DB → feed JSON value); `toDb()` (input → DB); `rules()` (validation per column type) |
| `app/Console/Commands/ImportMissionControl.php` | `mc:import` loads `database/data/*.csv` and runs the checks. `--check` checks only. It uses DELETE, not TRUNCATE, so it works inside test transactions. |
| `app/Http/Controllers/Api/*` | `AuthController`, `FeedController`, `RecordController` (writes plus an `activity_log` entry), `PreferenceController` |
| `routes/api.php`, `routes/web.php` | API routes; `/` → `/app/`, and `/app/{path}` serves the React build |

## Rules

**Keep the feeds identical to Power BI.** Same columns (`feedColumns`), same value typing:
- numbers rounded to 4 decimals;
- dates `Y-m-d`, date-times `Y-m-d H:i`;
- booleans as true/false.

After any change to feeds or the importer, re-run the comparison in the `test-webapp` skill.

**Never expose `employees.monthly_salary_tnd`.** It isn't in `feedColumns`; keep it that way.

**Adding a table or column:**
1. Change the CSV and exercice3's schema.
2. Run `node exercice4/tools/gen-schema.js`.
3. Write a new migration. Never edit a migration that has already run on the user's database.
4. Re-import.

**Making a table editable.** Add it to `EDITABLE` in `gen-schema.js` and regenerate.

**Foreign keys stay enforced.** `RecordController` returns 422 on a constraint error, and the frontend reverts the change.

## Run

```bash
wsl -e bash -lc 'cd /mnt/c/Users/DELL/Downloads/powerBiProject/exercice4/backend && php artisan test --compact'
wsl -e bash -lc 'cd /mnt/c/Users/DELL/Downloads/powerBiProject/exercice4/backend && php artisan migrate:fresh --force && php artisan mc:import'   # resets the app DB (deletes users!)
```

**`migrate:fresh` wipes users.** Re-create the demo account afterwards with `POST /api/auth/register`, or tell the user.
