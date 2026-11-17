---
name: build-visual
description: Use when changing, building or installing the BOI 360 Page TypeScript custom visual of exercice2 (views, sidebar, KPIs, charts, tables, drill-through, what-if, Action Center CRUD, the dark-gold command-center design) or regenerating the report page.
---

# Build and install the BOI 360 Page visual

Read [visual-reference.md](visual-reference.md) before changing the visual: it explains the architecture and the mistakes already made once.

## Rule

**One page, one visual.** The report is a single page holding one BOI 360 Page visual. Its sidebar switches between the 8 views inside the visual. Never add native slicers, charts, tables or buttons; build new features inside `visuals/boi360Page/src`.

## Build

Desktop must be closed, or closed afterwards **without saving**: it overwrites the PBIP files when it saves.

```powershell
powershell -ExecutionPolicy Bypass -File exercice2\tools\build-visual.ps1     # bumps version, packages, installs into BOI360.Report\CustomVisuals
powershell -ExecutionPolicy Bypass -File exercice2\tools\build-report.ps1     # only if the page/visual.json must change
```

`build-visual.ps1` already handles the two build traps of this PC:
- It removes the cmd **AutoRun** (`wsl.exe ~`) during the build and restores it afterwards. Without that, npm and pbiviz hang.
- It runs **portable Node 22** (`C:\Users\DELL\tools\node-v22.23.5-win-x64`). winget's Node 26 is too new for pbiviz 7.2.1.

The SDK is not installed in exercice2: `visuals\node_modules` and `visuals\boi360Page\node_modules` are **junctions** to exercice1's installed packages.

## Check before handing over

1. `tools\preview.ps1` renders every view in headless Chrome from the packaged visual. It doesn't touch the screen or Desktop; see the `test-visual` skill.
2. If calculations changed: `tools\test-metrics.ps1` with Desktop open on the refreshed model must stay **108/108**.
3. All JSON under `BOI360.Report` must parse (`build-report.ps1` checks it).

## Finish

The user (or you, if they give you the screen):
1. Opens `exercice2\BOI360.pbip` and clicks **Actualiser**.
2. **Fichier › Enregistrer sous › .pbix**, replacing `BOI360.pbix`.

Saved Action Center changes in the `.pbix` are carried over by `build-report.ps1`.
