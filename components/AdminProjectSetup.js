"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  GripVertical,
  ClipboardCheck,
  Check,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import ProjectGantt from "./ProjectGantt";
import { ACTIVITY_STATUS } from "./ProjectHealth";
import { TIME_CATEGORIES, wbsForDeliverable } from "../lib/ecologicalWbs";

// Activities are detailed WBS steps; staff record time only against these ten
// consistent categories. This keeps the tracker usable across projects while
// the generated activity title tells a worker exactly what the time relates to.
const TASK_CATEGORIES = TIME_CATEGORIES;
const BLANK_PROJECT = {
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
  status: "planning",
};

const PROJECT_STATUS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "complete", label: "Complete" },
  { value: "archived", label: "Archived" },
];

const PROJECT_SETUP_STAGES = [
  { key: "details", label: "Initiation", help: "Confirm the accepted project, client, scope, dates, manager and approved budget." },
  { key: "team", label: "PMP team", help: "Allocate the project team, roles, hours and rates." },
  { key: "deliverables", label: "Deliverables", help: "Define the outputs the project must produce." },
  { key: "activities", label: "Work activities", help: "Break deliverables into assigned, budgeted and dated activities." },
  { key: "schedule", label: "Schedule", help: "Review the delivery sequence, milestones and completion measures." },
  { key: "review", label: "Review & activate", help: "Complete readiness checks and record the Senior Ecologist approval gate." },
];

export default function AdminProjectSetup({ initialProjectId = null, onOpenTracker = null, onOpenCloseOut = null }) {
  const { session } = useAuth();
  const [view, setView] = useState("list"); // list | detail
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
    // Token string, not the session object: Supabase re-broadcasts a new
    // session object on every TOKEN_REFRESHED (which fires on tab focus), and
    // depending on the object made every consumer of `auth` unstable.
    [session?.access_token],
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

  const [removingId, setRemovingId] = useState("");

  // Remove a project from the list.
  //
  // A project with no delivery record is deleted outright. One that HAS
  // allocations, activities, schedule items or tracker history cannot be —
  // the API returns 409 because deleting it would destroy the delivery and
  // WHS record. In that case we offer archiving instead, which is what the
  // list already filters on (status !== "archived"), so it disappears from the
  // active list while the record is retained.
  const removeProject = async (project) => {
    const label = `${project.name}${project.client_name ? ` (${project.client_name})` : ""}`;
    if (!window.confirm(`Move ${label} to the recycle bin?\n\nIt is removed from the project list but nothing is destroyed — activities, tracker history and allocations are all kept, and you can restore it at any time.`)) return;

    setRemovingId(project.id);
    setError("");
    try {
      const res = await auth("DELETE", `/api/projects/${project.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove this project.");
      setProjects((current) => current.filter((row) => row.id !== project.id));
      if (openId === project.id) { setOpenId(""); setView("list"); }
      notify(`${project.name} moved to the recycle bin.`);
    } catch (e) {
      fail(e);
    } finally {
      setRemovingId("");
    }
  };

  // ---- Recycle bin ----
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);

  const loadTrash = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/projects?view=trash");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTrash(data.projects || []);
    } catch (e) {
      fail(e);
    }
  }, [auth]);

  const restoreProject = async (project) => {
    setRemovingId(project.id);
    try {
      const res = await auth("PATCH", `/api/projects/${project.id}`, { action: "restore" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not restore this project.");
      setTrash((current) => current.filter((row) => row.id !== project.id));
      await loadProjects();
      notify(`${project.name} restored.`);
    } catch (e) { fail(e); } finally { setRemovingId(""); }
  };

  // Permanent deletion is refused by the server for anything carrying delivery
  // or WHS history. That guard is deliberate: the bin is the end of the road
  // for those, not a route to destroying the record.
  const purgeProject = async (project) => {
    if (!window.confirm(`Permanently delete ${project.name}?\n\nThis cannot be undone. It will only succeed if the project has no activities, allocations, schedule items or tracker history.`)) return;
    setRemovingId(project.id);
    try {
      const res = await auth("DELETE", `/api/projects/${project.id}?purge=true`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not permanently delete this project.");
      setTrash((current) => current.filter((row) => row.id !== project.id));
      notify(`${project.name} permanently deleted.`);
    } catch (e) { fail(e); } finally { setRemovingId(""); }
  };

  const loadProjects = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Archived projects (close-out complete) drop out of the active list —
      // the record isn't deleted, just no longer shown as current work.
      setProjects((data.projects || []).filter((p) => p.status !== "archived"));
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
  const [newProject, setNewProject] = useState(BLANK_PROJECT);
  const [draftRestored, setDraftRestored] = useState(false);

  // Project setup is the largest data-entry surface in the app — 38 fields
  // across the create form and the detail panels — and it had no draft
  // protection at all. Anything that unmounted the tree mid-entry (a token
  // refresh on tab focus, a stray navigation, a closed laptop) lost the lot.
  // Same per-user localStorage pattern already used by Service Requests.
  const draftKey = session?.user?.id ? `ec-new-project-draft:${session.user.id}` : "";

  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftKey) || "null");
      if (saved && typeof saved === "object" && Object.values(saved).some((v) => String(v || "").trim() && v !== "Project workspace" && v !== "active")) {
        setNewProject({ ...BLANK_PROJECT, ...saved });
        setDraftRestored(true);
      }
    } catch {}
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    const meaningful = Object.entries(newProject).some(([key, value]) =>
      !["sharepointLabel", "status"].includes(key) && String(value || "").trim());
    if (!meaningful) { window.localStorage.removeItem(draftKey); return; }
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(draftKey, JSON.stringify(newProject)); } catch {}
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draftKey, newProject]);

  const discardDraft = () => {
    if (draftKey) window.localStorage.removeItem(draftKey);
    setNewProject(BLANK_PROJECT);
    setDraftRestored(false);
  };
  const createProject = async () => {
    if (!newProject.name.trim()) {
      fail("A project name is required.");
      return;
    }
    try {
      const res = await auth("POST", "/api/projects", newProject);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewProject(BLANK_PROJECT);
      if (draftKey) window.localStorage.removeItem(draftKey);
      setDraftRestored(false);
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
        userId={session?.user?.id}
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
        onOpenCloseOut={onOpenCloseOut ? (projectId, name) => onOpenCloseOut(projectId || openId, name) : null}
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
        <h1>Project initiation &amp; delivery plan</h1>
        <p>
          Move an accepted project through initiation, PMP setup, team allocation,
          deliverables, activities, schedule review and controlled activation.
          The live tracker then monitors budget, hours and completion through to close-out.
        </p>
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

      <div className="aps-grid">
        <section className="aps-card">
          <h2>
            <FolderPlus size={16} /> New project
          </h2>
          {draftRestored ? (
            <p className="aps-draft-note">
              Unsaved project details were restored from this browser.
              <button type="button" className="ec-btn--quiet" onClick={discardDraft}>Discard and start again</button>
            </p>
          ) : null}
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
          <button
            type="button"
            className="aps-trash-toggle"
            onClick={() => { const next = !trashOpen; setTrashOpen(next); if (next) loadTrash(); }}
          >
            <Trash2 size={13} /> {trashOpen ? "Hide recycle bin" : "Recycle bin"}
            {trash.length ? <span className="aps-trash-count">{trash.length}</span> : null}
          </button>

          {trashOpen ? (
            <div className="aps-trash">
              <p className="aps-trash-note">
                Removed projects. Nothing here has been destroyed — activities, tracker
                history and allocations are retained. Permanent deletion only succeeds
                for projects with no delivery record.
              </p>
              {trash.length ? (
                <div className="aps-list">
                  {trash.map((p) => (
                    <div key={p.id} className="aps-proj-row aps-proj-row--trash">
                      <div className="aps-proj aps-proj--static">
                        <div>
                          <strong>{p.name}</strong>
                          <span>{p.client_name || "No client"}{p.deleted_at ? ` · removed ${new Date(p.deleted_at).toLocaleDateString("en-AU")}` : ""}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ec-btn ec-btn--neutral"
                        disabled={removingId === p.id}
                        onClick={() => restoreProject(p)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="ec-btn ec-btn--destructive"
                        disabled={removingId === p.id}
                        onClick={() => purgeProject(p)}
                        title="Only possible when the project has no activities, allocations, schedule items or tracker history"
                      >
                        Delete forever
                      </button>
                    </div>
                  ))}
                </div>
              ) : <p className="aps-trash-empty">The recycle bin is empty.</p>}
            </div>
          ) : null}

          {projects.length ? (
            <div className="aps-list">
              {projects.map((p) => (
                <div key={p.id} className="aps-proj-row">
                  <button
                    type="button"
                    className="aps-proj"
                    onClick={() => {
                      setOpenId(p.id);
                      setView("detail");
                    }}
                  >
                    <div>
                      <strong style={{ color: "#fffdf8", fontSize: 16, fontWeight: 800, display: "block" }}>{p.name}</strong>
                      <span style={{ color: "rgba(255,253,248,.62)" }}>{p.client_name || "No client"}</span>
                    </div>
                    <span className="aps-proj-status">
                      {PROJECT_STATUS.find((s) => s.value === p.status)?.label ||
                        p.status}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="aps-proj-remove"
                    disabled={removingId === p.id}
                    aria-label={`Remove ${p.name} from the project list`}
                    title="Delete, or archive if it has a delivery record"
                    onClick={() => removeProject(p)}
                  >
                    {removingId === p.id ? "…" : <Trash2 size={15} />}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="aps-empty">No projects yet. Create one to begin.</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- Project detail: edit + schedule + allocations + activities ----
function ProjectDetail({
  projectId,
  userId,
  staff,
  auth,
  notify,
  fail,
  onBack,
  onOpenTracker,
  onOpenCloseOut,
  error,
  message,
}) {
  const [project, setProject] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [activities, setActivities] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [deliverableTemplates, setDeliverableTemplates] = useState([]);
  const [quickAddTemplateId, setQuickAddTemplateId] = useState("");
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [activitiesDraftAvailable, setActivitiesDraftAvailable] = useState(null); // null=not checked, or the parsed draft
  const [knownMaxUpdatedAt, setKnownMaxUpdatedAt] = useState("");
  const [conflictPending, setConflictPending] = useState(false);
  const [activitiesDraftRestored, setActivitiesDraftRestored] = useState(false);
  const activitiesDraftKey = userId && projectId ? `ec-activities-draft:${userId}:${projectId}` : "";

  // Auto-save the activities editor to localStorage, debounced, so a crash
  // or accidental navigation mid-entry doesn't lose dozens of rows of work.
  // This never touches the server — it's purely a local safety net until
  // "Save activities" is clicked.
  useEffect(() => {
    if (!activitiesDraftKey) return;
    const meaningful = activities.some((r) => (r.title || "").trim());
    if (!meaningful) { window.localStorage.removeItem(activitiesDraftKey); return; }
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(activitiesDraftKey, JSON.stringify(activities)); } catch {}
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activitiesDraftKey, activities]);

  const [dragIndex, setDragIndex] = useState(null);
  const reorderActivities = (from, to) => {
    if (from === to || from == null || to == null) return;
    setActivities((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [savingActivities, setSavingActivities] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [activeStage, setActiveStage] = useState("details");
  const [stageSaving, setStageSaving] = useState(false);
  const stageTopRef = useRef(null);

  const goToStage = (key) => {
    setActiveStage(key);
    if (key === "schedule") setScheduleExpanded(true);
    window.requestAnimationFrame(() => stageTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  useEffect(() => {
    auth("GET", "/api/deliverable-templates")
      .then((r) => r.json())
      .then((d) => setDeliverableTemplates(d.templates || []))
      .catch(() => setDeliverableTemplates([]));
  }, [auth]);

  const quickAddFromTemplate = async () => {
    if (!quickAddTemplateId) { fail("Choose a deliverable template first."); return; }
    setQuickAddBusy(true);
    try {
      const res = await auth("POST", `/api/projects/${projectId}/deliverables`, {
        templateId: quickAddTemplateId,
        title: quickAddTitle.trim() || undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      notify(`${d.activities?.length || 0} activities generated from "${d.templateUsed}" — allocate staff, budget and dates below.`);
      setQuickAddTemplateId("");
      setQuickAddTitle("");
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setQuickAddBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [pRes, aRes, dRes] = await Promise.all([
        auth("GET", `/api/projects/${projectId}`),
        auth("GET", `/api/projects/${projectId}/activities`),
        auth("GET", `/api/projects/${projectId}/deliverables`),
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
      if (aRes.ok) {
        setKnownMaxUpdatedAt((actData.activities || []).reduce((max, a) => (a.updated_at && a.updated_at > max ? a.updated_at : max), ""));
        setActivities(
          (actData.activities || []).map((x) => ({
            id: x.id,
            staffUserId: x.staff_user_id || "",
            taskCategory: x.task_category || "",
            title: x.title,
            detail: x.detail || "",
            budgetHours: x.budget_hours ?? "",
            dueDate: x.due_date || "",
            startDate: x.start_date || "",
            milestone: x.milestone === true,
            scheduleItemId: x.schedule_item_id || "",
            deliverableId: x.deliverable_id || "",
            status: x.status || "not_commenced",
            acceptanceStatus: x.acceptance_status || "accepted",
            responseNote: x.response_note || "",
            progressPercent: x.progress_percent ?? 0,
            locked: x.locked === true,
          })),
        );
      }
      const delData = await dRes.json();
      if (dRes.ok) setDeliverables(delData.deliverables || []);

      // Check for an unsaved local draft of the activities editor, but never
      // apply it automatically — this restores onto real server data, and a
      // silent overwrite could clobber a more recent edit from someone else
      // working the same project. The admin explicitly chooses via a banner.
      if (activitiesDraftKey) {
        try {
          const saved = JSON.parse(window.localStorage.getItem(activitiesDraftKey) || "null");
          if (Array.isArray(saved) && saved.some((r) => (r.title || "").trim())) {
            setActivitiesDraftAvailable(saved);
          }
        } catch {}
      }
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
        overseeingSeniorEcologistUserId: project.overseeing_senior_ecologist_user_id,
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
      return true;
    } catch (e) {
      fail(e);
      return false;
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
      return true;
    } catch (e) {
      fail(e);
      return false;
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
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const saveActivities = async (forceSave = false) => {
    if (savingActivities) return;
    setSavingActivities(true);
    setConflictPending(false);
    try {
      const res = await auth("PUT", `/api/projects/${projectId}/activities`, {
        activities: activities.filter((a) => a.title.trim()),
        knownMaxUpdatedAt,
        forceSave,
      });
      const d = await res.json();
      if (res.status === 409 && d.conflict) {
        setConflictPending(true);
        fail(d.error);
        return;
      }
      if (!res.ok) throw new Error(d.error);
      notify(`${d.count || 0} activities saved. ${d.notified || 0} staff response request${d.notified === 1 ? "" : "s"} sent.`);
      if (activitiesDraftKey) window.localStorage.removeItem(activitiesDraftKey);
      setActivitiesDraftAvailable(null);
      setActivitiesDraftRestored(false);
      await load();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setSavingActivities(false);
    }
  };

  const stageChecks = {
    details: Boolean(
      project?.name?.trim() &&
      project?.client_name?.trim() &&
      project?.scope_of_works?.trim() &&
      project?.project_lead_user_id &&
      Number(project?.budget_hours) > 0 &&
      Number(project?.budget_dollars) > 0,
    ),
    team: allocations.some((allocation) => allocation.staffUserId && Number(allocation.allocatedHours) > 0),
    deliverables: deliverables.length > 0,
    activities: activities.some((activity) => activity.title?.trim() && activity.staffUserId && Number(activity.budgetHours) > 0 && (activity.startDate || activity.dueDate)),
    schedule: schedule.some((item) => item.title?.trim() && (item.startDate || item.endDate)),
    review: project?.activities_approval_status === "approved",
  };

  const stageIndex = PROJECT_SETUP_STAGES.findIndex((stage) => stage.key === activeStage);
  const currentStage = PROJECT_SETUP_STAGES[stageIndex] || PROJECT_SETUP_STAGES[0];
  const nextStage = PROJECT_SETUP_STAGES[stageIndex + 1] || null;
  const setupReadyForReview = ["details", "team", "deliverables", "activities", "schedule"].every((key) => stageChecks[key]);

  const saveStage = async (advance = false) => {
    setStageSaving(true);
    try {
      const validationMessages = {
        details: "Complete the project name, client, scope, project lead, approved hours and approved budget before continuing.",
        team: "Allocate at least one team member with approved hours before continuing.",
        deliverables: "Add at least one deliverable before continuing.",
        activities: "Add at least one assigned activity with budgeted hours and a start or due date before continuing.",
        schedule: "Add at least one dated schedule item before continuing.",
      };
      if (advance && validationMessages[activeStage] && !stageChecks[activeStage]) {
        fail(validationMessages[activeStage]);
        return;
      }
      let saved = true;
      if (activeStage === "details") saved = await saveDetails();
      if (activeStage === "team") saved = await saveAllocations();
      if (activeStage === "activities") saved = await saveActivities(conflictPending);
      if (activeStage === "schedule") saved = await saveSchedule();
      if (advance && saved && nextStage) goToStage(nextStage.key);
      if (!advance && saved && ["deliverables", "review"].includes(activeStage)) notify("Project setup progress saved.");
    } finally {
      setStageSaving(false);
    }
  };

  const runApprovalGate = async (action, reason = "") => {
    setGateBusy(true);
    try {
      const res = await auth("POST", `/api/projects/${projectId}/activities/approval`, { action, reason });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setProject((current) => ({
        ...current,
        activities_approval_status: d.project.activities_approval_status,
        ...(["approve", "administrator_override"].includes(action) ? { status: "active" } : {}),
      }));
      if (action === "request_review") notify("Setup submitted for Senior Ecologist review.");
      else if (["approve", "administrator_override"].includes(action)) {
        const method = action === "administrator_override" ? "Administrator override recorded" : "Senior Ecologist approval recorded";
        const base = `${method} — project activated, ${d.notified || 0} staff notification${d.notified === 1 ? "" : "s"} sent and the tracker enabled.`;
        if (d.tracker_warning) fail(`${base} Tracker warning: ${d.tracker_warning}`);
        else notify(base);
      } else notify("Project returned to draft setup.");
    } catch (e) {
      fail(e);
    } finally {
      setGateBusy(false);
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
          style={{ color: "#12211a", fontWeight: 700, fontSize: 24, fontFamily: "'Newsreader', Georgia, serif" }}
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        {onOpenCloseOut && project.activities_approval_status === "approved" ? (
          <button className="aps-secondary" onClick={() => onOpenCloseOut(projectId, project.name)} title="Open Project Close-out for this project">
            <ClipboardCheck size={14} /> Project Close-out →
          </button>
        ) : null}
        <button
          className="aps-delete-project"
          onClick={deleteProject}
          title="Delete only empty project records"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>

      <div className="aps-stage-shell" ref={stageTopRef}>
        <nav className="aps-stage-nav" aria-label="Project lifecycle setup">
          {PROJECT_SETUP_STAGES.map((stage, index) => (
            <button
              type="button"
              key={stage.key}
              className={`aps-stage-tab ${activeStage === stage.key ? "active" : ""} ${stageChecks[stage.key] ? "complete" : ""}`}
              onClick={() => goToStage(stage.key)}
            >
              <span>{stageChecks[stage.key] ? <CheckCircle2 size={15} /> : index + 1}</span>
              <div><strong>{stage.label}</strong><small>{stageChecks[stage.key] ? "Complete" : "In progress"}</small></div>
            </button>
          ))}
        </nav>
        <div className="aps-stage-heading">
          <div><span>Stage {stageIndex + 1} of {PROJECT_SETUP_STAGES.length}</span><h2>{currentStage.label}</h2><p>{currentStage.help}</p></div>
          <strong>{stageChecks[activeStage] ? "Ready to continue" : "Complete required items"}</strong>
        </div>
      </div>

      {activeStage === "details" ? <section className="aps-card aps-stage-panel" id="aps-section-details">
        <h2>Project initiation &amp; PMP baseline</h2>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <select
              value={project.project_lead_user_id || ""}
              onChange={(e) =>
                setProject({ ...project, project_lead_user_id: e.target.value || null })
              }
            >
              <option value="">Select Project Lead</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>{person.name || person.email}</option>
              ))}
            </select>
            <select
              value={project.overseeing_senior_ecologist_user_id || ""}
              onChange={(e) =>
                setProject({ ...project, overseeing_senior_ecologist_user_id: e.target.value || null })
              }
            >
              <option value="">Select Overseeing Senior Ecologist</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>{person.name || person.email}</option>
              ))}
            </select>
          </div>
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
      </section> : null}

      {/* Allocations */}
      {activeStage === "team" ? <section className="aps-card aps-stage-panel" id="aps-section-team">
        <div className="aps-card-head">
          <h2>
            <Users size={16} /> Staff allocations
          </h2>
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
      </section> : null}

      {/* Activities */}
      {activeStage === "deliverables" ? <section className="aps-card aps-stage-panel" id="aps-section-deliverables">
        <div className="aps-card-head">
          <h2>
            <ClipboardList size={16} /> Deliverables
          </h2>
        </div>
        <p className="aps-note">
          What you're actually producing for this project. Pick a deliverable
          type below and its standard activity checklist generates
          automatically — you then just allocate staff, budget and dates in
          Work Activities.
        </p>
        {deliverableTemplates.length ? (
          <div className="aps-quick-add" style={{ background: "#0f2a1a", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ color: "#fffdf8", fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Quick Add from Deliverable</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={quickAddTemplateId} onChange={(e) => setQuickAddTemplateId(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">Select a deliverable…</option>
                {deliverableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({wbsForDeliverable(t.code, t.standard_activities || []).length} activities)</option>)}
              </select>
              <input
                type="text"
                placeholder="Deliverable title (optional)"
                value={quickAddTitle}
                onChange={(e) => setQuickAddTitle(e.target.value)}
                style={{ minWidth: 200 }}
              />
              <button type="button" className="aps-secondary" onClick={quickAddFromTemplate} disabled={quickAddBusy || !quickAddTemplateId}>
                <ClipboardList size={13} /> {quickAddBusy ? "Generating…" : "Generate activities"}
              </button>
            </div>
          </div>
        ) : null}
        {deliverables.length ? (
          <div className="aps-deliverables-list">
            {deliverables.map((d) => {
              const linkedCount = activities.filter((a) => a.deliverableId === d.id).length;
              return (
                <div key={d.id} className="aps-deliverable-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 8, background: "#0f2a1a", marginBottom: 8 }}>
                  <div>
                    <strong style={{ color: "#fffdf8" }}>{d.title}</strong>
                    <div style={{ color: "#9db894", fontSize: 11.5 }}>{d.deliverable_type === "from_quote" ? "From quote" : (d.deliverable_type || "Custom")} · {linkedCount} activit{linkedCount === 1 ? "y" : "ies"}{d.due_date ? ` · Due ${d.due_date}` : ""}</div>
                  </div>
                  <span style={{ color: "#cfe0c8", fontSize: 11, textTransform: "uppercase", letterSpacing: ".03em" }}>{(d.status || "not_started").replaceAll("_", " ")}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="aps-note">No deliverables added yet. Choose a template above to define the project outputs and generate their standard work activities.</p>
        )}
      </section> : null}

      {activeStage === "activities" ? <section className="aps-card aps-stage-panel" id="aps-section-activities">
        {activitiesDraftAvailable && !activitiesDraftRestored ? (
          <div style={{ background: "#fbf6e6", border: "1px solid #ece0bc", borderLeft: "3px solid #c9962a", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12.5 }}>
            <strong>Unsaved activities found from a previous session.</strong> Restoring will replace what's currently shown below with your unsaved draft — review carefully if someone else may have edited this project since.
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button type="button" className="aps-secondary" onClick={() => { setActivities(activitiesDraftAvailable); setActivitiesDraftRestored(true); }}>Restore draft</button>
              <button type="button" className="aps-secondary" onClick={() => { if (activitiesDraftKey) window.localStorage.removeItem(activitiesDraftKey); setActivitiesDraftAvailable(null); }}>Discard draft</button>
            </div>
          </div>
        ) : null}
        <div className="aps-card-head">
          <h2>
            <ClipboardList size={16} /> Work activities
          </h2>
        </div>
        <p className="aps-note">
          Assign each activity to an allocated staff member and set its approved
          hours and delivery dates. This remains a draft until Senior Ecologist
          approval is recorded in the final stage.
        </p>
        {activities.map((row, i) => (
          <div
            key={i}
            className="aps-row"
            style={{ display: "flex", alignItems: "flex-start", gap: 8, opacity: dragIndex === i ? 0.5 : 1 }}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); reorderActivities(dragIndex, i); setDragIndex(null); }}
          >
            <span style={{ cursor: "grab", color: "#8a927c", paddingTop: 10, flexShrink: 0 }} title="Drag to reorder"><GripVertical size={15} /></span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: "#6b755f", paddingTop: 11, flexShrink: 0, minWidth: 20 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
            <input
              placeholder="Activity title"
              value={row.title}
              style={{ width: "100%", boxSizing: "border-box" }}
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
            <textarea
              className="aps-activity-detail"
              rows={5}
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
            <div className="aps-three">
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
              <label className="aps-field">
                Start date
                <input
                  type="date"
                  aria-label={`Start date for ${row.title || "activity"}`}
                  value={row.startDate || ""}
                  onChange={(e) =>
                    setActivities(
                      activities.map((r, j) =>
                        j === i ? { ...r, startDate: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <label className="aps-field">
                Due date
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
              </label>
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
              <label className="aps-check"><input type="checkbox" checked={row.milestone === true} onChange={(e) => setActivities(activities.map((r, j) => j === i ? { ...r, milestone: e.target.checked } : r))} /> Milestone (shown as a diamond on the Gantt)</label>
              {row.status !== "completed" ? <button
                type="button"
                className="aps-secondary"
                onClick={async () => {
                  if (!row.id || !window.confirm(`Mark "${row.title || "this activity"}" complete? This retains the activity and its tracker history.`)) return;
                  try {
                    const res = await auth("PATCH", `/api/projects/${projectId}/activities/${row.id}`, { status: "completed" });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || "Could not complete this activity.");
                    setActivities((current) => current.map((item, index) => index === i ? { ...item, status: "completed", progressPercent: 100 } : item));
                    notify("Activity completed and linked schedule updated.");
                  } catch (e) { fail(e); }
                }}
              ><Check size={13} /> Mark complete</button> : null}
            </div>
            </div>
            <button
              className="aps-remove"
              onClick={async () => {
                if (row.id) {
                  if (!window.confirm(`Remove "${row.title || "this activity"}" from the active plan? Its unanswered assignment notification and standalone generated Gantt row will be withdrawn; retained history remains auditable.`)) return;
                  try {
                    const res = await auth("DELETE", `/api/projects/${projectId}/activities?id=${row.id}`);
                    const d = await res.json();
                    if (!res.ok) throw new Error(d.error);
                  } catch (e) {
                    fail(e);
                    return;
                  }
                }
                setActivities(activities.filter((_, j) => j !== i));
              }}
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
                startDate: "",
                milestone: false,
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
      </section> : null}

      {/* Schedule — compact until a project lead chooses to edit the full delivery plan. */}
      {activeStage === "schedule" ? <><section className="aps-card aps-schedule-card aps-stage-panel" id="aps-section-schedule">
        <div className="aps-card-head">
          <button type="button" className="aps-schedule-toggle" onClick={() => setScheduleExpanded((open) => !open)} aria-expanded={scheduleExpanded}>
            <span><Calendar size={16} /> Schedule &amp; Gantt (auto-generated from Work activities)</span>
            <small>{schedule.length} key date{schedule.length === 1 ? "" : "s"} · {scheduleExpanded ? "Hide schedule" : "View, edit or add a non-staff milestone (e.g. an invoice date)"}</small>
          </button>
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

      <ProjectGantt schedule={schedule} />
      </> : null}

      {activeStage === "review" ? (() => {
        const namedActivities = activities.filter((a) => (a.title || "").trim());
        const checks = [
          { label: "Deliverables Added", pass: deliverables.length > 0 },
          { label: "Activities Allocated", pass: namedActivities.length > 0 && namedActivities.every((a) => a.staffUserId) },
          { label: "Team Assigned", pass: allocations.some((a) => a.staffUserId) },
          { label: "Dates Assigned", pass: namedActivities.length > 0 && namedActivities.every((a) => a.dueDate || a.startDate) },
        ];
        const readiness = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);
        const totalBudget = allocations.reduce((sum, a) => sum + (Number(a.allocatedHours) || 0) * (Number(a.hourlyRate) || 0), 0);

        return (
          <section className="aps-card aps-stage-panel" id="aps-section-review">
            <div className="aps-card-head">
              <h2><ClipboardCheck size={16} /> Review &amp; Readiness</h2>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
              <div><div style={{ color: "#8a927c", fontSize: 11, textTransform: "uppercase" }}>Deliverables</div><div style={{ fontSize: 20, fontWeight: 700 }}>{deliverables.length}</div></div>
              <div><div style={{ color: "#8a927c", fontSize: 11, textTransform: "uppercase" }}>Activities</div><div style={{ fontSize: 20, fontWeight: 700 }}>{namedActivities.length}</div></div>
              <div><div style={{ color: "#8a927c", fontSize: 11, textTransform: "uppercase" }}>Team Members</div><div style={{ fontSize: 20, fontWeight: 700 }}>{allocations.filter((a) => a.staffUserId).length}</div></div>
              <div><div style={{ color: "#8a927c", fontSize: 11, textTransform: "uppercase" }}>Budget</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totalBudget ? `$${totalBudget.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : "—"}</div></div>
              <div><div style={{ color: "#8a927c", fontSize: 11, textTransform: "uppercase" }}>Readiness</div><div style={{ fontSize: 20, fontWeight: 700, color: readiness === 100 ? "#2c6a34" : "#c98a1e" }}>{readiness}%</div></div>
            </div>
            <div>
              {checks.map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", color: c.pass ? "#2c6a34" : "#a5772b" }}>
                  {c.pass ? <Check size={15} /> : <AlertCircle size={15} />} {c.label}
                </div>
              ))}
            </div>
            <p className="aps-note" style={{ marginTop: 12 }}>
              This reflects the saved project baseline. Submit it for Senior Ecologist review; staff notifications and the live tracker are enabled only after approval is recorded.
            </p>
          </section>
        );
      })() : null}

      <footer className="aps-stage-actions">
        <button
          type="button"
          className="aps-secondary"
          disabled={stageIndex === 0 || stageSaving || gateBusy}
          onClick={() => goToStage(PROJECT_SETUP_STAGES[stageIndex - 1]?.key || "details")}
        >
          <ArrowLeft size={14} /> Previous stage
        </button>
        <div className="aps-stage-actions__right">
          {activeStage !== "review" ? (
            <>
              <button type="button" className="aps-secondary" disabled={stageSaving || savingActivities} onClick={() => saveStage(false)}>
                <Save size={14} /> {stageSaving ? "Saving…" : "Save progress"}
              </button>
              <button type="button" className="aps-primary" disabled={stageSaving || savingActivities} onClick={() => saveStage(true)}>
                <CheckCircle2 size={14} /> {stageSaving ? "Saving…" : `Complete stage${nextStage ? " & continue" : ""}`}
              </button>
            </>
          ) : project.activities_approval_status === "approved" ? (
            <>
              {onOpenTracker ? <button type="button" className="aps-primary" onClick={onOpenTracker}><ClipboardList size={14} /> Open live tracker</button> : null}
              {onOpenCloseOut ? <button type="button" className="aps-secondary" onClick={() => onOpenCloseOut(project.name)}><ClipboardCheck size={14} /> Project close-out</button> : null}
            </>
          ) : project.activities_approval_status === "pending_se_review" ? (
            <>
              <button type="button" className="aps-secondary" disabled={gateBusy} onClick={() => runApprovalGate("reset")}>Return to draft</button>
              <button type="button" className="aps-primary" disabled={gateBusy} onClick={() => runApprovalGate("approve")}>
                <CheckCircle2 size={14} /> {gateBusy ? "Activating…" : "Record approval & activate"}
              </button>
              <button
                type="button"
                className="aps-secondary"
                disabled={gateBusy}
                onClick={() => {
                  const reason = window.prompt("Administrator override reason (recorded in the project approval audit trail):");
                  if (reason !== null) runApprovalGate("administrator_override", reason);
                }}
              >
                Administrator override
              </button>
            </>
          ) : (
            <>
              <button type="button" className="aps-primary" disabled={gateBusy || !setupReadyForReview} onClick={() => runApprovalGate("request_review")}>
                <ClipboardCheck size={14} /> {gateBusy ? "Submitting…" : "Submit for Senior Ecologist review"}
              </button>
              <button
                type="button"
                className="aps-secondary"
                disabled={gateBusy || !setupReadyForReview}
                onClick={() => {
                  const reason = window.prompt("Administrator override reason (recorded in the project approval audit trail):");
                  if (reason !== null) runApprovalGate("administrator_override", reason);
                }}
              >
                Administrator override
              </button>
            </>
          )}
        </div>
      </footer>

    </div>
  );
}
