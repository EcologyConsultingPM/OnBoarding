# Project Close Report upgrade

This is an enhancement to the existing Ecology Consulting portal, based on the supplied `EcologyProjectCloseTemplate(1).html`. It does not replace the portal, change its authentication system or introduce a second project database.

## Where to find it

Open **Admin Portal → Projects and Operations → Close Out**, select a project and open its report. The project selector includes active, on-hold, completed and archived projects. **Choose another project** returns to the selector.

A project already marked complete can still have its first report prepared. Completing delivery and approving the close-out report are separate events. Archived projects and approved reports remain read-only unless a permitted report is explicitly reopened with a reason.

## Template and editing

The report follows the supplied template’s wording, ordered sections, green-gradient header, off-white surfaces and sage treatments:

1. **Deliverables, Budget & Hours** — Project Manager; editable deliverables, budget dollars, budget hours, actual hours and variance.
2. **Project Team** — Project Manager; overseeing senior ecologists and ecologists, including specialty or role.
3. **Project Hurdles** — senior ecologists and ecologists; hurdle, impact and how it was resolved.
4. **Lessons Learnt & Actions** — senior ecologists and ecologists; lesson, action, owner, due date and status.

The report includes project details, inclusive project duration, live budget/hour totals, actual-minus-budget hours variance, and **Closed out by**, **Approved by** and **Close-out date** sign-off fields. Blank project numbers are not guessed from database IDs. Add/remove controls support up to three overseeing senior ecologists, ten ecologists, and 100 rows in each other repeatable section.

**Save draft** saves to the server. Device autosave is separate and explicitly labelled; it is not a server save. Recovery is scoped to the signed-in person, project and staff/admin workspace, and checks the server revision and review round before restoring anything. A revision conflict preserves editor contents and prevents blind overwrites.

## Sending to the project team

Use **Send to project team**, select the current project team members, then choose **Save report & send selected invitations**.

- The master report is saved before invitations are sent.
- Team membership comes from the project lead, overseeing senior ecologist, active project allocations and active work-activity assignments, including multiple assignees.
- Only the selected current members receive an in-portal notification linking to `/staff/project-closeout?projectId=…`.
- Repeating an invitation in the same review round does not duplicate it or reset an existing response.
- Each invited person edits only their own hurdles and lessons. The master report is read-only for staff, and other people’s responses and internal legacy close-out commentary are excluded from their API response.
- Staff can save their own draft and submit it. Submitted responses are retained separately and locked, not silently merged over the master report.
- The project lead and inviting administrator receive a targeted response notification. It is not broadcast to all staff.

These invitations use the portal’s existing notification mechanism; they are not email attachments. No invitations are sent by installing the upgrade.

## Approval, override and reopening

**Submit** requires a project name, at least one deliverable title, the two sign-off names and the close-out date. Outstanding invited responses must be submitted first. Successful submission marks the project complete and locks the report. Open or in-progress lessons remain recorded; submission does not pretend they have been completed.

**Lock editing** saves and locks a draft without completing the project.

**Administrative override — close without normal checks** permits closure without a completed template or outstanding team responses. It requires an explicit confirmation and a reason. It bypasses template validation, including invalid device-only editor fields. The saved server report, existing responses and improvement actions are retained, and pending invitations are cancelled. Unsaved editor edits are not silently submitted: the interface retains them separately as a clearly labelled device-only draft and offers a return to the saved server report.

**Reopen as draft** requires a reason and starts a new review round. Earlier responses remain read-only; a fresh round requires explicit team invitations. A project made complete by this close-out returns to active on reopening. A project completed independently remains complete. Reopening a report never unarchives a project.

**Archive project** is available after report approval and locking. Existing improvement actions must first be completed or archived. The report and audit history remain available.

Project status, report state, invitation updates, audit entries and revision snapshots are committed atomically. A downstream failure rolls back the entire transition rather than leaving a half-closed project.

## Saving a completed copy offline

After the last server save or successful submission:

- **Download offline copy** saves a standalone HTML report with no network dependency. It can be opened on a computer without portal access.
- **Export PDF** opens the complete printable report; select **Save as PDF** in the browser print dialog. Pop-ups must be allowed.

These exports use the complete report content rather than printing clipped input boxes. The administrator’s copy includes attributed team responses, legacy notes and available approval/override metadata. A staff copy includes only the shared report and that person’s own response. Exports containing unsaved edits are explicitly marked as device-only, not final server records.

Downloaded files are ordinary local files: keep them in an appropriately secured project folder. A download is not a server save or a substitute for the database backup. PDF generation uses the browser; no additional paid service is introduced.

## Database and deployment

Migration: `sql/2026-11-03-project-close-report.sql`.

The migration adds master report JSON, revision/review-round and override fields, plus protected invitations and append-only report-state revision tables. It retains existing close-out fields, feedback and improvement actions. Feedback uniqueness changes from one row per person to one per person per review round so previous submissions are preserved.

The migration was applied to the verified live Ecology project `qjsdglkipgncttztksxl` on 3 November 2026. Verification found the pre-existing one close-out and zero feedback rows unchanged; no invitations, project closures or report revisions were created during installation. The new tables have RLS enabled, and actor-parameter mutation RPCs are executable by the server service role only, not anonymous or authenticated browser roles.

Deploy the corresponding code from `feat/project-closeout-template` through the existing `EcologyConsultingPM/OnBoarding` GitHub-to-Vercel workflow. A deployed frontend is required to use the new screen; applying a database migration alone does not change the visible portal. Existing full public-schema/database backups cover the new tables; this does not itself verify the current backup job’s success or include downloaded local files.

## Validation and acceptance

Run `npm run test:closeout`, the complete `npm test` command, and `npm run build`.

The close-out tests exercise report validation, defaults, totals, offline output and HTML escaping; route authentication and recipient scope; and, when an isolated PGlite engine is supplied, real PostgreSQL migration/reapplication, ACL/RLS, conflict rollback, invitation deduplication, immutable submitted responses, override/reopening, historical projects, legacy preservation, cross-project protection, archive gating and audit-failure atomicity. The optional SQL test engine is not added to application runtime dependencies.

Before real use, smoke-test with an authorised administrator and an invited test staff member. Verify targeted notifications, one saved response, ordinary submission or a clearly designated test-project override, and the downloaded report. Do not close a real client project solely to test deployment.

## Rollback

If an application regression occurs, revert the application release through the normal GitHub/Vercel process. Do not drop the new tables or discard recorded review rounds. The additive schema and stored responses should be retained for recovery. Use a forward corrective migration if database behaviour needs adjustment; do not remove audit or client project records to roll back a user-interface change.
