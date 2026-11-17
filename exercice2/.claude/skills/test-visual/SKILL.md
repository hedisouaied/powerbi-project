---
name: test-visual
description: Use when previewing or testing the exercice2 BOI 360 Page visual outside Power BI: screenshots of every view, checking layout or design, sidebar navigation, filters, Action Center create/edit/delete and saving, or comparing the visual's numbers with DAX.
---

# Test the BOI 360 visual outside Power BI

`tools/preview.ps1` runs the **packaged** visual (newest `visuals/boi360Page/dist/*.pbiviz`) in headless Chrome:
- It uses a fake Power BI host and data built from `data/*.csv` in the same shape as the `JSON …` measures.
- **It never touches the screen or Power BI Desktop**, so the user can keep working.

## Screenshots

```powershell
& exercice2\tools\preview.ps1                                  # all 8 views -> %TEMP%\boi360-preview\<view>.png
& exercice2\tools\preview.ps1 -Kinds overview,sales            # some views
& exercice2\tools\preview.ps1 -Kinds sales -Filters '{"payment":"Cancelled"}'
```

- Call it with `&` from PowerShell. With `powershell -File`, `-Kinds a,b` arrives as one string.
- Screenshots show the **settled state**: animations are disabled and the visual renders twice, because headless Chrome freezes delayed CSS animations.
- Copy the good ones to `docs/img/` when the design changes.

## Scripted interaction tests

`-Script '<js>' -DumpDom` runs JavaScript after the render and prints `document.title`, so put the results there.

The fake host records:
- `window.persistLog`: every `persistProperties` call (filters, view, `crud.changes`);
- `window.exportLog`: CSV export attempts. `exportStatus()` returns 3 (blocked), the same as Desktop when not signed in.

Already-proven scenarios to reuse:
- **Sidebar:** click `.bx-nav-item` "Sales Performance". `.bx-title` changes, and the filter set on Sales survives a round trip to another view.
- **Action Center saving:**
  1. Click **New**, then **Create** on an empty form: expect 3 `.ac-error`.
  2. Fill the form and create: one `crud` operation appears in `persistLog`.
  3. Start a second instance with `objects.crud.changes` set to that value: the Tasks tab shows **(91)**.

## Numbers vs DAX

With Desktop open on the refreshed model:

```powershell
powershell -ExecutionPolicy Bypass -File exercice2\tools\test-metrics.ps1    # must print 36/36 for each of the 3 scenarios
```

## What this cannot show

- The real Power BI frame, iframe sandbox limits, real downloads.
- Desktop's own save prompt.
- Visual-level behaviour in the Power BI Service.

Say so when reporting. Confirm in Desktop when the user gives you the screen.
