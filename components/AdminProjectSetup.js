"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FolderPlus,
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Users,
  Calendar,
  ClipboardList,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import StaffCapacityPlanner from "./StaffCapacityPlanner";
import ProjectGantt from "./ProjectGantt";
import ProjectCloseOut from "./ProjectCloseOut";
import { ACTIVITY_STATUS } from "./ProjectHealth";

const TASK_CATEGORIES = [
  "Desktop/Field plan",
  "Preparation (pre-fieldwork, pre-report set up)",
  "Fieldwork & travel",
  "Data Management",
  "Reporting",
  "GIS/Mapping",
  "QA Review",
  "Client Consultation",
  "General Project Management",
  "Other",
];
const PROJECT_STATUS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "complete", label: "Complete" },
  { value: "archived", label: "Archived" },
];

export default function AdminProjectSetup({ initialProjectId = null, onOpenTracker = null }) {
  const { session } = useAuth();
  const [view, setView] = useState("list"); // list | detail
  const [setupSubview, setSetupSubview] = useState("projects"); // projects | capacity
  const [projects, setProjects] = useState([]);
  const [staff, setStaff] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const auth = useCallback(
    (method, url, body) =>
      fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    [session],
  );

  const notify = (m) => {
    setMessage(m);
    setError("");
    setTimeout(() => setMessage(""), 2500);
  };
  const fail = (e) => {
    setError(typeof e === "string" ? e : e.message);
    setMessage("");
  };

  const loadProjects = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProjects(data.projects);
    } catch (e) {
      fail(e);
    }
  }, [auth]);

  useEffect(() => {
    if (!session?.access_token) return;
    loadProjects();
    auth("GET", "/api/admin/staff")
      .then((r) => r.json())
      .then((d) =>
        setStaff((d.staff || []).filter((person) => person.active !== false)),
      )
      .catch(() => {});
  }, [session, loadProjects, auth]);

  useEffect(() => {
    if (!initialProjectId) return;
    setOpenId(initialProjectId);
    setView("detail");
  }, [initialProjectId]);

  // ---- Create project ----
  const [newProject, setNewProject] = useState({
    name: "",
    clientName: "",
    clientContact: "",
    sharepointLink: "",
    sharepointLabel: "Project workspace",
    scopeOfWorks: "",
    projectLeadUserId: "",
    description: "",
    startDate: "",
    endDate: "",
    budgetHours: "",
    budgetDollars: "",
    defaultHourlyRate: "",
    status: "active",
  });
  const createProject = async () => {
    if (!newProject.name.trim()) {
      fail("A project name is required.");
      return;
    }
    try {
      const res = await auth("POST", "/api/projects", newProject);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewProject({
        name: "",
        clientName: "",
        clientContact: "",
        sharepointLink: "",
        sharepointLabel: "Project workspace",
        scopeOfWorks: "",
        projectLeadUserId: "",
        description: "",
        startDate: "",
        endDate: "",
        budgetHours: "",
        budgetDollars: "",
        defaultHourlyRate: "",
        status: "active",
      });
      await loadProjects();
      notify("Project created.");
      setOpenId(data.project.id);
      setView("detail");
    } catch (e) {
      fail(e);
    }
  };

  if (view === "detail" && openId) {
    return (
      <ProjectDetail
        key={openId}
        projectId={openId}
        staff={staff}
        auth={auth}
        notify={notify}
        fail={fail}
        onBack={() => {
          setView("list");
          setOpenId(null);
          loadProjects();
        }}
        onOpenTracker={onOpenTracker ? () => onOpenTracker(openId) : null}
        error={error}
        message={message}
      />
    );
  }

  return (
    <div className="aps">
      <header className="aps-hero">
        <span>
          <FolderPlus size={17} /> Delivery & commercial · Admin
        </span>
        <h1>Project setup &amp; allocations</h1>
        <p>
          Create projects, set budgets, build the schedule, allocate staff and
          assign work activities. Allocated staff then see their project health,
          schedule and activities in the staff portal.
        </p>
        <div className="aps-hero-links">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (typeof window !== "undefined")
                window.dispatchEvent(new CustomEvent("ec-goto-remoteops"));
            }}
            className="aps-hero-link"
          >
            <ExternalLink size={13} /> Remote operations oversight
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (typeof window !== "undefined")
                window.dispatchEvent(new CustomEvent("ec-goto-quotepipeline"));
            }}
            className="aps-hero-link"
          >
            <ExternalLink size={13} /> Quoting pipeline
          </a>
        </div>
      </header>

      {error ? (
        <p className="aps-error">
          <AlertCircle size={15} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="aps-success">
          <CheckCircle2 size={15} /> {message}
        </p>
      ) : null}

      <div className="aps-workspace-tabs" role="tablist" aria-label="Setup and Allocations areas">
        <button type="button" role="tab" aria-selected={setupSubview === "projects"} className={setupSubview === "projects" ? "selected" : ""} onClick={() => setSetupSubview("projects")}>Projects, activities &amp; Gantt</button>
        <button type="button" role="tab" aria-selected={setupSubview === "capacity"} className={setupSubview === "capacity" ? "selected" : ""} onClick={() => setSetupSubview("capacity")}>Staff Capacity Planner</button>
      </div>

      {setupSubview === "capacity" ? <StaffCapacityPlanner /> : (
      <div className="aps-grid">
        <section className="aps-card">
          <h2>
            <FolderPlus size={16} /> New project
          </h2>
          <div className="aps-form">
            <input
              placeholder="Project name"
              value={newProject.name}
              onChange={(e) =>
                setNewProject({ ...newProject, name: e.target.value })
              }
            />
            <div className="aps-two">
              <input
                placeholder="Client name"
                value={newProject.clientName}
                onChange={(e) =>
                  setNewProject({ ...newProject, clientName: e.target.value })
                }
              />
              <input
                placeholder="Client contact"
                value={newProject.clientContact}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    clientContact: e.target.value,
                  })
                }
              />
            </div>
            <div className="aps-two">
              <input
                placeholder="Project workspace link"
                value={newProject.sharepointLink}
                onChange={(e) =>
                  setNewProject({ ...newProject, sharepointLink: e.target.value })
                }
              />
              <input
                placeholder="Workspace link label (e.g. SharePoint)"
                value={newProject.sharepointLabel}
                onChange={(e) =>
                  setNewProject({ ...newProject, sharepointLabel: e.target.value })
                }
              />
            </div>
            <select
              value={newProject.projectLeadUserId}
              onChange={(e) =>
                setNewProject({ ...newProject, projectLeadUserId: e.target.value })
              }
            >
              <option value="">Project lead / manager (optional)</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>{person.name || person.email}</option>
              ))}
            </select>
            <textarea
              placeholder="Scope of works / agreed deliverables"
              value={newProject.scopeOfWorks}
              onChange={(e) =>
                setNewProject({ ...newProject, scopeOfWorks: e.target.value })
              }
            />
            <textarea
              placeholder="Project notes / description"
              value={newProject.description}
              onChange={(e) =>
                setNewProject({ ...newProject, description: e.target.value })
              }
            />
            <div className="aps-two">
              <label className="aps-field">
                Start
                <input
                  type="date"
                  value={newProject.startDate}
                  onChange={(e) =>
                    setNewProject({ ...newProject, startDate: e.target.value })
                  }
                />
              </label>
              <label className="aps-field">
                End
                <input
                  type="date"
                  value={newProject.endDate}
                  onChange={(e) =>
                    setNewProject({ ...newProject, endDate: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="aps-three">
              <label className="aps-field">
                Budget hours
                <input
                  value={newProject.budgetHours}
                  onChange={(e) =>
                    setNewProject({
                      ...newProject,
                      budgetHours: e.target.value,
                    })
                  }
                />
              </label>
              <label className="aps-field">
                Budget $
                <input
                  value={newProject.budgetDollars}
                  onChange={(e) =>
                    setNewProject({
                      ...newProject,
                      budgetDollars: e.target.value,
                    })
                  }
                />
              </label>
              <label className="aps-field">
                Default rate
                <input
                  value={newProject.defaultHourlyRate}
                  onChange={(e) =>
                    setNewProject({
                      ...newProject,
                      defaultHourlyRate: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <button className="aps-primary" onClick={createProject}>
              <Plus size={14} /> Create project
            </button>
          </div>
        </section>

        <section className="aps-card">
          <h2>
            <ClipboardList size={16} /> All projects
          </h2>
          {projects.length ? (
            <div className="aps-list">
              {projects.map((p) => (
                <button
                  key={p.id}
                  className="aps-proj"
                  onClick={() => {
                    setOpenId(p.id);
                    setView("detail");
                  }}
                >
                  <div>
                    <strong>{p.name}</strong>
                    <span>{p.client_name || "No client"}</span>
                  </div>
                  <span className="aps-proj-status">
                    {PROJECT_STATUS.find((s) => s.value === p.status)?.label ||
                      p.status}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="aps-empty">No projects yet. Create one to begin.</p>
          )}
        </section>
      </div>
      )}
    </div>
  );
}

// ---- Project detail: edit + schedule + allocations + activities ----
function ProjectDetail({
  projectId,
  staff,
  auth,
  notify,
  fail,
  onBack,
  onOpenTracker,
  error,
  message,
}) {
  const [project, setProject] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [activities, setActivities] = useState([]);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [savingActivities, setSavingActivities] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pRes, aRes] = await Promise.all([
        auth("GET", `/api/projects/${projectId}`),
        auth("GET", `/api/projects/${projectId}/activities`),
      ]);
      const pData = await pRes.json();
      if (!pRes.ok) throw new Error(pData.error);
      setProject(pData.project);
      setSchedule(
        (pData.schedule || []).map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail || "",
          startDate: s.start_date || "",
          endDate: s.end_date || "",
          milestone: s.milestone,
          progressPercent: s.progress_percent ?? 0,
          status: s.status || "not_commenced",
          locked: s.locked === true,
        })),
      );
      setAllocations(
        (pData.allocations || []).map((a) => ({
          staffUserId: a.staff_user_id,
          roleOnProject: a.role_on_project || "",
          allocatedHours: a.allocated_hours ?? "",
          hourlyRate: a.hourly_rate ?? "",
        })),
      );
      const actData = await aRes.json();
      if (aRes.ok)
        setActivities(
          (actData.activities || []).map((x) => ({
            id: x.id,
            staffUserId: x.staff_user_id || "",
            taskCategory: x.task_category || "",
            title: x.title,
            detail: x.detail || "",
            budgetHours: x.budget_hours ?? "",
            dueDate: x.due_date || "",
            scheduleItemId: x.schedule_item_id || "",
            status: x.status || "not_commenced",
            acceptanceStatus: x.acceptance_status || "accepted",
            responseNote: x.response_note || "",
            progressPercent: x.progress_percent ?? 0,
            locked: x.locked === true,
          })),
        );
    } catch (e) {
      fail(e);
    }
  }, [projectId, auth, fail]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDetails = async () => {
    try {
      const res = await auth("PATCH", `/api/projects/${projectId}`, {
        name: project.name,
        clientName: project.client_name,
        clientContact: project.client_contact,
        sharepointLink: project.sharepoint_link,
        sharepointLabel: project.sharepoint_label,
        scopeOfWorks: project.scope_of_works,
        projectLeadUserId: project.project_lead_user_id,
        description: project.description,
        startDate: project.start_date,
        endDate: project.end_date,
        budgetHours: project.budget_hours,
        budgetDollars: project.budget_dollars,
        defaultHourlyRate: project.default_hourly_rate,
        status: project.status,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      notify("Project details saved.");
    } catch (e) {
      fail(e);
    }
  };
  const saveSchedule = async () => {
    try {
      const res = await auth("PUT", `/api/projects/${projectId}`, { schedule });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (Array.isArray(d.schedule)) {
        setSchedule(d.schedule.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail || "",
          startDate: s.start_date || "",
          endDate: s.end_date || "",
          milestone: s.milestone === true,
          progressPercent: s.progress_percent ?? 0,
          status: s.status || "not_commenced",
          locked: s.locked === true,
        })));
      }
      notify("Schedule saved without breaking linked delivery activities.");
    } catch (e) {
      fail(e);
    }
  };
  const deleteProject = async () => {
    if (
      !window.confirm(
        `Delete ${project?.name || "this project"}? This is allowed only when the project has no allocations, activities, schedule items or tracker history.`,
      )
    )
      return;
    try {
      const res = await auth("DELETE", `/api/projects/${projectId}`);
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Could not delete the project.");
      notify("Project deleted.");
      onBack();
    } catch (e) {
      fail(e);
    }
  };
  const saveAllocations = async () => {
    try {
      const res = await auth("PUT", `/api/projects/${projectId}/allocations`, {
        allocations: allocations.filter((a) => a.staffUserId),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      notify("Allocations saved.");
      await load();
    } catch (e) {
      fail(e);
    }
  };
  const saveActivities = async () => {
    if (savingActivities) return;
    setSavingActivities(true);
    try {
      const res = await auth("PUT", `/api/projects/${projectId}/activities`, {
        activities: activities.filter((a) => a.title.trim()),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      notify(`${d.count || 0} activities saved. ${d.notified || 0} staff response request${d.notified === 1 ? "" : "s"} sent.`);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setSavingActivities(false);
    }
  };

  if (!project)
    return (
      <div className="aps">
        <p>Loading…</p>
      </div>
    );
  const staffLabel = (id) =>
    staff.find((s) => s.id === id)?.email || "Select staff";

  return (
    <div className="aps">
      <button className="aps-back" onClick={onBack}>
        <ArrowLeft size={15} /> All projects
      </button>
      {error ? (
        <p className="aps-error">
          <AlertCircle size={15} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="aps-success">
          <CheckCircle2 size={15} /> {message}
        </p>
      ) : null}

      <div className="aps-detail-head">
        <input
          className="aps-title-input"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <button className="aps-primary" onClick={saveDetails}>
          <Save size={14} /> Save details
        </button>
        <button
          className="aps-delete-project"
          onClick={deleteProject}
          title="Delete only empty project records"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>

      {/* Guided setup sequence: Details -> Schedule -> Team -> Activities -> Tracker.
          Each step is marked done from live data; the final step opens the Project
          Tracker. Staff are notified automatically when activities are assigned. */}
      {(() => {
        const hasDetails = Boolean(project?.name);
        const hasSchedule = schedule.length > 0;
        const hasTeam = allocations.some((a) => a.staffUserId);
        const hasActivities = activities.some((a) => (a.title || "").trim());
        const steps = [
          { key: "details", label: "1. Project details", done: hasDetails },
          { key: "schedule", label: "2. Schedule", done: hasSchedule },
          { key: "team", label: "3. Team", done: hasTeam },
          { key: "activities", label: "4. Work activities", done: hasActivities },
          { key: "tracker", label: "5. Project Tracker", done: false, isTracker: true },
        ];
        const readyForTracker = hasDetails && hasTeam && hasActivities;
        return (
          <div className="aps-stepper" role="list" aria-label="Project setup sequence">
            <div className="aps-stepper-track">
              {steps.map((s, i) => (
                <div key={s.key} className={`aps-step ${s.done ? "done" : ""} ${s.isTracker ? "tracker" : ""}`} role="listitem">
                  <span className="aps-step-dot">{s.done ? <CheckCircle2 size={14} /> : i + 1}</span>
                  <span className="aps-step-label">{s.label.replace(/^\d+\.\s/, "")}</span>
                </div>
              ))}
            </div>
            <div className="aps-stepper-cta">
              {readyForTracker ? (
                <>
                  <span className="aps-stepper-note">Setup complete — assigned staff have been notified. Next, set up the Project Tracker.</span>
                  {onOpenTracker ? (
                    <button className="aps-primary" onClick={onOpenTracker}>
                      <ClipboardList size={14} /> Set up Project Tracker →
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="aps-stepper-note">Work through the steps below. Assigning work activities notifies the allocated staff automatically.</span>
              )}
            </div>
          </div>
        );
      })()}

      <section className="aps-card">
        <h2>Project details</h2>
        <div className="aps-form">
          <div className="aps-two">
            <input
              placeholder="Client name"
              value={project.client_name || ""}
              onChange={(e) =>
                setProject({ ...project, client_name: e.target.value })
              }
            />
            <input
              placeholder="Client contact"
              value={project.client_contact || ""}
              onChange={(e) =>
                setProject({ ...project, client_contact: e.target.value })
              }
            />
          </div>
          <div className="aps-two">
            <input
              placeholder="Project workspace link"
              value={project.sharepoint_link || ""}
              onChange={(e) =>
                setProject({ ...project, sharepoint_link: e.target.value })
              }
            />
            <input
              placeholder="Workspace link label (e.g. SharePoint)"
              value={project.sharepoint_label || ""}
              onChange={(e) =>
                setProject({ ...project, sharepoint_label: e.target.value })
              }
            />
          </div>
          <select
            value={project.project_lead_user_id || ""}
            onChange={(e) =>
              setProject({ ...project, project_lead_user_id: e.target.value || null })
            }
          >
            <option value="">Project lead / manager (optional)</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>{person.name || person.email}</option>
            ))}
          </select>
          <textarea
            placeholder="Scope of works / agreed deliverables"
            value={project.scope_of_works || ""}
            onChange={(e) =>
              setProject({ ...project, scope_of_works: e.target.value })
            }
          />
          <textarea
            placeholder="Project notes / description"
            value={project.description || ""}
            onChange={(e) =>
              setProject({ ...project, description: e.target.value })
            }
          />
          <div className="aps-three">
            <label className="aps-field">
              Budget hours
              <input
                value={project.budget_hours || ""}
                onChange={(e) =>
                  setProject({ ...project, budget_hours: e.target.value })
                }
              />
            </label>
            <label className="aps-field">
              Budget $
              <input
                value={project.budget_dollars || ""}
                onChange={(e) =>
                  setProject({ ...project, budget_dollars: e.target.value })
                }
              />
            </label>
            <label className="aps-field">
              Status
              <select
                value={project.status}
                onChange={(e) =>
                  setProject({ ...project, status: e.target.value })
                }
              >
                {PROJECT_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Schedule — compact until a project lead chooses to edit the full delivery plan. */}
      <section className="aps-card aps-schedule-card">
        <div className="aps-card-head">
          <button type="button" className="aps-schedule-toggle" onClick={() => setScheduleExpanded((open) => !open)} aria-expanded={scheduleExpanded}>
            <span><Calendar size={16} /> Project schedule</span>
            <small>{schedule.length} key date{schedule.length === 1 ? "" : "s"} · {scheduleExpanded ? "Hide schedule" : "View and edit schedule"}</small>
          </button>
          {scheduleExpanded ? <button className="aps-secondary" onClick={saveSchedule}><Save size={13} /> Save schedule</button> : null}
        </div>
        {!scheduleExpanded ? <p className="aps-schedule-summary">Open the schedule to review key dates, linked staff, delivery status and Gantt progress.</p> : null}
        {scheduleExpanded ? <div className="aps-schedule-editor">
          {schedule.map((row, i) => {
            const linkedStaff = activities
              .filter((activity) => activity.scheduleItemId === row.id && activity.staffUserId)
              .map((activity) => staff.find((person) => person.id === activity.staffUserId)?.name || staff.find((person) => person.id === activity.staffUserId)?.email || "Allocated staff");
            return <div key={row.id || i} className="aps-schedule-row">
              <div className="aps-schedule-row-head"><strong>Key date {i + 1}</strong><span className={`aps-delivery-state ${row.status || "not_commenced"}`}>{ACTIVITY_STATUS[row.status || "not_commenced"]?.label || "Not yet commenced"}</span></div>
              <div className="aps-schedule-fields">
                <label className="aps-field">Schedule item<input placeholder="Schedule item" value={row.title} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, title: e.target.value } : r))} /></label>
                <label className="aps-field">Delivery detail<input placeholder="Key deliverable or date context" value={row.detail} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, detail: e.target.value } : r))} /></label>
                <label className="aps-field">Start date<input type="date" value={row.startDate} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, startDate: e.target.value } : r))} /></label>
                <label className="aps-field">Key / due date<input type="date" value={row.endDate} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, endDate: e.target.value } : r))} /></label>
                <label className="aps-field">Status<select value={row.status || "not_commenced"} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, status: e.target.value } : r))}>{Object.entries(ACTIVITY_STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
                <label className="aps-field">Completion %<input type="number" min="0" max="100" step="5" value={row.progressPercent ?? 0} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, progressPercent: e.target.value } : r))} /></label>
              </div>
              <div className="aps-schedule-assignment"><Users size={14} /><span><strong>Assigned staff:</strong> {linkedStaff.length ? linkedStaff.join(", ") : "No linked work activity yet"}</span></div>
              <div className="aps-schedule-actions">
                <label className="aps-check"><input type="checkbox" checked={row.milestone} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, milestone: e.target.checked } : r))} /> Milestone</label>
                <label className="aps-check"><input type="checkbox" checked={row.locked === true} onChange={(e) => setSchedule(schedule.map((r, j) => j === i ? { ...r, locked: e.target.checked } : r))} /> Lock staff updates</label>
                <button type="button" className="aps-remove" title="Delete schedule item" aria-label={`Delete ${row.title || "schedule item"}`} onClick={() => setSchedule(schedule.filter((_, j) => j !== i))}><Trash2 size={14} /> Delete</button>
              </div>
            </div>;
          })}
          <button className="aps-add" onClick={() => setSchedule([...schedule, { title: "", detail: "", startDate: "", endDate: "", milestone: false, progressPercent: 0, status: "not_commenced", locked: false }])}><Plus size={13} /> Add key date</button>
        </div> : null}
      </section>

      {/* Allocations */}
      <section className="aps-card">
        <div className="aps-card-head">
          <h2>
            <Users size={16} /> Staff allocations
          </h2>
          <button className="aps-secondary" onClick={saveAllocations}>
            <Save size={13} /> Save allocations
          </button>
        </div>
        {allocations.map((row, i) => (
          <div key={i} className="aps-row">
            <select
              value={row.staffUserId}
              onChange={(e) =>
                setAllocations(
                  allocations.map((r, j) =>
                    j === i ? { ...r, staffUserId: e.target.value } : r,
                  ),
                )
              }
            >
              <option value="">Select staff…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
            <input
              placeholder="Role on project"
              value={row.roleOnProject}
              onChange={(e) =>
                setAllocations(
                  allocations.map((r, j) =>
                    j === i ? { ...r, roleOnProject: e.target.value } : r,
                  ),
                )
              }
            />
            <div className="aps-two">
              <input
                placeholder="Allocated hrs"
                value={row.allocatedHours}
                onChange={(e) =>
                  setAllocations(
                    allocations.map((r, j) =>
                      j === i ? { ...r, allocatedHours: e.target.value } : r,
                    ),
                  )
                }
              />
              <input
                placeholder="Rate $/hr"
                value={row.hourlyRate}
                onChange={(e) =>
                  setAllocations(
                    allocations.map((r, j) =>
                      j === i ? { ...r, hourlyRate: e.target.value } : r,
                    ),
                  )
                }
              />
            </div>
            <button
              className="aps-remove"
              onClick={() =>
                setAllocations(allocations.filter((_, j) => j !== i))
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          className="aps-add"
          onClick={() =>
            setAllocations([
              ...allocations,
              {
                staffUserId: "",
                roleOnProject: "",
                allocatedHours: "",
                hourlyRate: "",
              },
            ])
          }
        >
          <Plus size={13} /> Add allocation
        </button>
      </section>

      <ProjectGantt schedule={schedule} />

      <ProjectCloseOut projectId={projectId} projectName={project.name} onToast={notify} />

      {/* Activities */}
      <section className="aps-card">
        <div className="aps-card-head">
          <h2>
            <ClipboardList size={16} /> Work activities
          </h2>
          <button className="aps-secondary" onClick={saveActivities} disabled={savingActivities}>
            <Save size={13} /> {savingActivities ? "Saving activities…" : "Save activities"}
          </button>
        </div>
        <p className="aps-note">
          Assign activities to allocated staff. Staff are notified immediately;
          an optional due date also places the activity in their portal
          calendar.
        </p>
        {activities.map((row, i) => (
          <div key={i} className="aps-row">
            <input
              placeholder="Activity title"
              value={row.title}
              onChange={(e) =>
                setActivities(
                  activities.map((r, j) =>
                    j === i ? { ...r, title: e.target.value } : r,
                  ),
                )
              }
            />
            <select
              value={row.taskCategory}
              onChange={(e) =>
                setActivities(
                  activities.map((r, j) =>
                    j === i ? { ...r, taskCategory: e.target.value } : r,
                  ),
                )
              }
            >
              <option value="">Task category…</option>
              {TASK_CATEGORIES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={row.staffUserId}
              onChange={(e) =>
                setActivities(
                  activities.map((r, j) =>
                    j === i ? { ...r, staffUserId: e.target.value } : r,
                  ),
                )
              }
            >
              <option value="">Assign to…</option>
              {allocations
                .filter((a) => a.staffUserId)
                .map((a) => (
                  <option key={a.staffUserId} value={a.staffUserId}>
                    {staffLabel(a.staffUserId)}
                  </option>
                ))}
            </select>
            <select
              value={row.scheduleItemId || ""}
              onChange={(e) =>
                setActivities(
                  activities.map((r, j) =>
                    j === i ? { ...r, scheduleItemId: e.target.value } : r,
                  ),
                )
              }
            >
              <option value="">Create a linked Gantt activity line</option>
              {schedule.map((item) => (
                <option key={item.id || item.title} value={item.id || ""}>
                  {item.title || "Untitled schedule item"}
                </option>
              ))}
            </select>
            <textarea
              className="aps-activity-detail"
              rows={2}
              placeholder="Activity detail, deliverable or handover expectation"
              value={row.detail || ""}
              onChange={(e) =>
                setActivities(
                  activities.map((r, j) =>
                    j === i ? { ...r, detail: e.target.value } : r,
                  ),
                )
              }
            />
            <div className="aps-two">
              <input
                placeholder="Hrs"
                value={row.budgetHours}
                onChange={(e) =>
                  setActivities(
                    activities.map((r, j) =>
                      j === i ? { ...r, budgetHours: e.target.value } : r,
                    ),
                  )
                }
              />
              <input
                type="date"
                aria-label={`Due date for ${row.title || "activity"}`}
                value={row.dueDate || ""}
                onChange={(e) =>
                  setActivities(
                    activities.map((r, j) =>
                      j === i ? { ...r, dueDate: e.target.value } : r,
                    ),
                  )
                }
              />
            </div>
            <div className="aps-activity-state">
              <span className={`aps-activity-response ${row.acceptanceStatus || "accepted"}`}>
                Staff: {(row.acceptanceStatus || "accepted").replaceAll("_", " ")}
              </span>
              <span className={`aps-activity-delivery ${row.status || "not_commenced"}`}>
                Delivery: {(row.status || "not_commenced").replaceAll("_", " ")} · {row.progressPercent ?? 0}%
              </span>
              {row.responseNote ? <small>Latest response: {row.responseNote}</small> : null}
              <label className="aps-check"><input type="checkbox" checked={row.locked === true} onChange={(e) => setActivities(activities.map((r, j) => j === i ? { ...r, locked: e.target.checked } : r))} /> Lock staff updates</label>
            </div>
            <button
              className="aps-remove"
              onClick={() =>
                setActivities(activities.filter((_, j) => j !== i))
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          className="aps-add"
          onClick={() =>
            setActivities([
              ...activities,
              {
                staffUserId: "",
                taskCategory: "",
                title: "",
                detail: "",
                budgetHours: "",
                dueDate: "",
                scheduleItemId: "",
                status: "not_commenced",
                acceptanceStatus: "awaiting_response",
                responseNote: "",
                progressPercent: 0,
                locked: false,
              },
            ])
          }
        >
          <Plus size={13} /> Add activity
        </button>
      </section>
    </div>
  );
}
