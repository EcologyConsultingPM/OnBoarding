"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CirclePause,
  ClipboardList,
  Eye,
  EyeOff,
  Loader2,
  Settings2,
  Users2,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const READINESS_ITEMS = [
  { key: "resourcesReady", label: "Resources ready", description: "Project scope, maps and field material are ready for the allocated team." },
  { key: "trainingChecked", label: "Training checked", description: "Role and project-specific training has been considered." },
  { key: "formsConfigured", label: "Forms configured", description: "Relevant project forms have been identified for this project type." },
  { key: "whsChecked", label: "WHS checked", description: "Required WHS arrangements and controls have been considered." },
];

function jsonFromResponse(response) {
  return response.json().catch(() => ({}));
}

function formatCurrency(dollars) {
  const amount = Number(dollars || 0);
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

function readinessValue(project) {
  const checks = READINESS_ITEMS.filter((item) => Boolean(project?.settings?.[item.key])).length;
  const visibility = project?.settings?.trackerVisible ? 1 : 0;
  return Math.round(((checks + visibility) / (READINESS_ITEMS.length + 1)) * 100);
}

function stateFor(project) {
  return {
    trackerVisible: Boolean(project?.settings?.trackerVisible),
    resourcesReady: Boolean(project?.settings?.resourcesReady),
    trainingChecked: Boolean(project?.settings?.trainingChecked),
    formsConfigured: Boolean(project?.settings?.formsConfigured),
    whsChecked: Boolean(project?.settings?.whsChecked),
  };
}

export default function ProjectTrackerSetup({ onToast }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setupReady, setSetupReady] = useState(false);

  const accessToken = session?.access_token || "";
  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId) || null, [projects, selectedId]);
  const readiness = readinessValue({ settings });
  const activeProject = String(selectedProject?.status || "").toLowerCase() === "active";
  const teamCount = Number(selectedProject?.teamCount || 0);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-setup", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await jsonFromResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not load project tracker setup.");
      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);
      setSetupReady(Boolean(data.setupReady));
      setSelectedId((current) => current || nextProjects[0]?.id || "");
    } catch (loadError) {
      setError(loadError.message || "Could not load project tracker setup.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSettings(stateFor(selectedProject));
  }, [selectedProject]);

  const toggle = (key) => {
    if (!setupReady || saving) return;
    setSettings((current) => ({ ...current, [key]: !current?.[key] }));
  };

  const save = async () => {
    if (!selectedProject || !settings || !setupReady) return;
    if (settings.trackerVisible && !activeProject) {
      onToast?.("Set the project status to Active before enabling its staff tracker.");
      return;
    }
    if (settings.trackerVisible && teamCount === 0) {
      onToast?.("Allocate at least one active team member before enabling the staff tracker.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ projectId: selectedProject.id, ...settings }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not save tracker settings.");
      setProjects((current) => current.map((project) => project.id === selectedProject.id ? { ...project, settings: data.settings } : project));
      setSettings(data.settings);
      onToast?.(data.settings.trackerVisible ? "Tracker visibility saved for the allocated project team" : "Project Tracker is paused for staff");
    } catch (saveError) {
      setError(saveError.message || "Could not save tracker settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pts">
      <header className="pts-hero">
        <div>
          <span>Projects &amp; Operations · Controlled readiness</span>
          <h1>Project Tracker Setup</h1>
          <p>Configure readiness and enable the staff tracker only when an active project has an allocated team.</p>
        </div>
        <div className="pts-hero-mark"><Settings2 size={27} /></div>
      </header>

      {!loading && !setupReady && !error && <div className="pts-notice"><AlertCircle size={17} /><span>Project Tracker settings are prepared for review. They become editable once the separate configuration migration is approved and applied.</span></div>}
      {error && <div className="pts-notice error"><AlertCircle size={17} /><span>{error}</span></div>}

      {loading ? <div className="pts-loading"><Loader2 size={18} className="spin" /> Loading project tracker controls…</div> : projects.length === 0 ? <div className="pts-empty"><ClipboardList size={20} /><strong>No projects are available yet</strong><span>Create a project in Setup &amp; Allocations before configuring its tracker.</span></div> : (
        <div className="pts-layout">
          <aside className="pts-project-list" aria-label="Projects">
            <div className="pts-list-head"><span>Projects</span><b>{projects.length}</b></div>
            {projects.map((project) => {
              const ready = readinessValue(project);
              const active = project.id === selectedId;
              return <button type="button" key={project.id} className={`pts-project ${active ? "selected" : ""}`} onClick={() => setSelectedId(project.id)}>
                <span className={`pts-status ${String(project.status || "").toLowerCase()}`}>{project.status || "Draft"}</span>
                <strong>{project.name}</strong>
                <small>{project.clientName || "Client not recorded"}</small>
                <span className="pts-project-foot"><em>{ready}% ready</em><span>{project.teamCount || 0} team</span></span>
              </button>;
            })}
          </aside>

          {selectedProject && settings && <section className="pts-detail">
            <div className="pts-project-heading">
              <div>
                <span className="pts-kicker">Selected project</span>
                <h2>{selectedProject.name}</h2>
                <p>{selectedProject.clientName || "Client not recorded"} · {selectedProject.status || "Draft"} · {teamCount} allocated {teamCount === 1 ? "person" : "people"}</p>
              </div>
              <div className="pts-score"><strong>{readiness}%</strong><span>Ready</span></div>
            </div>

            <div className="pts-summary-grid">
              <div><span>Budget hours</span><strong>{Number(selectedProject.budgetHours || 0).toLocaleString("en-AU", { maximumFractionDigits: 1 })}</strong></div>
              <div><span>Project budget</span><strong>{formatCurrency(selectedProject.budgetDollars)}</strong></div>
              <div><span>Team allocation</span><strong>{teamCount}</strong></div>
              <div><span>Staff tracker</span><strong className={settings.trackerVisible ? "good" : "muted"}>{settings.trackerVisible ? "Enabled" : "Not enabled"}</strong></div>
            </div>

            <div className="pts-readiness">
              <div className="pts-section-head"><div><span className="pts-kicker">Readiness checks</span><h3>Prepare the project before staff visibility</h3></div><span className="pts-rule">Active project + allocated team required</span></div>
              {READINESS_ITEMS.map((item) => <button type="button" key={item.key} className={`pts-check ${settings[item.key] ? "checked" : ""}`} onClick={() => toggle(item.key)} disabled={!setupReady || saving} aria-pressed={settings[item.key]}><span className="pts-check-icon">{settings[item.key] ? <CheckCircle2 size={17} /> : <span />}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
            </div>

            <div className={`pts-activation ${settings.trackerVisible ? "active" : ""}`}>
              <span className="pts-activation-icon">{settings.trackerVisible ? <Eye size={19} /> : <EyeOff size={19} />}</span>
              <span><strong>{settings.trackerVisible ? "Project Tracker is enabled for allocated staff" : "Project Tracker is not visible to staff"}</strong><small>Staff visibility is granted only to people with an active allocation after this setting is saved.</small></span>
              <button type="button" className="pts-toggle" onClick={() => toggle("trackerVisible")} disabled={!setupReady || saving} aria-pressed={settings.trackerVisible}><span /></button>
            </div>

            {settings.trackerVisible && (!activeProject || teamCount === 0) && <div className="pts-notice warning"><CirclePause size={17} /><span>{!activeProject ? "Set this project to Active in Setup & Allocations before staff tracker visibility can be enabled." : "Allocate at least one staff member before staff tracker visibility can be enabled."}</span></div>}
            <button type="button" className="pts-save" onClick={save} disabled={!setupReady || saving || !selectedProject}>{saving ? <><Loader2 size={16} className="spin" /> Saving settings…</> : <><Users2 size={16} /> Save Project Tracker Setup</>}</button>
          </section>}
        </div>
      )}
    </div>
  );
}
