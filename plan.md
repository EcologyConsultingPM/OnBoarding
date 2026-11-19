# Weekly timesheet import and Project Tracker balance synchronization

## Product behavior and implementation

Add an administrator-only workflow inside the existing Project Tracker → Timesheet Entries view. The admin selects a weekly CSV/Excel export, maps its headers to work date, staff name, client, project name/number, hours, kilometres, activity category and comments, then reviews a sorted and filterable preview. The preview resolves active projects/staff where possible and clearly flags unresolved, invalid, ambiguous and duplicate rows. The admin can manually resolve row-level matches, and only validated non-duplicate rows are submitted. The server revalidates every row immediately before insert, stores comments in the existing activity-information field, and retains kilometres and import provenance in `custom_data`.

Use the existing authenticated server routes, tracker sources/allocations and project-entry table; avoid new database tables. Imported entries are tagged as administrator-entered, marked completed, grouped into a batch, and trigger allocation-total recalculation plus staff notification. Existing delete flows retain audit-before-delete behavior and allocation refresh; tests will cover the resulting project balance behavior.

Fix the Project Operations mismatch at `PATCH /api/projects/[projectId]`: monthly source-backed budgets continue to use their current transactional RPC; ordinary budget edits update the single approved, non-perioded original tracker source when one exists, while variations/actuals stay separate. A source-backed project with no uniquely editable approved original must not silently claim its tracker baseline changed. After a successful edit, issue the existing project-source-change signal so an open tracker view reloads. Projects without source rows continue to use the legacy project-register fallback.

## Structure

- `components/AdminProjectTracker.js`: launch the importer, show kilometre values in timesheet rows and refresh when Project Operations signals a source update.
- `components/AdminTimesheetImporter.js`: file selection, column mapping, sortable/filterable preview, row-level match fixes and explicit import action; reuse the portal's forest-green/off-white/gold style.
- `app/api/admin/project-tracker-timesheet-import/route.js`: admin authorization, CSV/Excel parsing, active-project/staff resolution, duplicate and budget classification, import revalidation, inserts and allocation refresh.
- `lib/projectTimesheetImport.js`: pure column detection, value/date normalization and duplicate-key helpers shared by UI and tests.
- `app/api/projects/[projectId]/route.js`: synchronize ordinary project-register budget edits to the approved original tracker source; preserve the existing monthly-budget RPC.
- `app/globals.css` and `scripts/check_project_tracker_timesheet_import.mjs`: responsive portal styling and regression coverage.

## Visual direction

Reuse the existing Ecology Consulting project operations style rather than adding decorative assets: forest-green working surfaces, warm neutral content areas, muted sage labels and restrained gold for review/confirmation states. Keep the import flow task-focused, with a clear step sequence, visible row counts and prominent but distinct warning/error states. Keyboard labels and responsive overflow are required for the mapping and preview tables.

## Constraints

- Keep import administrator-only and limit individual files/batches to a reasonable bounded size.
- Never import inactive/deleted projects or silently guess ambiguous project, staff or category matches.
- Preserve current audit, notification, monthly budget, and project/source rules; do not alter the external staff timesheet link.
- Kilometres remain reference data and do not affect charge-out budget calculations.
- Preserve the existing Portal Management daily backup coverage and system-health/error-code surfaces.

## Integrity refinements

Overlapping source/allocation matches must be resolved explicitly in preview rather than selecting the first source. Apply imports through an administrator-only database transaction that serializes duplicate protection, validates current project/source eligibility, writes entries and recalculates totals, and creates staff notification events atomically. Store a unique import fingerprint to prevent concurrent identical imports. Record the existing admin-provenance column in an idempotent tracked migration. Ordinary original-source budget saves likewise use an atomic project/source RPC with concurrency guards; no partial project-master save may be reported as synchronized. Migrations add functions/indexes only and do not seed or alter actual production timesheets for testing.
