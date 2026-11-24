---
name: build-visual
description: Use when changing, building or installing the exercice3 Mission Control TypeScript custom visual (any of the 33 modules, the shell/sidebar/command palette, the dark-gold design, motion, prefs/workspace persistence, the 3D campus, charts) or regenerating its report page.
---

# Build and install the Mission Control visual

## Rules

**One page, one visual.** Every new feature is a module inside `visuals/missionControl/src/modules`. To add one:
1. Write the function in a module file.
2. Add it to `registry.ts`.
3. Add it to `NAV` in `app.ts`, with its checklist number in `feature`.

**Everything the user sees must be honest:**
- Label session-only vs saved state (`sessionTag`).
- Mark modeled or demo outputs as such.
- Compute evidence and explanations from the data.

**No network, no storage, no `eval`.** Do not add the WebAccess privilege. API keys only ever appear as the fake placeholder (`docs/INTEGRATIONS.md`).

## Code map

| File | Role |
|---|---|
| `src/visual.ts` | Power BI entry point. Feeds → `Dataset`. Feed issues → banner. `prefs`/`workspace` objects → `Store`. `persistProperties` merge. `downloadService` → `app.exporter`. ≥1280×720 logical canvas, scaled down. |
| `src/app.ts` | Shell: header, ribbon, sidebar, crumbs, palette (Ctrl+K), overlays. `Ctx` is passed to every module. |
| `src/core/engine.ts` | All business logic. Pure, so it runs in Node tests. If you change a calculation, run `test-engine.ps1`. |
| `src/core/data.ts` | Decodes feeds; workspace patches `{added, changed, removed}`; `Index` lookups. `ref` = last order date. |
| `src/core/state.ts` | `Prefs` (always persisted), `Store` (edits plus audit; persisted only if `persistEdits`), `Session` |
| `src/core/ui.ts` | Component kit: `h`, `icon`, `btn`, `card`, `kpiTile`, `dataTable`, `drawer`, `modal`, `formGrid`, `tabs`, gauge/ring/sparkline. Only lucide icons listed in `ICONS` exist; unknown names fall back to Info. |
| `src/core/charts.ts` | ECharts wrappers. Charts are queued and created after the DOM is attached (`ch.flush()`). |
| `style/visual.less` | All `mc-*` classes. Colours come only from `--mc-*` tokens (`theme.ts`). |

## Traps already hit

**Styling:**
- A `<button>` with only a layout class rendered as a white browser button. The zero-specificity reset `:where(.mc-app) button` now handles that; keep it.
- `.mc-tone-*` sets `color`. On a badge or chip that also sets a background, define `.mc-badge.mc-tone-*` explicitly, or the text becomes invisible.
- Do not reuse a class name across components. `mc-side` was both the sidebar and a 3D wall face.
- Card bodies are column flexboxes. Inline controls placed directly in them stretch unless they have `align-self: flex-start`.
- Set CSS custom properties with `el.style.setProperty('--x', v)`. `Object.assign(el.style, {'--x': v})` does nothing.

**Code:**
- Long one-line expressions with nested `h(...)` calls are easy to mis-bracket. Run `tsc --noEmit` before `pbiviz`.
- Lists capped for performance must still show the user's own new rows. The Kanban sorts workspace-added and changed tasks first.

## Build

Desktop must be closed, or closed afterwards **without saving**. If Desktop saves, it writes its own loaded copy of the visual back to `CustomVisuals`.

```powershell
# fast type check (portable Node 22):
C:\Users\DELL\tools\node-v22.23.5-win-x64\node.exe visuals\missionControl\node_modules\typescript\bin\tsc --noEmit --skipLibCheck -p visuals\missionControl\tsconfig.json
powershell -ExecutionPolicy Bypass -File exercice3\tools\build-visual.ps1 [-NoInstall]   # bumps version, lint + package, installs
powershell -ExecutionPolicy Bypass -File exercice3\tools\build-report.ps1                # only if the page / bindings change
```

**This PC's build traps.** `build-visual.ps1` handles both:
- cmd AutoRun `wsl.exe ~` hangs npm and pbiviz, so AutoRun is paused and then restored;
- Node 22 is required.

**SDK.** `visuals\node_modules` and `visuals\missionControl\node_modules` are junctions to exercice1's installed packages.

**Lint.** Only real errors matter. The config does not load `@typescript-eslint` rules, so don't add `eslint-disable` comments for them.

## Check before handing over

Follow the `test-visual` skill:
1. Smoke-test all routes.
2. Run `ui-test.js` (19) and `ui-test2.js` (24).
3. Take screenshots in dark and light.
4. If the engine changed, run `test-engine.ps1`.
