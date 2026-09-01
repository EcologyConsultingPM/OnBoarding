"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CirclePause,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  Loader2,
  Lock,
  Plus,
  Settings2,
  Trash2,
  Unlock,
  Users2,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const READINESS_ITEMS = [
  {
    key: "resourcesReady",
    label: "Resources ready",
    description:
      "Project scope, maps and field material are ready for the allocated team.",
  },
  {
    key: "trainingChecked",
    label: "Training checked",
    description: "Role and project-specific training has been considered.",
  },
  {
    key: "formsConfigured",
    label: "Forms configured",
    description:
      "Relevant project forms have been identified for this project type.",
  },
  {
    key: "whsChecked",
    label: "WHS checked",
    description: "Required WHS arrangements and controls have been considered.",
  },
];

function jsonFromResponse(response) {
  return response.json().catch(() => ({}));
}
function formatCurrency(dollars) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(dollars || 0));
}
function readinessValue(project) {
  const checks = READINESS_ITEMS.filter((item) =>
    Boolean(project?.settings?.[item.key]),
  ).length;
  const visibility = project?.settings?.trackerVisible ? 1 : 0;
  return Math.round(
    ((checks + visibility) / (READINESS_ITEMS.length + 1)) * 100,
  );
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
const TRACKER_CATEGORY_MAP = {
  "desktop field plan": "Desktop / field plan",
  "desktop field plan work": "Desktop / field plan",
  preparation: "Preparation",
  "fieldwork travel": "Fieldwork & travel",
  "fieldwork and travel": "Fieldwork & travel",
  "data management": "Data management",
  reporting: "Reporting",
  "gis mapping": "GIS / mapping",
  "qa review": "QA review",
  "client consultation": "Client consultation",
  "general project management": "General project management",
  other: "Other",
};

function normaliseTrackerCategory(value) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return TRACKER_CATEGORY_MAP[key] || "";
}

function blankTemplate() {
  return {
    templateName: "Project Tracker",
    instructions:
      "Record your project activity accurately and highlight issues that require project-lead review.",
    categories: [],
    coreColumns: [],
    customColumns: [],
    guidanceRows: [],
    locked: false,
  };
}

export default function ProjectTrackerSetup({ onToast }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState(null);
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setupReady, setSetupReady] = useState(false);
  const [templateReady, setTemplateReady] = useState(false);
  const [quoteImport, setQuoteImport] = useState(null);
  const [importingQuote, setImportingQuote] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    clientName: "",
    description: "",
    startDate: "",
    endDate: "",
    budgetHours: "",
    budgetDollars: "",
    defaultHourlyRate: "",
    status: "active",
  });

  const accessToken = session?.access_token || "";
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) || null,
    [projects, selectedId],
  );
  const readiness = readinessValue({ settings });
  const activeProject =
    String(selectedProject?.status || "").toLowerCase() === "active";
  const teamCount = Number(selectedProject?.teamCount || 0);
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    }),
    [accessToken],
  );

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-setup", {
        headers: headers(),
        cache: "no-store",
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(data.error || "Could not load project tracker setup.");
      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);
      setSetupReady(Boolean(data.setupReady));
      setSelectedId((current) => current || nextProjects[0]?.id || "");
    } catch (loadError) {
      setError(loadError.message || "Could not load project tracker setup.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, headers]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setSettings(stateFor(selectedProject));
  }, [selectedProject]);
  useEffect(() => {
    if (!accessToken || !selectedId) return;
    let active = true;
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/project-tracker-template?projectId=${encodeURIComponent(selectedId)}`,
          { headers: headers(), cache: "no-store" },
        );
        const data = await jsonFromResponse(response);
        if (!response.ok) {
          if (response.status === 409) {
            if (active) {
              setTemplate(blankTemplate());
              setTemplateReady(false);
            }
            return;
          }
          throw new Error(data.error || "Could not load the tracker template.");
        }
        if (active) {
          setTemplate(data.template || blankTemplate());
          setTemplateReady(Boolean(data.templateReady));
        }
      } catch (templateError) {
        if (active) {
          setTemplate(blankTemplate());
          setTemplateReady(false);
          setError(
            templateError.message || "Could not load the tracker template.",
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [accessToken, headers, selectedId]);

  const toggle = (key) => {
    if (!setupReady || saving) return;
    setSettings((current) => ({ ...current, [key]: !current?.[key] }));
  };
  const save = async () => {
    if (!selectedProject || !settings || !setupReady) return;
    if (settings.trackerVisible && !activeProject) {
      onToast?.(
        "Set the project status to Active before enabling its staff tracker.",
      );
      return;
    }
    if (settings.trackerVisible && teamCount === 0) {
      onToast?.(
        "Allocate at least one active team member before enabling the staff tracker.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-setup", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ projectId: selectedProject.id, ...settings }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(data.error || "Could not save tracker settings.");
      setProjects((current) =>
        current.map((project) =>
          project.id === selectedProject.id
            ? { ...project, settings: data.settings }
            : project,
        ),
      );
      setSettings(data.settings);
      onToast?.(
        data.settings.trackerVisible
          ? "Tracker visibility saved for the allocated project team"
          : "Project Tracker is paused for staff",
      );
    } catch (saveError) {
      setError(saveError.message || "Could not save tracker settings.");
    } finally {
      setSaving(false);
    }
  };
  const activateStaffTimesheets = async () => {
    if (!selectedProject || !setupReady) return;
    if (!activeProject || teamCount === 0) {
      setError(!activeProject ? "Set this project to Active in Setup & Allocations before enabling staff timesheets." : "Allocate at least one active staff member before enabling staff timesheets.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-setup", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "activate_staff_timesheets", projectId: selectedProject.id }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not enable staff timesheets.");
      setSettings(data.settings);
      setProjects((current) => current.map((project) => project.id === selectedProject.id ? { ...project, settings: data.settings } : project));
      setTemplate((current) => current ? { ...current, locked: true, categories: current.categories?.length ? current.categories : ["Desktop / field plan", "Preparation", "Fieldwork & travel", "Data management", "Reporting", "GIS / mapping", "QA review", "Client consultation", "General project management", "Other"] } : blankTemplate());
      await load();
      onToast?.("Staff Project Tracker enabled. Allocated staff can now enter project timesheet records.");
    } catch (activationError) {
      setError(activationError.message || "Could not enable staff timesheets.");
    } finally {
      setSaving(false);
    }
  };
  const createFirstProject = async () => {
    if (!newProject.name.trim()) {
      setError("Enter a project name before creating its tracker.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(newProject),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(data.error || "Could not create the project.");
      setNewProject({
        name: "",
        clientName: "",
        description: "",
        startDate: "",
        endDate: "",
        budgetHours: "",
        budgetDollars: "",
        defaultHourlyRate: "",
        status: "active",
      });
      await load();
      if (data.project?.id) setSelectedId(data.project.id);
      onToast?.(
        "Project created. Continue with the tracker template and allocations below.",
      );
    } catch (createError) {
      setError(createError.message || "Could not create the project.");
    } finally {
      setSaving(false);
    }
  };
  const importQuoteTracker = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError("Choose an Excel quote tracker file (.xlsx or .xls).");
      return;
    }
    setImportingQuote(true);
    setError("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetByName = (name) => workbook.SheetNames.find((sheet) => sheet.toLowerCase() === name.toLowerCase());
      const dataSheet = workbook.Sheets[sheetByName("Data") || workbook.SheetNames[0]];
      const dataRows = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: "" });
      const headerIndex = dataRows.findIndex((row) => row.some((cell) => String(cell).trim().toLowerCase() === "task"));
      const taskColumn = headerIndex >= 0 ? dataRows[headerIndex].findIndex((cell) => String(cell).trim().toLowerCase() === "task") : -1;
      const categories = [...new Set((headerIndex >= 0 && taskColumn >= 0 ? dataRows.slice(headerIndex + 1).map((row) => normaliseTrackerCategory(row[taskColumn])) : []).filter(Boolean))];

      const ffaSheet = workbook.Sheets[sheetByName("FFA") || workbook.SheetNames.find((sheet) => /tracker|scope|deliver/i.test(sheet))];
      const ffaRows = ffaSheet ? XLSX.utils.sheet_to_json(ffaSheet, { header: 1, defval: "" }) : [];
      const deliveryHeader = ffaRows.findIndex((row) => row.some((cell) => /section\s*\/\s*heading/i.test(String(cell))));
      const guidanceRows = deliveryHeader >= 0 ? ffaRows.slice(deliveryHeader + 1).map((row) => {
        const section = String(row[0] || "").trim();
        const subheading = String(row[1] || "").trim();
        const task = String(row[2] || "").trim();
        const prompts = String(row[3] || "").trim();
        const references = String(row[4] || "").trim();
        const assigned = String(row[5] || "").trim();
        const hours = String(row[6] || "").trim();
        const label = task || subheading || section;
        if (!label) return null;
        const details = [section && `Section: ${section}`, subheading && `Subheading: ${subheading}`, prompts && `Delivery prompt: ${prompts}`, references && `Reference: ${references}`, assigned && `Quoted allocation: ${assigned}`, hours && `Quoted hours: ${hours}`].filter(Boolean).join(" · ");
        return { label: label.slice(0, 120), information: details.slice(0, 1000) };
      }).filter(Boolean).slice(0, 30) : [];

      if (!categories.length && !guidanceRows.length) throw new Error("This workbook does not contain a recognisable Task category list or quoted delivery table.");
      const current = template || blankTemplate();
      setTemplate({
        ...current,
        categories: categories.length ? categories : current.categories,
        guidanceRows: guidanceRows.length ? guidanceRows : current.guidanceRows,
      });
      setQuoteImport({ fileName: file.name, categories: categories.length, deliveryRows: guidanceRows.length });
      onToast?.("Quote tracker baseline imported for review. Save the template to apply it to this project.");
    } catch (importError) {
      setError(importError.message || "Could not read this quote tracker workbook.");
    } finally {
      setImportingQuote(false);
    }
  };
  const updateTemplate = (patch) =>
    setTemplate((current) => ({ ...(current || blankTemplate()), ...patch }));
  const saveTemplate = async () => {
    if (!selectedProject || !template || !templateReady || template.locked)
      return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-template", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ projectId: selectedProject.id, ...template }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(data.error || "Could not save the tracker template.");
      setTemplate(data.template);
      onToast?.("Project Tracker template saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save the tracker template.");
    } finally {
      setSaving(false);
    }
  };
  const lockTemplate = async (action) => {
    if (!selectedProject || !template || !templateReady) return;
    const label =
      action === "lock"
        ? "Lock this template for staff entry? Administrators must unlock it before editing categories, columns, rows or instructions."
        : "Unlock this tracker template for editing?";
    if (!window.confirm(label)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-template", {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ projectId: selectedProject.id, action }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(data.error || "Could not update the template lock.");
      setTemplate(data.template);
      onToast?.(
        action === "lock"
          ? "Template locked and ready for staff entry."
          : "Template unlocked for editing.",
      );
    } catch (lockError) {
      setError(lockError.message || "Could not update the template lock.");
    } finally {
      setSaving(false);
    }
  };
  const templateDisabled =
    !templateReady || !template || template.locked || saving;

  return (
    <div className="pts">
      <header className="pts-hero">
        <div>
          <span>Projects &amp; Operations · Controlled readiness</span>
          <h1>Set up a project tracker</h1>
          <p>
            Confirm project readiness, configure the staff entry template, then
            lock it before enabling staff tracker visibility.
          </p>
        </div>
        <div className="pts-hero-mark">
          <Settings2 size={27} />
        </div>
      </header>
      {!loading && !setupReady && !error && (
        <div className="pts-notice">
          <AlertCircle size={17} />
          <span>
            Project Tracker settings are prepared for review. They become
            editable once the separate configuration migration is approved and
            applied.
          </span>
        </div>
      )}
      {error && (
        <div className="pts-notice error">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}
      {loading ? (
        <div className="pts-loading">
          <Loader2 size={18} className="spin" /> Loading project tracker
          controls…
        </div>
      ) : projects.length === 0 ? (
        <section className="pts-empty pts-create-project">
          <div>
            <FolderPlus size={21} />
            <strong>Create your first project tracker</strong>
            <span>
              Enter the project baseline below. Once created, configure
              commercial sources, allocations, the team and the locked
              staff-entry template in this workspace.
            </span>
          </div>
          <div className="pts-create-grid">
            <label>
              Project name
              <input
                value={newProject.name}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Wattle Creek Biodiversity Assessment"
              />
            </label>
            <label>
              Client
              <input
                value={newProject.clientName}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    clientName: event.target.value,
                  }))
                }
                placeholder="Client organisation"
              />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={newProject.startDate}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Target completion
              <input
                type="date"
                value={newProject.endDate}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Original budget (AUD)
              <input
                inputMode="decimal"
                value={newProject.budgetDollars}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    budgetDollars: event.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </label>
            <label>
              Budget hours
              <input
                inputMode="decimal"
                value={newProject.budgetHours}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    budgetHours: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </label>
            <label>
              Default hourly rate (AUD)
              <input
                inputMode="decimal"
                value={newProject.defaultHourlyRate}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    defaultHourlyRate: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </label>
            <label>
              Status
              <select
                value={newProject.status}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="planning">Planning</option>
              </select>
            </label>
            <label className="wide">
              Project summary
              <textarea
                rows={3}
                value={newProject.description}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Scope, location or delivery context"
              />
            </label>
          </div>
          <button
            type="button"
            className="pts-save"
            disabled={saving}
            onClick={createFirstProject}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="spin" /> Creating project…
              </>
            ) : (
              <>
                <FolderPlus size={16} /> Create project and open tracker
                template
              </>
            )}
          </button>
        </section>
      ) : (
        <div className="pts-layout">
          <aside className="pts-project-list" aria-label="Projects">
            <div className="pts-list-head">
              <span>Projects</span>
              <b>{projects.length}</b>
            </div>
            {projects.map((project) => {
              const ready = readinessValue(project);
              const active = project.id === selectedId;
              return (
                <button
                  type="button"
                  key={project.id}
                  className={`pts-project ${active ? "selected" : ""}`}
                  onClick={() => setSelectedId(project.id)}
                >
                  <span
                    className={`pts-status ${String(project.status || "").toLowerCase()}`}
                  >
                    {project.status || "Draft"}
                  </span>
                  <strong>{project.name}</strong>
                  <small>{project.clientName || "Client not recorded"}</small>
                  <span className="pts-project-foot">
                    <em>{ready}% ready</em>
                    <span>{project.teamCount || 0} team</span>
                  </span>
                </button>
              );
            })}
          </aside>
          {selectedProject && settings && (
            <section className="pts-detail">
              <div className="pts-project-heading">
                <div>
                  <span className="pts-kicker">Selected project</span>
                  <h2>{selectedProject.name}</h2>
                  <p>
                    {selectedProject.clientName || "Client not recorded"} ·{" "}
                    {selectedProject.status || "Draft"} · {teamCount} allocated{" "}
                    {teamCount === 1 ? "person" : "people"}
                  </p>
                </div>
                <div className="pts-score">
                  <strong>{readiness}%</strong>
                  <span>Ready</span>
                </div>
              </div>
              <div className="pts-summary-grid">
                <div>
                  <span>Budget hours</span>
                  <strong>
                    {Number(selectedProject.budgetHours || 0).toLocaleString(
                      "en-AU",
                      { maximumFractionDigits: 1 },
                    )}
                  </strong>
                </div>
                <div>
                  <span>Project budget</span>
                  <strong>
                    {formatCurrency(selectedProject.budgetDollars)}
                  </strong>
                </div>
                <div>
                  <span>Team allocation</span>
                  <strong>{teamCount}</strong>
                </div>
                <div>
                  <span>Staff tracker</span>
                  <strong
                    className={settings.trackerVisible ? "good" : "muted"}
                  >
                    {settings.trackerVisible ? "Enabled" : "Not enabled"}
                  </strong>
                </div>
              </div>
              <div className="pts-readiness">
                <div className="pts-section-head">
                  <div>
                    <span className="pts-kicker">Readiness checks</span>
                    <h3>Prepare the project before staff visibility</h3>
                  </div>
                  <span className="pts-rule">
                    Active project + allocated team required
                  </span>
                </div>
                {READINESS_ITEMS.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={`pts-check ${settings[item.key] ? "checked" : ""}`}
                    onClick={() => toggle(item.key)}
                    disabled={!setupReady || saving}
                    aria-pressed={settings[item.key]}
                  >
                    <span className="pts-check-icon">
                      {settings[item.key] ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <span />
                      )}
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="pts-quickstart">
                <div>
                  <span className="pts-kicker">Recommended staff entry path</span>
                  <h3>Enable staff timesheets</h3>
                  <p>For an active project with an allocated team, this prepares any missing baseline budget record, locks the staff tracker template and makes Project Tracker available immediately to the project team.</p>
                </div>
                <button type="button" className="pts-save" onClick={activateStaffTimesheets} disabled={!setupReady || saving || !activeProject || teamCount === 0 || settings.trackerVisible}>
                  <Users2 size={16} /> {settings.trackerVisible ? "Staff timesheets enabled" : "Enable staff timesheets"}
                </button>
              </div>
              <div
                className={`pts-activation ${settings.trackerVisible ? "active" : ""}`}
              >
                <span className="pts-activation-icon">
                  {settings.trackerVisible ? (
                    <Eye size={19} />
                  ) : (
                    <EyeOff size={19} />
                  )}
                </span>
                <span>
                  <strong>
                    {settings.trackerVisible
                      ? "Project Tracker is enabled for allocated staff"
                      : "Project Tracker is not visible to staff"}
                  </strong>
                  <small>
                    Advanced controls remain available below. Use the recommended action above to prepare a standard locked template and staff-visible timesheet baseline in one step.
                  </small>
                </span>
                <button
                  type="button"
                  className="pts-toggle"
                  onClick={() => toggle("trackerVisible")}
                  disabled={!setupReady || saving}
                  aria-pressed={settings.trackerVisible}
                >
                  <span />
                </button>
              </div>
              {settings.trackerVisible &&
                (!activeProject || teamCount === 0) && (
                  <div className="pts-notice warning">
                    <CirclePause size={17} />
                    <span>
                      {!activeProject
                        ? "Set this project to Active in Setup & Allocations before staff tracker visibility can be enabled."
                        : "Allocate at least one staff member before staff tracker visibility can be enabled."}
                    </span>
                  </div>
                )}
              <button
                type="button"
                className="pts-save"
                onClick={save}
                disabled={!setupReady || saving || !selectedProject}
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="spin" /> Saving settings…
                  </>
                ) : (
                  <>
                    <Users2 size={16} /> Save Project Tracker Setup
                  </>
                )}
              </button>
              <section className="pts-template">
                <div className="pts-section-head">
                  <div>
                    <span className="pts-kicker">Staff entry template</span>
                    <h3>
                      <FileText size={16} /> Activity entry fields, categories
                      and guidance
                    </h3>
                    <p>
                      These instructions and fields are shown to allocated
                      staff. Core entry fields cannot be removed.
                    </p>
                    {!template?.locked ? <div className="pts-quote-import">
                      <label>
                        <strong>Import quoted project baseline</strong>
                        <span>Upload the approved Excel quote tracker. Its task categories are mapped to the same Work Activities categories, and quoted delivery rows are loaded as reviewable tracker guidance.</span>
                        <input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={templateDisabled || importingQuote} onChange={importQuoteTracker} />
                      </label>
                      {quoteImport ? <small><CheckCircle2 size={13} /> {quoteImport.fileName}: {quoteImport.categories} shared categories and {quoteImport.deliveryRows} quoted delivery rows loaded. Save this template to apply the baseline.</small> : null}
                    </div> : null}
                  </div>
                  <span
                    className={`pts-template-state ${template?.locked ? "locked" : "draft"}`}
                  >
                    {template?.locked ? (
                      <>
                        <Lock size={13} /> Locked
                      </>
                    ) : (
                      <>
                        <Unlock size={13} /> Draft
                      </>
                    )}
                  </span>
                </div>
                {!templateReady ? (
                  <div className="pts-template-notice">
                    <AlertCircle size={15} /> Template editing becomes available
                    after the additive Project Tracker migration is approved and
                    applied.
                  </div>
                ) : template ? (
                  <>
                    <div className="pts-template-fields">
                      <label>
                        Template name
                        <input
                          value={template.templateName || ""}
                          disabled={templateDisabled}
                          onChange={(event) =>
                            updateTemplate({ templateName: event.target.value })
                          }
                        />
                      </label>
                      <label className="wide">
                        Staff instructions
                        <textarea
                          rows={3}
                          value={template.instructions || ""}
                          disabled={templateDisabled}
                          onChange={(event) =>
                            updateTemplate({ instructions: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <TemplateCategories
                      template={template}
                      updateTemplate={updateTemplate}
                      disabled={templateDisabled}
                    />
                    <TemplateColumns
                      template={template}
                      updateTemplate={updateTemplate}
                      disabled={templateDisabled}
                    />
                    <TemplateRows
                      template={template}
                      updateTemplate={updateTemplate}
                      disabled={templateDisabled}
                    />
                    <div className="pts-template-actions">
                      {template.locked ? (
                        <button
                          type="button"
                          className="pts-template-unlock"
                          disabled={saving}
                          onClick={() => lockTemplate("unlock")}
                        >
                          <Unlock size={14} /> Unlock template
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="pts-template-save"
                            disabled={templateDisabled}
                            onClick={saveTemplate}
                          >
                            {saving ? (
                              <Loader2 size={14} className="spin" />
                            ) : (
                              <FileText size={14} />
                            )}{" "}
                            Save template draft
                          </button>
                          <button
                            type="button"
                            className="pts-template-lock"
                            disabled={saving}
                            onClick={() => lockTemplate("lock")}
                          >
                            <Lock size={14} /> Lock for staff entry
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </section>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateCategories({ template, updateTemplate, disabled }) {
  const categories = template.categories || [];
  const change = (index, value) =>
    updateTemplate({
      categories: categories.map((item, current) =>
        current === index ? value : item,
      ),
    });
  return (
    <section className="pts-template-block">
      <div>
        <strong>Activity category dropdown</strong>
        <span>Staff choose from these administrator-controlled options.</span>
      </div>
      <div className="pts-token-list">
        {categories.map((category, index) => (
          <label key={`${category}-${index}`}>
            <input
              value={category}
              disabled={disabled}
              onChange={(event) => change(index, event.target.value)}
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${category}`}
              onClick={() =>
                updateTemplate({
                  categories: categories.filter(
                    (_, current) => current !== index,
                  ),
                })
              }
            >
              <Trash2 size={12} />
            </button>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="pts-add-inline"
        disabled={disabled}
        onClick={() =>
          updateTemplate({ categories: [...categories, "New category"] })
        }
      >
        <Plus size={13} /> Add category
      </button>
    </section>
  );
}
function TemplateColumns({ template, updateTemplate, disabled }) {
  const columns = template.customColumns || [];
  const change = (index, patch) =>
    updateTemplate({
      customColumns: columns.map((column, current) =>
        current === index ? { ...column, ...patch } : column,
      ),
    });
  return (
    <section className="pts-template-block">
      <div>
        <strong>Tracker columns</strong>
        <span>
          Core fields remain locked. Add custom columns for project-specific
          detail.
        </span>
      </div>
      <div className="pts-core-columns">
        {(template.coreColumns || []).map((column) => (
          <span key={column.key}>
            <Lock size={11} /> {column.label}
          </span>
        ))}
      </div>
      {columns.map((column, index) => (
        <div
          className="pts-custom-column"
          key={`${column.key || "new"}-${index}`}
        >
          <input
            value={column.label || ""}
            disabled={disabled}
            onChange={(event) => change(index, { label: event.target.value })}
            placeholder="Column label"
          />
          <select
            value={column.type || "text"}
            disabled={disabled}
            onChange={(event) => change(index, { type: event.target.value })}
          >
            <option value="text">Text</option>
            <option value="textarea">Long text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Dropdown</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={column.required === true}
              disabled={disabled}
              onChange={(event) =>
                change(index, { required: event.target.checked })
              }
            />{" "}
            Required
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              updateTemplate({
                customColumns: columns.filter(
                  (_, current) => current !== index,
                ),
              })
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="pts-add-inline"
        disabled={disabled}
        onClick={() =>
          updateTemplate({
            customColumns: [
              ...columns,
              {
                key: `custom_${columns.length + 1}`,
                label: "",
                type: "text",
                required: false,
                options: [],
              },
            ],
          })
        }
      >
        <Plus size={13} /> Add column
      </button>
    </section>
  );
}
function TemplateRows({ template, updateTemplate, disabled }) {
  const rows = template.guidanceRows || [];
  const change = (index, patch) =>
    updateTemplate({
      guidanceRows: rows.map((row, current) =>
        current === index ? { ...row, ...patch } : row,
      ),
    });
  return (
    <section className="pts-template-block">
      <div>
        <strong>Template rows and information</strong>
        <span>
          Add controlled prompts, notes or review instructions that staff need
          for this project.
        </span>
      </div>
      {rows.map((row, index) => (
        <div className="pts-guidance-row" key={index}>
          <input
            value={row.label || ""}
            disabled={disabled}
            onChange={(event) => change(index, { label: event.target.value })}
            placeholder="Row heading"
          />
          <textarea
            rows={2}
            value={row.information || ""}
            disabled={disabled}
            onChange={(event) =>
              change(index, { information: event.target.value })
            }
            placeholder="Instruction or information"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              updateTemplate({
                guidanceRows: rows.filter((_, current) => current !== index),
              })
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="pts-add-inline"
        disabled={disabled}
        onClick={() =>
          updateTemplate({
            guidanceRows: [...rows, { label: "", information: "" }],
          })
        }
      >
        <Plus size={13} /> Add row
      </button>
    </section>
  );
}
