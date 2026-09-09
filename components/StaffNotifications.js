"use client";

import {
  BellRing,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  Scale,
  ShieldCheck,
} from "lucide-react";
import WorkspaceNav from "./WorkspaceNav";
import StaffPortalEvents from "./StaffPortalEvents";
import StaffPortalTaskCalendar from "./StaffPortalTaskCalendar";
import RemoteTasks from "./RemoteTasks";
import Legis from "./Legis";

// Newly-assigned task briefs already appear in "Pending task briefs" above
// (their own portal_events row would otherwise duplicate that). Routine
// tracker-entry logging from other staff is informational noise for the
// person viewing this feed, not something assigned to them or requiring
// their attention — excluded per explicit request to keep this stream to
// assigned items, regulatory updates and task briefs only. A stable
// module-level constant (not an inline array literal) keeps the prop
// reference stable across renders.
const EXCLUDED_EVENT_TYPES = ["remote_task_assigned", "project_tracker_entry"];

export default function StaffNotifications() {
  return (
    <main className="sn-page">
      <section className="sn-hero">
        <div>
          <span>
            <BellRing size={15} /> Staff workflow centre
          </span>
          <h1>Notifications</h1>
          <p>
            New task briefs, project activity assignments, review requests and
            governance updates appear here as they are assigned to you.
          </p>
        </div>
        <WorkspaceNav audience="staff" />
      </section>

      <section className="sn-pending-card" aria-labelledby="sn-legis-title">
        <div className="sn-section-head compact">
          <div>
            <span className="sn-kicker">Weekly regulatory briefing</span>
            <h2 id="sn-legis-title">
              <Scale size={18} /> Legis
            </h2>
            <p>
              NSW/ACT ecology regulatory developments affecting biodiversity
              assessment and approvals, researched and compiled every Monday.
            </p>
          </div>
        </div>
        <Legis />
      </section>

      <section className="sn-pending-card" aria-labelledby="sn-pending-title">
        <div className="sn-section-head compact">
          <div>
            <span className="sn-kicker">Decision required</span>
            <h2 id="sn-pending-title">
              <ClipboardList size={18} /> Pending task briefs
            </h2>
            <p>
              Accept a task to move it into My Projects and add its due date to
              your calendar.
            </p>
          </div>
        </div>
        <RemoteTasks
          isAdmin={false}
          staffStates={["awaiting_acceptance"]}
          compact
          showHome={false}
        />
      </section>

      <div className="sn-layout">
        <section className="sn-events-card" aria-labelledby="sn-workflow-title">
          <div className="sn-section-head">
            <div>
              <span className="sn-kicker">Assignment stream</span>
              <h2 id="sn-workflow-title">
                <ClipboardList size={18} /> Your workflow updates
              </h2>
              <p>
                Select an update to acknowledge it and open the related task or
                project workspace.
              </p>
            </div>
            <span className="sn-live">
              <i /> Live
            </span>
          </div>
          <StaffPortalEvents limit={30} excludeTypes={EXCLUDED_EVENT_TYPES} />
        </section>

        <aside className="sn-side">
          <section
            className="sn-calendar-card"
            aria-labelledby="sn-calendar-title"
          >
            <div className="sn-section-head compact">
              <div>
                <span className="sn-kicker">Accepted work</span>
                <h2 id="sn-calendar-title">
                  <CalendarDays size={18} /> Calendar
                </h2>
              </div>
            </div>
            <StaffPortalTaskCalendar />
          </section>

          <section className="sn-rule-card">
            <ShieldCheck size={19} />
            <div>
              <strong>Calendar rule</strong>
              <p>
                A new task brief appears here immediately. Its deadline appears
                in your calendar only after you accept the task.
              </p>
            </div>
          </section>

          <a className="sn-open-remote" href="/staff/remote-operations">
            <span>
              <ClipboardList size={16} /> View all Task Briefs (including in-progress)
            </span>
            <ExternalLink size={15} />
          </a>
        </aside>
      </div>
    </main>
  );
}
