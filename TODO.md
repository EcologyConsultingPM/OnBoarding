# Project outcomes

## Admin weekly timesheet upload and import
- [x] Implement an administrator bulk-upload workflow for weekly raw timesheet data containing date, staff name, client, project name and number, hours, kilometres, activity category, and comments.
- [x] Allow the administrator to map/sort the uploaded data, detect unmatched projects/staff and duplicates, preview the proposed changes, resolve ambiguous rows, and update only the corresponding active project trackers after explicit review.
- [x] Preserve imported comments, kilometre values, source-row/batch provenance, and the administrator who imported the entries; recalculate affected allocation actuals and notify affected staff after a successful import.

## Project Tracker balance synchronization
- [x] When an administrator deletes a timesheet entry in the Project Tracker, recalculate the affected project's consumed and available hours and money from the remaining tracker entries.
- [x] When an administrator updates an ordinary project budget in Project Operations, synchronize the approved original tracker budget so the corresponding Project Tracker available hours and money update; keep approved variations, actuals, and monthly source-specific rules separate.
- [x] Preserve the existing monthly baseline transaction and project-register fallback for projects without budget-source rows, and refresh an open Project Tracker view after a Project Operations budget change.

## Admin operations assurance
- [x] Keep the existing admin view of daily database-backup synchronization/coverage status, recent health/system logs, and issue error codes available and unchanged.

## Supplied XLS format and charging refinement
- [x] Automatically map Date, Employee, Client, Job#, Client job, Hours, Expenses, Kms, Vehicle, Task and Notes; preserve source Task/Notes and the reference expenses/vehicle values.
- [x] For new entries with confirmed job cards, charge Gerard Dwyer, Emily Zouch and Simon Vinson at that job's Senior Ecologist rate; Grace Stephenson, Aaron Dooley and Tony Webster at its Project Manager rate; all other staff at its Ecologist rate. Trusted snapshots drive later tracker recalculation, while old unsnapshotted history retains its existing pricing.
- [x] Add a project-specific Charge-out Rates section in Project Operations; company rates are suggested values only, missing confirmed project cards block bulk import without interrupting existing staff time entry, and new card changes do not silently reprice history.
- [x] Preserve exact duplicate blocking and show possible overlaps with previously entered staff/import rows even when notes, km or hours differ; default those overlaps to skip and require an explicit separate-work decision/reason before adding them.
- [x] Show existing-versus-uploaded details and staff/project/week hour reconciliation, and atomically reject stale duplicate-review decisions or new concurrent conflicts without partially saving a batch.

## Evidence

The merged full `npm test` suite and production build passed. Added tests exercise the real supplied-format XLS workbook, exact Job#/Client job mapping, actual preview/import API guards, browser-free reconciliation rendering, 107 rate-card API scenarios, role-ID SQL/JS parity, per-job isolation, historical snapshot/legacy integrity, staff metadata privacy, 10,001-entry pagination, isolated PostgreSQL stale overlap/rate rejection and notification rollback, and the original-RPC fail-closed wrapper. Import entry-table lock ordering now precedes parent/source/allocation locks to avoid a staff/import cycle. The newer remote ERP/image work (PR49, abf1bef) was preserved, including its test command. Both 20 November schema/function migrations were successfully applied to the existing Supabase project without seeding job rates, importing live timesheets or backfilling financial history. Existing backup/system-health/daily-job files were not changed. Git/Vercel release verification is the remaining delivery step.

## Import mappings and optional budget assignment — 24 November 2026
- [x] External consultation falls into General Project Management; Travel into Fieldwork & Travel; GIS/Mapping into GIS/Mapping; Review into QA Review; Desktop / Field plan into Desktop Assessment; Internal consultation into Internal Meeting; Quotes and tenders into Other. Preserve original Task/Notes and handle case, spacing and punctuation variants.
- [x] Allow import without a budget assignment through an explicit No budget assignment preview choice; allocated imports keep approved source/allocation/work-date guards. Missing/stale allocation choices must not silently become unassigned.
- [x] Unassigned imports retain active-project/staff permission checks, confirmed job cards, trusted pricing snapshots, exact/possible duplicate protections and atomic notifications/audit.
- [x] Include unassigned hours/costs exactly once in project actual/remaining hours and money, show them clearly as unassigned, and preserve those totals through correction and deletion without changing individual allocation balances.
- [x] Keep staff financial metadata private, the eleven upload columns unchanged, existing historical pricing untouched, and daily backups/system logs/external payroll unaffected; update the upload-format guidance after verification.
- [x] Use Job# as the primary match to the correct active project. Unique number matches take priority; unknown/duplicate supplied numbers require review, without silent name fallback; retain safe legacy no-number matching and original source identifiers.
- [x] Remove Comments / source references, Import decision, and Review / compare entries from the main import table; retain source data and accessible flagged-row review/skip/overlap safeguards outside that table.
- [x] Flow: 1. Import file / 2. Review & adjust / 3. Approve & upload. A single "Approve & upload timesheets" action, after review,, updating project actuals and hours/money remaining only on commit, with double-ups highlighted before upload.
- [x] Add an administrator Role Cost Overview heading/tab with actual hours/spend for Senior Ecologist, Ecologist, Project Manager and Mileage, project-specific charge-out rates, internal spend, per-role profit and weighted project margin percentage.
- [x] Use labour internal costing rates AUD81/hour Senior Ecologist, AUD75/hour Ecologist and AUD70/hour Project Manager, and keep project internal-cost/profit summaries consistent without repricing stored charge-out history or exposing staff financial metadata.
- [x] Configure Mileage charge-out/internal cost per kilometre only after the user's values are known; show unknown mileage pricing rather than inventing costs or a misleading total margin. Superseded by the next item: mileage charge-out is a per-project admin setting (blank = missing, 0 = non-billable); no rate invented.
- [x] Use Mileage internal cost AUD0.90/km, a project-specific configured mileage charge-out rate, correct km units, and trusted new-entry snapshots; keep historical reference-only mileage uncharged and expenses/vehicle references unchanged.
- [x] Evidence 26 Nov 2026: `npm test` exit 0 (231 PASS lines incl. test:timesheet-policy), `npm run test:timesheet-reconciliation` exit 0, `npm run build` exit 0. Staff routes expose no rates, internal costs or mileage metadata.
- [ ] Apply live migrations (unassigned import, then role/mileage costs), push to main, verify Vercel READY, publish upload-format guide v1.1.
