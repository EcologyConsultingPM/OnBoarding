# Q30607 and Q30608 Project Tracker reconciliation

**Corrected:** 17 September 2026

Both supplied workbooks were reconciled using their authoritative `Tracker` worksheets, not their filenames or their organisation-wide Payroll Data worksheets.

| Workbook | Correct project | Client | Deliverable | Baseline | Imported tracker history |
|---|---|---|---|---:|---:|
| `Q30607.TaraglaRdTarlo1559.ProjectTracker.xlsx` | 1790 Taralga Road TARLO (1559) | Croker Design Studio (638) | FFA | 40.75 h | 34 entries / 50.10 h |
| `Q30608Inverary1563.ProjectTracker.xlsx` | 770 Inverary Rd BUNGONIA (1563) | Croker Design Studio | FFA | 38.25 h | 28 entries / 52.50 h |

The earlier crossed import was replaced. The Taralga project was restored from its soft-deleted state without changing its existing work activities or schedule. Its pre-existing auto-generated budget allocations were retained as closed history; the active Project Tracker now uses the distinct Q30607 source baseline to avoid duplicate active budgets.

The source history was normalised to the portal taxonomy without altering the actual recorded dates, staff, hours, or substantive work descriptions. One malformed Q30608 date (`3//9/2026`) was normalised to 3 September 2026, and an apparent 2025 date in the same 2026 tracker sequence was normalised to 11 September 2026.

Both projects have active, staff-visible trackers. Each of the five source-team members received a corrected Project Tracker access notification. The imported totals intentionally surface the historical overruns: Taralga is 9.35 hours over its 40.75-hour baseline, and Inverary is 14.25 hours over its 38.25-hour baseline.
