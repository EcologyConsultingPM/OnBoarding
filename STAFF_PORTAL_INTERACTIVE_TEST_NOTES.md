# Staff Portal Interactive Test Notes

## Review build under test

- Branch: `feature/admin-control-centre-library`
- Commit: `ef6fd622c70391f35465920d53875b888f2c6af2`
- Deployment: `https://on-boarding-dyii6zc1t-ecology-consulting.vercel.app`
- Test date: 28 August 2026 (Australia)
- Environment: connected browser, signed in as Aaron Dooley, Staff Portal selected.

## Completed visual check

The Staff Home loaded successfully at desktop width. The corrected desktop presentation is centred and uses the intended two-region layout: a two-column domain-card area on the left and a separate Staff noticeboard/work-deadlines sidebar on the right. The previous unused third-column space is no longer present. Visible domain order is Notifications, My Projects, Timesheets, WHS & EC Forms, Learning & Development, Species Profiles & Survey Requirements, and Remote Operations. The header includes Home, Admin portal, Settings, Save as PDF and Log out.

## Scope still to test

Navigate to My Projects, inspect the Project Activities, Project Tracker and Service Requests tabs; check the new Service Requests layout and direct route. Do not submit, withdraw, approve or decline a real request during this review without separate confirmation.

## My Projects desktop check

The protected `/staff/projects` route loaded successfully for the signed-in staff session. The hero, Staff home escape control and three sub-domain tabs render correctly. The Project Activities tab settled from loading to the expected empty state: no projects allocated and no accepted task briefs. This is consistent with the known absence of eligible active-project/accepted-task test data; it is not an application error.

The desktop composition is centred and stable. One visual issue is present in the accepted-task panel: the embedded Remote Tasks empty-state surface retains a light/white card inside the dark eucalyptus panel, while the surrounding copy is low contrast. This needs a scoped dark-theme override in the review branch before the broader visual acceptance check is marked complete.

## Service Requests desktop check

The Service Requests tab renders in the signed-in staff workspace and the request history settled to its correct empty state. The new layout is functional and shows the expected leave-specific fields, with type tabs for Leave, Training and Equipment. The form has not been submitted, withdrawn or otherwise mutated during this non-destructive test.

Two presentation issues were verified. The section heading and explanatory text above the cards use light text on the page’s light background, so the `Service requests` heading and supporting text have insufficient contrast. The Project Activities empty-state inspection also showed that an embedded Remote Tasks card still retained a light surface inside a dark panel. Both will be repaired with scoped My Projects styles, without changing user data or workflow behaviour.

## My Projects readability correction verified

On the ready review deployment for commit `42cf3a4`, My Projects now renders with a dark `Project activities` section band that makes the eyebrow, heading and supporting text readable against the page canvas. The embedded Task Briefs area no longer has the inappropriate white standalone Remote Tasks shell; it is visually integrated into the dark panel, with legible heading, supporting copy and empty state. No project allocation or accepted-task test data exists for this account, so the empty states are expected.

## Service Requests readability correction verified

The ready review build now shows the Service Requests heading and supporting copy in a dark eucalyptus section band with sufficient contrast. The new Leave form, decision-history empty state and task-focused dark cards are visually coherent on desktop. Switching to Training was tested without entering or submitting data; the form changed to Course or accreditation, Provider, Preferred date, Estimated cost, Related project or client and Business benefit fields. The form type switch and no-request empty state both worked as expected.

## Project Tracker tab check

The My Projects Project Tracker tab opened and completed its eligibility load without a client-side error. The signed-in staff account receives the correct safe empty state: no tracker is available until an administrator allocates the staff member to an active project and locks the project template. The page also clearly states that submitted Project Tracker entries appear in Timesheets. The missing tracker is a data/configuration prerequisite, not a rendering defect.

## Home navigation check

The Staff home control in My Projects returned to the Staff Portal home successfully. The home screen completed its loading state and retained the centred desktop layout, native fauna/flora card treatment, Staff noticeboard and Work deadlines panel.

## WHS Forms consolidation check

The WHS & EC Forms domain now displays WHS and Internal Governance sub-domains, the device-preview controls, a Staff home control and the single call-to-action for leave, training and equipment requests. The legacy leave/training/equipment request cards are no longer displayed among the WHS forms. The direct `/staff/projects/service-requests` route opened correctly, proving that the WHS call-to-action destination is available; its in-page click target refreshed before automation could activate it, but the route itself was verified directly.

## Notifications and calendar check

The protected Staff Notifications workspace loaded successfully. It correctly separates pending task briefs, workflow updates and the calendar. With no current task data, it settled to the expected no-pending-task and no-new-action states; the calendar explains that accepted tasks and dated activities become deadlines. This confirms the zero-data rendering path and Home control are functional. The acceptance transition, event acknowledgement and calendar insertion cannot be exercised without a disposable assigned task.

A minor visual inconsistency remains: the embedded pending Task Briefs component uses a standalone white card within the dark Notifications panel. It is readable but inconsistent with the required dark eucalyptus presentation and should receive a narrowly scoped dark-panel override.

## Timesheets check

The signed-in Timesheets workspace loaded and settled without error. It presents the required official independent time-entry link, Export XLSX control, refresh action, search, project/client/activity-category/status/update-period filters, custom from/to date fields and newest/oldest/client/project/status sorting choices. The zero-entry message is correct for this account because no tracker entry has been allocated or submitted. Export was not clicked so no file or data was generated during the non-destructive review.

## Internal Governance route check

The staff `/staff/governance` route loaded the Internal Governance sub-domain and showed the staff-facing controlled-document folder set with zero available documents. The wording and folder labels are appropriate, but this direct route does not expose a Staff home or contextual Back control within the visible workspace. This is a verified navigation defect against the portal requirement and should be corrected. The Staff Portal home route then returned successfully.

## Learning and Development check

The signed-in staff view presents a single staff-facing `01 Core Training Modules` folder containing four items; it does not expose the broader administration/governance library folders. This satisfies the staff-restricted visibility intent for the currently available content. Navigation includes both the portal Home control and Staff home control.

The view is functional but visually weaker than the dark eucalyptus domain treatment used elsewhere: it has a sparse light canvas and a flat folder row. This is an aesthetic consistency improvement, not a blocking functional error. The discrepancy between the initial generic empty-state text and the visible one-folder list was resolved after selecting My Learning; the visible list is the current content state.

## Learning redesign deployment

The staff Learning and Development redesign was committed as `8414c4b` and deployed successfully to review. The isolated deployment host requires a fresh portal sign-in because preview hosts maintain separate browser storage. Final rendered visual verification is pending this sign-in.

## Staff Learning and Development redesign verified

The signed-in review build for commit `8414c4b` shows the redesigned Learning & Development workspace successfully. The desktop layout is centred and uses a large dark-eucalyptus hero with the approved native evergreen/floral background, gold eyebrow, readable large heading, Staff home escape control, breadcrumb strip, and a dark empty-state panel. This replaces the former sparse light presentation. The currently available staff content state is still empty at root; the data-access restriction remains intact and no content or learning progress was changed during testing.

## Settings and populated learning folder check

Settings opens as a modal over the staff workspace and presents Auto, Desktop, Tablet and Mobile layout choices. Auto was selected and correctly explains desktop is automatically selected on wide screens. The settings panel was closed without changing the user preference. After closing it, the populated staff root showed one `01 Core Training Modules` card with four approved items, rendered in the new dark domain-card treatment. This confirms that the redesign works for a populated folder as well as the earlier loading/empty state.

## Remote Operations access-control finding

The staff `/staff/remote-operations` route loads successfully and provides Home/Back controls, but its visible UI includes remote-work profile creation, client coordination and commercial quote creation. Source review confirmed the route only requires authentication and the API accepts `POST` for profiles, client records, quotes and issues for every authenticated session. The shared session helper supplies a service-role database client, so the endpoint cannot rely on database RLS for ordinary-staff isolation. This is a verified access-control/design defect: commercial quotes and management records must be reserved for administrators; ordinary staff should be limited to their own remote-work context and an approved question/handover workflow. Remediation is required before release.

## Authorised administrator portal and tracker prerequisite check

The signed-in authorised account can switch between Staff and Admin portals. The Admin home renders all intended high-impact domain cards, including Projects & Operations, Quote Pipeline, Remote Operations Oversight, Regulatory Watch, Learning & Development, Portal Management and Service Requests. Projects & Operations correctly contains Setup & allocations, Project Tracker and Health report tabs. With no live projects, Setup & allocations provides a New project form and an explicit `No projects yet` state; no project was created during this review. This confirms the safe no-data prerequisite flow and avoids inventing data.

## Project Tracker first-project handoff

The administrator Project Tracker tab settled without error and gives a clear dark-panel no-data state. It explains that the tracker and Health Report become available after an active project is created and allocated, with dedicated `Create first active project` and `Configure tracker after creation` actions. This is a correct safe empty state; no project was created because the review preview is connected to live data and no disposable test dataset was approved.

## Health Report check

The administrator-only Health Report tab loaded and calculated successfully. It exposes the required export control, client and health filters, sorting choices, portfolio KPIs, financial/project-health sections and actions panel. With zero active projects, it correctly renders neutral zero values and `No active projects match the selected filters`. The Health Report is not present in the staff My Projects tabs, as required. No export was generated and no data was changed.

## Portal Management governance interface

The authorised administrator Portal Management page loads its intended sub-domain cards and opens Access & administrator control by default. It presents the staffed-directory onboarding form and explicitly states that administrator access can only be granted, amended or removed by Aaron Dooley. The primary-admin-only choices are not offered as ordinary staff access options. The page shows a temporary password only policy but no account or access change was initiated. Register contents were still loading at this observation.

## Administrator authority register check

The controlled authority register completed its load. For this authorised account it states that administrator access changes require Aaron Dooley’s review and presents a request form rather than immediate grant/remove controls. This matches the intended primary-admin governance model in the rendered UI. Server-side enforcement was already verified by source review for the primary-admin path; no request was submitted.

## Access-boundary evidence and limitation

Unauthenticated requests to representative review endpoints for the admin tracker, staff tracker history and Remote Operations were redirected to authentication by the protected review deployment. The authorised portal session showed the Project Health Report only in the Admin Projects & Operations tab, not under Staff My Projects. Full ordinary-staff API isolation could not be exercised because no separately authorised non-admin test account was provided in this browser session. Static review found the Remote Operations endpoint missing the required role restriction despite its use of a service-role client; this is treated as a release-blocking finding and will be remediated in the review branch.

## Final remediation build availability

The review deployment for commit `54e6c0f` is ready and was opened in a signed-in staff session. Its Staff Home renders with the corrected centred two-column domain grid and right-side noticeboard/calendar panel. The user’s requested visibility-control feature is now being designed separately; it requires an additive data model and server enforcement rather than a visual-only card change.

## Remote Operations remediation verification

The deployed review build now shows staff only their Remote-work profile and delivery-support workflow. The commercial quote and client-record forms are absent, and the page explicitly says that commercial records and task allocation remain controlled in the Admin Portal. Home and Back controls are present. This verifies the staff-facing remediation.

A responsive layout defect is visible in the new delivery-support form: the question/issue/handover select, title and detail fields inherit the former horizontal management-form layout and are too compressed beside the action button. The staff-specific form needs a stacked single-column CSS rule before release.

## Portal visibility migration activation

The user explicitly approved application of `sql/2026-08-28-portal-visibility-controls.sql` to the connected Ecology Consulting Supabase production project `qjsdglkipgncttztksxl`. The additive migration completed successfully. The schema now contains `public.portal_visibility_overrides`, has no rows (so no existing staff access was changed), has foreign keys to `auth.users` for the recipient and the editor, and has row-level security enabled without browser-client policies. The review-branch implementation is commit `04c3ab9`; its access-management interface and direct-route guards require review-deployment verification before release.

## Current branch-alias visual verification

The protected review-branch alias successfully loaded for the signed-in Aaron Dooley session. Staff Home is centred at desktop width: a two-column card grid occupies the left operational region and the Staff noticeboard/work-deadlines column is aligned to its right, with no previous oversized blank third column. The native fauna/flora card treatment, header controls, visual balance and top-level order are correct. The view remains on a staff session; current visibility-control eye actions are expected in the Admin Portal.

## Portal visibility control interface check

On the signed-in review-branch Admin Portal, every main domain card renders the new eye action in its upper-right corner. Selecting the Projects & Operations eye opened the dark eucalyptus `Aaron-only access control` modal, labelled `Portal visibility`, with the intended instruction to choose an area and grant or remove access for an active Staff List member. No visibility state was changed. The initial modal render and close control are correct; the pending Staff List data response will be checked before confirming end-to-end readiness.

## Primary administrator safeguard refresh

The persisted review-branch alias refreshed after commit `6a2d82c` and retained the signed-in Aaron administrator session. All domain-card eye controls remain present. Opening the Projects & Operations control again begins a fresh Staff List load; the final permanent-primary badge will be checked once that response settles. No access state was edited.

## Deployment propagation check

Immediately before the second alias refresh, the visible modal still showed the prior `Visible` label for Aaron rather than the new permanent `Primary admin` label. This indicates the branch alias had not yet served commit `6a2d82c` at that moment, despite the Git push. After a further deployment wait, the alias refreshed to its loading state and requires a final load check. No visibility action was selected or submitted.

The second refreshed alias load returned the Admin Portal and all eye controls. The Projects & Operations modal was opened again without mutation; its first frame shows expected loading state. Awaiting the active Staff List response for final confirmation of the permanent-primary label.

## Portal visibility workflow verification

The latest branch alias correctly shows Aaron as `Primary admin` with the explicit hint that primary-administrator access is always visible; this control is no longer presented as removable. The Projects & Operations eye control also exposes distinct sub-domain choices for Setup & Allocations, Project Tracker and Health Report. Selecting the Project Tracker tab updated the target label for the staff rows without changing any permissions. The control is therefore correctly structured for separate domain-level and sub-domain-level visibility decisions. No eye-toggle action was used for staff, so current staff access was not altered during testing.
