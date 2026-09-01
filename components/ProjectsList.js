"use client";

import { useEffect, useState } from "react";
import { FolderKanban, ChevronRight, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS_LABELS = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  complete: "Complete",
  archived: "Archived",
};
const STATUS_COLORS = {
  planning: "#6b755f",
  active: "#3d7a35",
  on_hold: "#b08948",
  complete: "#2a8091",
  archived: "#8a927c",
};

export default function ProjectsList({ onOpen }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const response = await fetch("/api/projects?audience=staff", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load projects.");
        setProjects(data.projects);
      } catch (requestError) {
        setError(requestError.message || "Could not load projects.");
      }
    })();
  }, [session]);

  if (error) {
    return <div className="proj-error" role="alert"><AlertCircle size={16} /> {error}</div>;
  }
  if (projects === null) {
    return <p style={{ color: "#6b755f", fontWeight: 600 }}>Loading your projects…</p>;
  }
  if (!projects.length) {
    return (
      <div className="proj-empty">
        <FolderKanban size={22} />
        <div>
          <strong>No projects allocated yet</strong>
          <span>Projects you are allocated to by an administrator will appear here with their schedule and budget.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="proj-list">
      {projects.map((project) => (
        <button key={project.id} className="proj-card" onClick={() => onOpen(project.id)}>
          <div className="proj-card-main">
            <div className="proj-card-title">{project.name}</div>
            <div className="proj-card-sub">{project.client_name || "No client recorded"}</div>
          </div>
          <span className="proj-status" style={{ background: `${STATUS_COLORS[project.status]}1a`, color: STATUS_COLORS[project.status] }}>
            {STATUS_LABELS[project.status] || project.status}
          </span>
          <ChevronRight size={18} color="#8a927c" />
        </button>
      ))}
    </div>
  );
}
