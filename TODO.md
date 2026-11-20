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
