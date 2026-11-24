---
name: test-visual
description: Use when previewing or testing the exercice3 Mission Control visual — headless screenshots of modules in dark/light, UI acceptance scripts (task CRUD, persistence/reopen, palette, theme, export, what-if, dashboard builder, approvals, decisions, calendar, 3D, geo, network…), the engine vs DAX check, or checking what the visual received inside Power BI Desktop.
---

# Test the Mission Control visual

None of these steps take the user's screen.

## 1. Headless preview (no Desktop needed)

```powershell
& exercice3\tools\preview.ps1 -Routes command,tasks,calendar -Theme dark     # PNGs in %TEMP%\mc-preview\<route>-<theme>.png
& exercice3\tools\preview.ps1 -Routes command -Theme light -Out exercice3\docs\screenshots
```

**What the preview does:**
- loads the packaged `.pbiviz` from `visuals/missionControl/dist`;
- builds feeds from the CSVs with `csv-feeds.js` (identical to the model feeds);
- fakes the host: `persistProperties` (logged in `persistLog`, applied to `objects`), `downloadService` (`exportLog`), `eventService`;
- blocks the network.

**Parameters:**

| Parameter | Effect |
|---|---|
| `-Prefs '{"persistEdits":true}'` | Merged into the saved prefs (`motion: reduced` is the default, for stable screenshots) |
| `-Width/-Height` | Viewport, default 1600×900 |

Read the PNGs and look at them. Check:
- nothing overlaps;
- no white browser-default buttons;
- text is readable in both themes;
- numbers are plausible.

## 2. Scripted UI tests

```powershell
& exercice3\tools\preview.ps1 -Routes tasks -DumpDom -Prefs '{"persistEdits":true}' -Script (Get-Content exercice3\tools\ui-test.js -Raw)   # PASS 19/19
& exercice3\tools\preview.ps1 -Routes command -DumpDom -Script (Get-Content exercice3\tools\ui-test2.js -Raw)                              # PASS 24/24
```

**How the scripts work:**
- They run inside the page.
- Helpers available: `element`, `host`, `objects`, `persistLog`, `exportLog`, `update()`, `rows`, `roles`, `app()`.
- The result goes to `document.title`.
- `ui-test.js` also creates a second visual instance from the saved objects to prove that edits survive reopen.

**Smoke test for every route:** click each `.mc-nav` and look for `.mc-error-box`.

**Keep the test files ASCII.** `Get-Content -Raw` reads them as ANSI, so a `·` or `—` in a string no longer matches. Use a regex `.` or `·` written as an escape.

## 3. Engine vs DAX (Desktop open, refreshed)

```powershell
powershell -ExecutionPolicy Bypass -File exercice3\tools\test-engine.ps1
```

It must print **28/28**, **18/18** and **17/17**.

## 4. Inside Power BI Desktop

The visual shows a **yellow banner** listing every feed that arrived empty or unreadable.
- Usual cause: the visual queried while the model was still loading. The fix is **Actualiser** inside Desktop.
- To check the engine side, run `tools/check-feeds.ps1`. It runs all feeds in one query and checks length and JSON validity.

**Looking at Desktop without disturbing the user.**
- Capture the window only if it is already visible: `IsIconic` false, then `PrintWindow`.
- Never call `ShowWindow`, `SetForegroundWindow` or minimize. The user may be working in it.
- If Desktop is minimized, ask the user, or rely on the headless preview.
