# Power BI dashboard demo: onepage.pbix

Test and video package for the retail sales report (`onepage.pbix`), recorded live in Power BI Desktop on 16 Nov 2026.

| Deliverable | File |
|---|---|
| Edited demo video (122 s, 1920×1080, H.264) | [video/powerbi-demo-final.mp4](video/powerbi-demo-final.mp4) |
| Full raw recording (475 s, 1920×1080, H.264) | [video/powerbi-demo-raw.mp4](video/powerbi-demo-raw.mp4) |
| Test report (30 tests, screenshots, issues) | [reports/test-report.html](reports/test-report.html) |
| Screenshots (overview + every test) | [screenshots/](screenshots/) — start with `dashboard-overview.png` |
| LinkedIn post | [linkedin/linkedin-post.md](linkedin/linkedin-post.md) |

## Results

- **30 tests, 29 passed** (3 with minor visual issues), **1 failed**: Download PDF is blocked by Power BI's custom-visual download rule (Desktop not signed in / tenant switch off). Workaround: File › Export › Export to PDF.
- On-screen totals were cross-checked against `output/*.csv`: net 3,498.60, gross 4,105.60, 55 units, 32 orders, 33 lines, store totals, cancelled lines and refunded payments all match.
- Not tested: Send by email (would send a real email), Excel download (interrupted; same API as PDF), typed dates, mobile layout, Power BI Service.
- Not present in the report: bookmarks, drill-down/drill-through, native slicers, buttons, cross-visual filtering. Each page is one custom visual, so every interaction happens inside it.

## How it was made

- Tests ran on a **copy** (`work/onepage.pbix`); the original `onepage.pbix` was not modified.
- Mouse and keyboard were driven through the Windows API from PowerShell; each result was checked from a screenshot.
- The desktop was recorded with FFmpeg (gdigrab, 30 fps). The raw video stops at 17:32:50 in the first session, because later frames showed unrelated activity on the screen.
- The edited video contains only cuts of the real recording, plus a title card, a closing card and captions. There are no speed changes or simulated interactions.
- Scripts and logs are in `tmp/`: `ui.ps1` (automation), `actions.log` (timestamped actions), `results.jsonl` (test results), `build-video.ps1`, `build-report.ps1`.
