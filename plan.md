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

## Vercel release recovery

Vercel build events for the attempted release confirmed `pnpm install` failed with “This project is configured to use npm.” The repository has an older `pnpm-lock.yaml` alongside the tested `package-lock.json` and pinned npm toolchain. Set explicit `installCommand: "npm ci"` and `buildCommand: "npm run build"` in the checked-in `vercel.json`, preserving the existing cron definitions. This makes production use the same locked dependency workflow as local checks without changing feature code, dependency versions, staff records, budgets, or existing scheduled jobs. Release success must be confirmed against the resulting Git SHA and production alias, not inferred from a local build.

## XLS export refinement and staff charging rules (20 November 2026)

Automatically map Date, Employee, Client, Job#, Client job, Hours, Expenses, Kms, Vehicle, Task and Notes. Treat Job# as project number, Client job as project name, Task as activity category and Notes as activity information; preserve source task, expenses and vehicle alongside kilometres in entry provenance. Expenses and vehicle values are reference data unless an explicit future expense-charging rule is requested.

Apply the configured role-rate table to tracker charging: Gerard Dwyer, Emily Zouch and Simon Vinson are Senior Ecologists; Grace Stephenson, Aaron Dooley and Tony Webster are Project Managers; other staff charge as Ecologists. Match the named existing staff by stable account ID. Read the role rates from project_role_rates (currently Senior $220/h, Ecologist $180/h, Project Manager $150/h), not a guessed or hard-coded charge amount. Snapshot the authoritative role/rate on new entries and preserve it through corrections; existing unsnapshotted entries use the defined role rule on future recalculation without running a production backfill.

Strengthen reconciliation against previously staff-entered and imported tracker rows: retain exact duplicate blocking, and classify same staff/project/date/category rows with changed comments, kilometres or hours as possible overlaps. Show the existing entries alongside the uploaded row and default potential overlaps to skip. Only allow a deliberate separate-work import with a substantive recorded reason and a current matched-entry snapshot; revalidate the snapshot in the atomic transaction. Detect same-key overlaps within the file and show group-hour comparisons for split/combined entries. Provide per-staff/project/week existing, excluded and proposed-new hours so total increases are transparent. Do not silently replace existing records; corrections remain in the existing audited tracker editor. Rate and duplicate guards must agree between preview, commit and subsequent staff/admin recalculation.

### Clarified job-specific rate cards

The user clarified that role charge amounts differ by job. Supersede the global-dollar application described above: company role rates are suggested starting values only. Add an explicitly confirmed per-project Charge-out Rates card in Project Operations with Project Manager, Senior Ecologist and Ecologist rates. Keep the named-staff role rule, but resolve its amount against the matched project's confirmed card. Require a confirmed card before bulk-importing into that project; do not silently use the company defaults. Preserve existing staff time-entry and legacy project allocation/default-rate behavior for projects awaiting confirmation, and preserve trusted historical entry rate snapshots. Rate-card changes apply to new entries, not a production historical backfill. Save cards with admin authorization, audit and stale-update protection. Spreadsheet headers stay unchanged; Job# resolves the job, while role is resolved from the staff account.

### Final integration and rollout guards

Preserve the newer remote main ERP-form/image changes (PR49, abf1bef) when integrating the refinement. Both importer RPC names now use the reviewed transaction; older unreviewed callers fail closed rather than overwrite snapshot-priced actuals. Import transaction lock order follows ordinary staff writes: entry table first, then project/rate-card/source/allocation rows, preventing a parent-versus-entry-table deadlock with stamping or period triggers. Weekly reconciliation is passed explicitly from the top-level preview response to the UI. New rate cards remain empty until the administrator confirms a real job's amounts; the deployment does not create cards, seed time, reprice history, or test against live staff records.

## Import category rules and optional budget assignment (24 November 2026)

For new CSV/Excel imports apply the user-approved Task mappings: External consultation → General Project Management; Travel → Fieldwork & Travel; GIS/Mapping → GIS/Mapping; Review → QA Review; Desktop / Field plan → Desktop Assessment; Internal consultation → Internal Meeting; Quotes and tenders → Other. Match case/spacing/punctuation variants and preserve the original Task and Notes in provenance. Use the configured spelling of a target when available; allow these explicitly approved canonical targets for unassigned imports without silently renaming existing templates or reclassifying historical entries.

Let the administrator explicitly choose No budget assignment in each import-preview row. Carry budgetAssignment=unassigned through revalidation and the atomic RPC, with both budget references null. Do not silently change invalid/stale allocation references into unassigned rows; ordinary allocated imports retain their source/category/service-period rules. Default matching remains conservative and ambiguous allocations still need an explicit allocation or explicit unassigned choice. Confirmed job-specific charge cards, trusted snapshots, duplicate review, atomic auditing/notifications and active-project/staff authorization remain mandatory regardless of assignment.

Unassigned actual time is project-level work, not free or hidden time: include it exactly once in overall actual/remaining project hours, charge-out spend and the existing internal-cost/profit basis; display an explicit unassigned subtotal while leaving individual allocations unchanged. Preserve this accounting through saved-entry correction and deletion, and retain the distinction between current funded actuals and closed-allocation history. Staff see their own time/history but not charge-rate metadata. No live timesheets/rates/budgets are seeded or backfilled, and existing daily backup/system-health paths and external payroll remain unchanged.

Update the shared import helper, admin importer API/UI, reviewed import RPC/entry guards, project totals and affected entry correction/history paths with isolated regression coverage. Preserve the same eleven upload columns and update the file-format guide's category/assignment notes after the implementation is verified.

### Project-number-first matching

Job# is the primary project key. Automatically select only a unique active linked project-number match when a number is supplied. An outdated source name/client is a visible verification warning, not a reason to choose another project. Unknown or duplicate supplied numbers require review; do not silently fall back to a tempting project-name match. Older rows without a number may retain unique-name matching. Explicit administrator resolution remains available with source-identity mismatch warnings, and the original source identifiers remain in provenance. Budget assignment is a separate optional import-preview decision and does not require another XLS/CSV column.

### Clean import-preview table

Remove Comments / source references, Import decision, and Review / compare entries from the main import preview. Preserve Notes/reference data in stored provenance. Keep necessary unmatched-row/overlap evidence, skip or genuine-separate-work actions and exact-duplicate notices in a compact separate review section for flagged items, not as main-table columns. The cleaner table must not bypass duplicate guards, hide unresolved errors or leave invalid rows impossible to skip.

## Reviewed upload and Role Cost Overview

Retain a distinct Upload reviewed timesheets action after file reading/mapping/review. Only that action commits actual time, refreshes available project hours/money and preserves highlighted duplicate safeguards. Add an admin-only Role Cost Overview tab with Senior Ecologist, Ecologist, Project Manager and Mileage rows, actual hours/km, current project charge-out rate, recorded charge-out spend, internal costing rate/spend, profit and margin. Labour internal costing rates are Senior Ecologist AUD81/hour, Ecologist AUD75/hour and Project Manager AUD70/hour. Profit is recorded charge-out spend less internal spend; the overall margin is total profit divided by total recorded charge-out spend, not an average of role percentages. Preserve trusted historical charge-out snapshots and explain any difference from today's project card.

Include allocated and explicit unassigned actual time exactly once, exclude planned activity hours and keep current funded versus closed-allocation history clear. Use the fixed labour internal costing policy consistently across the role report and project internal-cost/profit totals rather than leaving a conflicting 60%-of-charge calculation. Do not run a production financial-history backfill: derive current displays from recorded entries and use the policy on subsequent normal recalculations. Mileage charge-out and internal cost rates per kilometre require the user's values; show unconfigured mileage explicitly rather than guessing or treating missing costs as zero. Keep all role/cost details administrator-only; no change to payroll submissions or staff pay rates.

### Confirmed Mileage costing

The user confirmed Mileage internal cost at AUD0.90/km. Add a separate optional project-card mileage charge-out rate ($/km), requiring an explicit configured value before charging new positive-km imports. Zero is an explicit non-billable rate, not a missing value. New records retain trusted mileage charge/internal-rate snapshots; legacy mileage that was explicitly reference-only remains uncharged and is not retroactively repriced by today's card. Apply the requested fixed internal policy to the role/internal-cost view, clearly distinguishing historical reference kilometres. Labour and mileage charges/costs must add once to project balances; kilometre quantities do not become labour hours. Expenses/vehicle remain references.

## 26 Nov 2026 — approval flow and release

Importer steps are now "1. Import file / 2. Review & adjust / 3. Approve & upload". The single "Approve & upload timesheets" action saves the reviewed entries and refreshes project budget and hours remaining in one transaction. Legacy test harnesses were updated for paginated entry loading, approved-source allocation totals, the all-in charge helper and the optional mileage rate. The full suite and the build pass.
