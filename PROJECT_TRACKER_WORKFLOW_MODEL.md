# Project Tracker Workflow Model

The Project Tracker uses a single existing `projects` record as the project master. It does not create a competing project register. The original project budget is retained as the commercial baseline, while approved variations and operational budget allocations are additive tracker records.

| Layer | Controlled by | Purpose | Staff visibility |
|---|---|---|---|
| Project master | Administrator | Client, project status, original project details, team allocation | Only when active and tracker visibility has been enabled |
| Original budget source | Administrator | Immutable contract baseline seeded from the existing project budget | Read-only to staff |
| Approved variation | Administrator | Separately identifies commercial scope or budget variation | Read-only to staff |
| Operational allocation | Administrator | Staff-selectable work bucket under a budget source, with value/hours/threshold controls | Available only when marked staff-visible |
| Project tracker entry | Allocated staff member | Auditable work-date, hours, allocation and note entry | The staff member sees their own entries in Timesheets |
| Portfolio health report | Administrator | Aggregated project financial and delivery health based on controlled tracker data | Administrator only |

## Workflow and events

| Trigger | System result | Recipient |
|---|---|---|
| Administrator creates/updates Project Tracker Setup | Readiness audit event retained | Administrator audit record |
| Administrator enables the tracker for an active, allocated project | Tracker visibility event created | Allocated project staff |
| Administrator assigns a project activity | Assignment workflow event created | Assigned staff member |
| Administrator activates a staff-visible allocation | Allocation is available in the eligible staff entry form | Allocated project staff, when the project tracker is enabled |
| Staff submits a Project Tracker entry | Immutable entry saved; operational allocation hours are recalculated; workflow event created | Project owner / creating administrator |
| Staff changes a current project activity status | Existing immutable activity-history entry saved | Staff Timesheets history and administrator project review |
| Administrator reviews portfolio health | Project-level health is recalculated from active sources, allocations and activity status | Administrator only |

> **Timesheet boundary:** `https://staff.ecologyconsulting.au/` remains the official independent time-entry system. The Ecology Consulting portal does not submit time to it. Instead, each staff member’s own Project Tracker entry history is shown in their Timesheets domain as a reference for time entry.

## Calculation boundaries

The tracker calculates original budget, approved variations, total approved budget, controlled charge-out spend, controlled internal cost, allocation-hour consumption, remaining budget/hours, delivery progress and risk state. Cost and charge-out values remain administrator-controlled inputs; staff entries increment auditable delivery hours and do not invent financial rates or alter an approved budget.

This creates an audit-safe staged rollout: existing project records, activities and project activity history remain intact while the new commercial tracker tables add detail around them.
