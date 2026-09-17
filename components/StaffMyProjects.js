"use client";

import { FolderKanban } from "lucide-react";
import StaffProjectTracker from "./StaffProjectTracker";
import WorkspaceNav from "./WorkspaceNav";

/**
 * Staff delivery entry point.
 *
 * Project work, schedules and assignments belong in the Project Tracker. Keeping
 * a single entry point prevents a second, stale "activity details" workspace
 * from duplicating the same operational information.
 */
export default function StaffMyProjects() {
  return (
    <main className="my-projects-page my-projects-tracker-only">
      <header className="my-projects-hero">
        <div>
          <span>
            <FolderKanban size={14} /> Ecology Consulting · delivery workspace
          </span>
          <h1>My Projects</h1>
          <p>
            Select an assigned project to view its delivery position, recorded
            hours, budget position and full work activity plan.
          </p>
        </div>
        <WorkspaceNav audience="staff" />
      </header>

      <StaffProjectTracker embedded />
    </main>
  );
}
