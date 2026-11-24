# CLAUDE.md — exercice3 (MISSION CONTROL — Enterprise Intelligence Terminal)

This is a Power BI project on the synthetic *Mission Control Enterprise* dataset:
- 31 CSV tables in `Mission_Control_Enterprise/`;
- amounts in **TND**;
- data up to **2026-11-22**.

The scope is `Mission_Control_Enterprise/MASTER_BUILD_PROMPT.md` and its 29-item `29_FUNCTIONALITY_ACCEPTANCE_CHECKLIST.md`. `README.md` holds the 29-row coverage checklist. Architecture and model are in `docs/`.

## Skills

Project skills live in `.claude/skills/`. Load the one that fits before starting that work.

| Skill | Use it for |
|---|---|
| `build-visual` | Changing, building or installing the Mission Control visual: modules, design, motion, persistence |
| `edit-model` | Power Query, DAX measures, feeds, relationships, TMDL generation, refresh, DAX queries |
| `test-visual` | Headless previews, UI acceptance scripts, engine vs DAX, checking feeds in Desktop |

## Rules

**One visual per page, always.**
- The report is ONE page (1600×900) holding ONE **Mission Control** TypeScript visual.
- Its sidebar switches between the 33 modules inside the visual. Custom visuals cannot change report pages.
- Never add native visuals or slicers. New features go in `visuals/missionControl/src/modules`.

**Do the work, don't assign it.**
- Build, test and report the results. Never end with "your task".
- When Desktop needs a click you cannot make without disturbing the user, say so plainly and give the shortest steps.

**Don't take the user's screen.**
- Use headless previews (`tools/preview.ps1`).
- Never restore, minimize or focus the user's Power BI window while they may be using it.
- To look at Desktop, capture it only if it is already visible (see `test-visual`).

**Source data is read-only.** Cleaning happens in Power Query only.

**No backend, no network, no real secrets.**
- The visual has no WebAccess privilege, and uses no `localStorage` and no `eval`.
- The assistant is rule-based.
- The external-LLM key field shows the fake placeholder `sk-demo-0000-PLACEHOLDER-NOT-A-REAL-KEY`.
- The user will provide real keys later. They must go to a backend proxy, never into the visual, the report or the repository. See `docs/INTEGRATIONS.md`.
- Never claim real AI, live data, write-back, e-mail or shared collaboration.

**Persistence is labelled everywhere:**
- Preferences: visual object `prefs.json`, always saved.
- Workspace edits: session-only by default ("Demo session — not saved"). They are saved in visual object `workspace.json` only when the user turns on "Keep my edits in this report".
- Edits never change the CSVs or the model.

**Neutral language for findings.**
- Say "requires review", not "fraud".
- Compute evidence text from data; never hard-code a conclusion. A bug like this happened once: the evidence said the payment matched net + tax when it actually matched the gross.

## Business rules (shared by DAX and the TypeScript engine)

| Rule | Definition |
|---|---|
| Revenue | Order status Completed + Processing. Amounts come from `sales_orders`; never sum order amounts after joining lines. |
| Money received | Payments Paid + Partial. Outstanding = Pending + Overdue. |
| Expenses | Every status except Rejected |
| Reference date | The last order date, 2026-11-22 (not `TODAY()`) |
| Open quality issue | Status `Open` or `Under Review`. Other statuses are `Fixed` and `Accepted`; there is no "Resolved". |
| Open incident | `Open` or `Investigating` |
| Open alert | `New`, `In Progress` or `Acknowledged` |
| Open risk | `mitigation_status` `Open` or `Mitigating` |
| Salary | Never sent to the visual |

Always check a status literal against the CSV values before using it.

**Reference values** (all data):

| Value | Amount |
|---|---|
| Net revenue | 61,746,871.96 |
| Gross revenue | 73,550,210.26 |
| GM | 43.69 % |
| Collection | 66.76 % |
| Open incidents | 120 (31 critical) |
| Open alerts | 210 |
| Overdue tasks | 278 |
| At-risk projects | 23 |
| Quality Score | 54.86 |
| Open quality issues | 42 |

**Planted anomalies:**
- O00004: gross 99,999 vs net + tax 28,566.49; the payment of 99,944.34 is close to the gross.
- O00008: promised 2024-12-01, before its order date 2025-04-18.

## Design

The look follows the user's reference image: black glass plus gold/amber, with the tokens in `src/core/theme.ts`.

**Layout:**
- sidebar, header with Ctrl+K search, sun/moon switch, bell, profile;
- status ribbon;
- KPI cards with sparklines, 3D campus hero, health gauge, assistant, sales, regions, risk radar, calendar, missions, tasks, quick actions, crisis card.

**Light theme:** warm paper with the same structure.

**Motion:**
- 160–420 ms, spring easing, transform and opacity only;
- count-ups once per navigation;
- `.mc-reduced` and `prefers-reduced-motion` turn everything off;
- no continuous decoration.

## Files

| Path | What |
|---|---|
| `powerquery/*.pq`, `dax/measures.dax` | Sources of truth. TMDL is generated from them. |
| `tools/build-pbip.ps1` | Model: TMDL, 62 measures, 31 `Feed <table>` measures, `feeds.json`, `schema.txt` |
| `tools/build-visual.ps1` | Builds the visual (pauses cmd AutoRun `wsl.exe ~`, uses Node 22) and installs it in `MissionControl.Report/CustomVisuals` |
| `tools/build-report.ps1` | The single page + visual; carries over `prefs`/`workspace` from `MissionControl.pbix` |
| `tools/model.ps1` | Refresh / DAX query against the open Desktop model |
| `tools/check-feeds.ps1` | All feeds in one query, as the visual asks for them: length + JSON validity |
| `tools/test-engine.ps1` | TypeScript engine vs DAX. Must stay 28/28 + 18/18 + 17/17. |
| `tools/csv-feeds.js` | Feeds built straight from the CSVs, identical to the model's. Used by the preview. |
| `tools/preview.ps1`, `tools/ui-test.js`, `tools/ui-test2.js` | Headless screenshots and 19 + 24 UI checks |
| `tools/gen-measure-doc.js` | Regenerates the measure table in `docs/02_model_and_measures.md` |
| `visuals/node_modules`, `visuals/missionControl/node_modules` | Junctions to exercice1's installed SDK |

## Workflow

1. Close Desktop without saving. Desktop overwrites the PBIP files when it saves.
2. Run the build scripts, then preview and run the UI tests headless.
3. Open `MissionControl.pbip` and click **Accueil › Actualiser** inside Desktop.
   - A PBIP has no data cache, so tables load during that refresh.
   - A refresh sent through `model.ps1` does NOT make Desktop re-query the visual.
   - If a feed is still missing, the visual shows a yellow banner listing the tables.
4. Run `tools/test-engine.ps1`.
5. **Fichier › Enregistrer sous › .pbix** as `MissionControl.pbix`.
