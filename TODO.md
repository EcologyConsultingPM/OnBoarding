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

## Evidence

The full `npm test` suite passed. The dedicated `test:project-tracker-timesheet-import` command passed preview/source ambiguity, resource permission, duplicate normalization, isolated PostgreSQL import/notification rollback, concurrent identical submissions, and atomic original-budget regression cases. The production build passed; a final release build is repeated after the last access/normalization fixes. Both atomic-save migrations were applied successfully to the existing Supabase project, with no live timesheet or budget writes used for testing. Existing backup, system-health and daily-job files are unchanged. Git/Vercel release confirmation remains a delivery step rather than a product criterion.
