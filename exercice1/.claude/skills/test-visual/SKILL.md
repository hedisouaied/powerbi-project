---
name: test-visual
description: Use when testing or previewing a custom visual outside Power BI, checking a page's layout, tooltips, filters, tables, dialogs, downloads or the email, or taking screenshots of a page after a change.
---

# Test a visual outside Power BI

The test page runs the compiled visual from its newest `dist/` package, with data from `output/*.csv` and a fake Power BI host. It doesn't need Desktop or the mail service.

1. Package the visual if the code changed: `build.ps1 -Visual <name> -NoInstall` from the `build-visual` skill.
2. Build the page, from the project root:
   ```powershell
   .\.claude\skills\test-visual\scripts\make-test-page.ps1 -Which sales
   ```
   `-Which` is `sales`, `report` or `table`.
3. Start the server in the background (`run_in_background`), once per session:
   ```powershell
   node .\.claude\skills\test-visual\scripts\serve.js
   ```
4. Open `http://localhost:4317/` in the built-in browser. For `report`, add `?kind=products`, `orders`, `price`, `trends` or `quality`. After rebuilding the page, navigate again: the server re-reads the file on each request.
5. Stop the server when finished.

To save tokens, check with `javascript_tool` and `read_page` first, and take a screenshot only for layout or looks.

## What to check

- Totals: Net **3,498.60**, Gross **4,105.60**, Units **55**, Orders **32** with no filter.
- `window.renderError` is empty, and so are `.sp-error` and the table's diagnostics line.
- Filters: `window.persistLog` gets one entry per change, and the canvases are not rebuilt by the update that follows (`dataKey()` should skip it).
- An empty selection doesn't break the page.
- Every chart fits inside its card.

## What the fake host records

| Variable | Contents |
|---|---|
| `window.persistLog` | Saved filter changes |
| `window.selected` | Selection ids from table row clicks |
| `window.exportLog` | PDF and Excel downloads (name, type, size). The files are not saved. |
| `window.lastEmail` | The email the visual would send (`subject`, `html`, `text`, `images`) |

## Rules

- **Email:** the page stubs `fetch`, so nothing can reach the real mail service and no real email is sent. To view the email, write `lastEmail.html` into the page, replacing `cid:` with `data:image/png;base64,` plus `images[0].base64`.
- **What this can't show:** real Power BI layout, cross-filtering between visuals, the privileges and iframe limits. Say so when reporting results, and ask the user to confirm inside Desktop.
