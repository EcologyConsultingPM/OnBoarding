"use client";

import { useState } from "react";
import { ClipboardList, FolderKanban, LifeBuoy, ListChecks } from "lucide-react";
import ProjectsList from "./ProjectsList";
import ProjectHealth from "./ProjectHealth";
import RemoteTasks from "./RemoteTasks";
import StaffProjectTracker from "./StaffProjectTracker";
import StaffServiceRequests from "./StaffServiceRequests";
import WorkspaceNav from "./WorkspaceNav";

const TABS = [
  { id: "activities", label: "Project activities", Icon: ListChecks },
  { id: "tracker", label: "Project tracker", Icon: ClipboardList },
  { id: "requests", label: "Service requests", Icon: LifeBuoy },
];

/**
 * Staff delivery workspace. It intentionally contains no portfolio health or
 * other-staff financial data. Pending task acceptance is handled in
 * Notifications; only accepted remote tasks are rendered here.
 */
export default function StaffMyProjects({ initialTab = "activities" }) {
  const [tab, setTab] = useState(initialTab);
  const [projectId, setProjectId] = useState(null);

  return (
    <main className="my-projects-page">
      <header className="my-projects-hero">
        <div>
          <span><FolderKanban size={14} /> Ecology Consulting · delivery workspace</span>
          <h1>My Projects</h1>
          <p>Accepted task briefs, allocated project activities, your locked Project Tracker and service requests in one place.</p>
        </div>
        <WorkspaceNav audience="staff" />
      </header>

      <nav className="my-projects-tabs" role="tablist" aria-label="My Projects areas">
        {TABS.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "selected" : ""}
            onClick={() => { setTab(id); setProjectId(null); }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {tab === "activities" ? (
        <section className="my-projects-activities" aria-labelledby="project-activities-heading">
          {projectId ? (
            <div className="my-projects-project-detail">
              <WorkspaceNav audience="staff" onBack={() => setProjectId(null)} backLabel="All my projects" />
              <ProjectHealth projectId={projectId} onBack={() => setProjectId(null)} showBack={false} />
            </div>
          ) : (
            <>
              <div className="my-projects-section-head">
                <div>
                  <span>Allocated delivery</span>
                  <h2 id="project-activities-heading"><ListChecks size={18} /> Project activities</h2>
                  <p>Your allocated projects and accepted task briefs. New briefs remain in Notifications until you accept them.</p>
                </div>
              </div>
              <div className="my-projects-activity-grid">
                <section className="my-projects-panel">
                  <h3>My allocated projects</h3>
                  <ProjectsList onOpen={setProjectId} />
                </section>
                <section className="my-projects-panel">
                  <h3>Accepted task briefs</h3>
                  <RemoteTasks isAdmin={false} staffStates={["accepted", "in_progress", "submitted", "revising"]} compact showHome={false} />
                </section>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "tracker" ? <StaffProjectTracker embedded /> : null}
      {tab === "requests" ? <StaffServiceRequests embedded /> : null}
    </main>
  );
}
