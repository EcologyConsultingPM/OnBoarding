"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FolderCog,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import ProjectTrackerExport from "./ProjectTrackerExport";

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}
function hours(value) {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(Number(value))} hrs`;
}
function number(value) {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(
    Number(value || 0),
  );
}
function percent(value, total) {
  if (!Number(total)) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((Number(value || 0) / Number(total || 1)) * 100)),
  );
}
function emptySource(project) {
  return {
    id: "",
    sourceCode: "",
    sourceName: "",
    sourceType: "variation",
    approvedValue: "",
    approvedHours: "",
    approvalStatus: "approved",
    variationReason: "",
    effectiveDate: new Date().toISOString().slice(0, 10),
    projectId: project?.id || "",
  };
}
function emptyAllocation(source) {
  return {
    id: "",
    sourceId: source?.id || "",
    allocationCode: "",
    allocationName: "",
    allocationValue: "",
    allocationHours: "",
    hoursConsumed: "",
    chargeOutSpend: "",
    internalCost: "",
    thresholdPercent: "80",
    status: "active",
    staffVisible: true,
  };
}

export default function AdminProjectTracker({
  onToast,
  onOpenProjectSetup,
  initialProjectId = "",
}) {
  const { session } = useAuth();
  const [detailView, setDetailView] = useState("overview");
  const [projects, setProjects] = useState([]);
  const [financialReady, setFinancialReady] = useState(false);
  const [selectedId, setSelectedId] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem("ec-admin-tracker-selected-id") || ""; } catch { return ""; }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entryStaffFilter, setEntryStaffFilter] = useState("all");
  const [entryActivityFilter, setEntryActivityFilter] = useState("all");
  const [entryStatusFilter, setEntryStatusFilter] = useState("all");
  const [entryDateFrom, setEntryDateFrom] = useState("");
  const [entryDateTo, setEntryDateTo] = useState("");
  const [financialDetailsOpen, setFinancialDetailsOpen] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState("");
  const [missedEntryOpen, setMissedEntryOpen] = useState(false);
  const [missedEntryStaff, setMissedEntryStaff] = useState([]);
  const [missedEntryCategoryOptions, setMissedEntryCategoryOptions] = useState([]);
  const [missedEntryLoading, setMissedEntryLoading] = useState(false);
  const [missedEntrySaving, setMissedEntrySaving] = useState(false);
  const [missedEntryError, setMissedEntryError] = useState("");
  const [entryEditor, setEntryEditor] = useState(null);
  const [entryMutationBusy, setEntryMutationBusy] = useState("");
  const [missedEntryForm, setMissedEntryForm] = useState({
    staffUserId: "", sourceId: "", allocationId: "", activityId: "",
    workDate: "", activityCategory: "", activityInformation: "",
    hours: "", status: "completed", notableIssues: "",
  });
  const [sourceEditor, setSourceEditor] = useState(null);
  const [allocationEditor, setAllocationEditor] = useState(null);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    }),
    [session?.access_token],
  );
  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) || null,
    [projects, selectedId],
  );
  const [healthOverrideOpen, setHealthOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState("On Track");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [activityOverride, setActivityOverride] = useState(null);
  const [activityOverrideBusy, setActivityOverrideBusy] = useState(false);

  const openActivityOverride = (activity) => {
    setActivityOverride({
      ...activity,
      status: activity.status || "not_commenced",
      progressPercent: String(activity.progressPercent ?? 0),
      reason: "",
    });
  };

  const saveActivityOverride = async () => {
    if (!activityOverride) return;
    setActivityOverrideBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/my-activities?id=${activityOverride.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          administratorOverride: true,
          status: activityOverride.status,
          progressPercent: activityOverride.status === "completed" ? 100 : activityOverride.progressPercent,
          overrideReason: activityOverride.reason,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not override this work activity status.");
      setActivityOverride(null);
      onToast?.("Work activity status overridden, audit record saved and assigned staff notified.");
      await load();
    } catch (overrideError) {
      setError(overrideError.message || "Could not override this work activity status.");
    } finally {
      setActivityOverrideBusy(false);
    }
  };

  const submitHealthOverride = async (status, note) => {
    setOverrideBusy(true);
    try {
      const res = await fetch("/api/admin/project-tracker", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "set_health_override", projectId: selected.id, status, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onToast?.(status ? `Status manually set to ${status}.` : "Manual override cleared.");
      setHealthOverrideOpen(false);
      setOverrideNote("");
      await load?.();
    } catch (e) {
      setError(e.message || "Could not update the status override.");
    } finally {
      setOverrideBusy(false);
    }
  };

  const openMissedEntry = async () => {
    setMissedEntryOpen(true);
    setMissedEntryError("");
    setMissedEntryLoading(true);
    try {
      const res = await fetch(`/api/admin/project-tracker-entries?projectId=${selected.id}`, { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load eligible staff for this project.");
      setMissedEntryStaff(data.staff || []);
      setMissedEntryForm((form) => ({ ...form, staffUserId: "", sourceId: "", allocationId: "", activityCategory: "" }));
      setMissedEntryCategoryOptions(data.categoryOptions || []);
    } catch (e) {
      setMissedEntryError(e.message || "Could not load eligible staff for this project.");
    } finally {
      setMissedEntryLoading(false);
    }
  };

  const submitMissedEntry = async () => {
    setMissedEntrySaving(true);
    setMissedEntryError("");
    try {
      const res = await fetch("/api/admin/project-tracker-entries", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ projectId: selected.id, ...missedEntryForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save this entry.");
      onToast?.("Timesheet entry logged on the staff member's behalf.");
      setMissedEntryOpen(false);
      setMissedEntryForm({ staffUserId: "", sourceId: "", allocationId: "", activityId: "", workDate: "", activityCategory: "", activityInformation: "", hours: "", status: "completed", notableIssues: "" });
      await load();
    } catch (e) {
      setMissedEntryError(e.message || "Could not save this entry.");
    } finally {
      setMissedEntrySaving(false);
    }
  };

  const editEntry = (entry) => {
    setEntryEditor({
      id: entry.id,
      staffName: entry.staff_name,
      workDate: entry.work_date || "",
      activityCategory: entry.activity_category || "",
      activityInformation: entry.activity_information || "",
      hours: entry.hours ?? "",
      status: entry.status || "active",
      notableIssues: entry.notable_issues || "",
      correctionReason: "",
    });
  };

  const saveEntryEdit = async () => {
    if (!entryEditor) return;
    setEntryMutationBusy(entryEditor.id);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-entries", {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(entryEditor),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not update this tracker entry.");
      setEntryEditor(null);
      onToast?.("Tracker entry updated and the staff member notified.");
      await load();
    } catch (mutationError) {
      setError(mutationError.message || "Could not update this tracker entry.");
    } finally {
      setEntryMutationBusy("");
    }
  };

  const deleteEntry = async (entry) => {
    if (!window.confirm(`Delete ${entry.staff_name}'s ${entry.activity_category} entry for ${entry.work_date}? This removes it from project totals and cannot be undone.`)) return;
    const reason = window.prompt("Why is this entry being voided? This reason is retained in the audit trail.");
    if (reason === null) return;
    setEntryMutationBusy(entry.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/project-tracker-entries?id=${entry.id}`, { method: "DELETE", headers: headers(), body: JSON.stringify({ reason }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not delete this tracker entry.");
      if (entryEditor?.id === entry.id) setEntryEditor(null);
      onToast?.("Tracker entry deleted, project totals recalculated and the staff member notified.");
      await load();
    } catch (mutationError) {
      setError(mutationError.message || "Could not delete this tracker entry.");
    } finally {
      setEntryMutationBusy("");
    }
  };

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker", {
        headers: headers(),
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not load the Project Tracker.");
      const nextProjects = body.projects || [];
      setProjects(nextProjects);
      setFinancialReady(Boolean(body.financialReady));
      setSelectedId((current) => (current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id || ""));
    } catch (loadError) {
      setError(loadError.message || "Could not load the Project Tracker.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (
      initialProjectId &&
      projects.some((project) => project.id === initialProjectId)
    )
      setSelectedId(initialProjectId);
  }, [initialProjectId, projects]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedId) window.localStorage.setItem("ec-admin-tracker-selected-id", selectedId);
      else window.localStorage.removeItem("ec-admin-tracker-selected-id");
    } catch {}
  }, [selectedId]);

  const saveSource = async () => {
    if (!selected || !sourceEditor) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "save_source",
          projectId: selected.id,
          ...sourceEditor,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not save the budget source.");
      setSourceEditor(null);
      await load();
      onToast?.("Budget source saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save the budget source.");
    } finally {
      setSaving(false);
    }
  };
  const saveAllocation = async () => {
    if (!selected || !allocationEditor) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "save_allocation",
          projectId: selected.id,
          ...allocationEditor,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not save the allocation.");
      setAllocationEditor(null);
      await load();
      onToast?.("Budget allocation saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save the allocation.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (action, id, label) => {
    if (!selected || !window.confirm(`Delete ${label}? This cannot be undone.`))
      return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/project-tracker?action=${action}&id=${id}&projectId=${selected.id}`,
        { method: "DELETE", headers: headers() },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not delete the tracker record.");
      await load();
      onToast?.("Project Tracker record deleted.");
    } catch (removeError) {
      setError(removeError.message || "Could not delete the tracker record.");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <section className="admin-project-tracker">
        <div className="apt-loading">
          <Loader2 className="spin" size={18} /> Loading active project
          trackers…
        </div>
      </section>
    );

  return (
    <section className="admin-project-tracker" aria-label="Project Tracker">
      {error ? (
        <div className="apt-error" role="alert">
          {error}
        </div>
      ) : null}
      {!financialReady ? (
        <div className="apt-notice">
          <FolderCog size={17} />
          <span>
            The detailed budget-source tracker is ready for review. Its
            financial fields become editable after the separate additive tracker
            migration is approved and applied.
          </span>
        </div>
      ) : null}

      {!selected ? (
        <div className="apt-empty">
          <ClipboardList size={22} />
          <strong>No active projects are available</strong>
          <span>
            The Project Tracker and Health Report become available as soon as
            the first active project is created and allocated.
          </span>
          <div className="apt-empty-actions">
            <button type="button" onClick={() => onOpenProjectSetup?.()}>
              <Plus size={14} /> Create first active project
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onOpenProjectSetup?.()}
            >
              <FolderCog size={14} /> Open project initiation
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="apt-hero">
            <div>
              <span>Projects &amp; Operations · Active project tracker</span>
              <h1>Project Tracker</h1>
              <p>
                Select an active project to review its controlled budget
                sources, allocations, delivery signals and profitability
                estimate.
              </p>
            </div>
            <ProjectTrackerExport scope="portfolio" />
          </header>

          <div className="apt-layout">
            <aside className="apt-project-list" aria-label="Active projects">
              <div className="apt-list-head">
                <span>Active projects</span>
                <b>{projects.length}</b>
              </div>
              {projects.map((project) => {
                const isExpanded = expandedProjectId === project.id;
                const budgetPct = percent(project.financials.chargeOutSpend, project.financials.overallBudget);
                const hoursPct = percent(project.financials.usedHours, project.financials.budgetHours);
                return (
                  <div key={project.id} style={{ marginBottom: 7 }}>
                    <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(project.id);
                          setSourceEditor(null);
                          setAllocationEditor(null);
                        }}
                        className={`apt-project ${project.id === selected.id ? "selected" : ""}`}
                        style={{ flex: 1, marginBottom: 0 }}
                      >
                        <span
                          className={`apt-health ${project.health.toLowerCase().replace(/\s/g, "-")}`}
                          title={project.healthReasons?.length ? project.healthReasons.join(" · ") : "No risk factors currently flagged"}
                        >
                          {project.health}
                        </span>
                        <strong>{project.name}</strong>
                        <small>{project.clientName}</small>
                        <em>{project.taskCompletion}% tasks complete</em>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedProjectId(isExpanded ? "" : project.id)}
                        aria-label={isExpanded ? "Collapse quick stats" : "Expand quick stats"}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 26, flexShrink: 0, border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 8, background: isExpanded ? "rgba(231,201,121,0.14)" : "transparent",
                          color: "#cfe0c8", cursor: "pointer",
                        }}
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    </div>
                    {isExpanded ? (
                      <div style={{ padding: "9px 11px", margin: "4px 0 0", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, background: "rgba(0,0,0,0.18)" }}>
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8a927c", marginBottom: 3 }}>
                            <span>Budget</span>
                            <span>{budgetPct}%</span>
                          </div>
                          <div style={{ background: "#2a3a2a", borderRadius: 6, height: 6, overflow: "hidden" }}>
                            <div style={{ width: `${budgetPct}%`, background: budgetPct >= 90 ? "#a5342a" : "#2c6a34", height: "100%" }} />
                          </div>
                        </div>
                        <div style={{ marginBottom: project.healthReasons?.length ? 8 : 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8a927c", marginBottom: 3 }}>
                            <span>Hours</span>
                            <span>{hoursPct}%</span>
                          </div>
                          <div style={{ background: "#2a3a2a", borderRadius: 6, height: 6, overflow: "hidden" }}>
                            <div style={{ width: `${hoursPct}%`, background: hoursPct >= 90 ? "#a5342a" : "#2c6a34", height: "100%" }} />
                          </div>
                        </div>
                        {project.healthReasons?.length ? (
                          <ul style={{ margin: 0, padding: "0 0 0 14px", fontSize: 10.5, color: "#e0b9a0", lineHeight: 1.5 }}>
                            {project.healthReasons.map((reason, i) => <li key={i}>{reason}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </aside>

            <div className="apt-detail">
              <div className="apt-project-heading">
                <div>
                  <span className="apt-kicker">
                    {selected.status || "Active"} project
                  </span>
                  <h2 style={{ color: "#fffdf8", fontWeight: 700 }}>{selected.name}</h2>
                  <p>
                    {selected.clientName}
                    {selected.description ? ` · ${selected.description}` : ""}
                  </p>
                </div>
                <div className="apt-heading-actions">
                  <button
                    type="button"
                    onClick={() => { setOverrideStatus(selected.manualHealthStatus || "On Track"); setOverrideNote(""); setHealthOverrideOpen(true); }}
                  >
                    <ShieldAlert size={14} /> {selected.healthOverridden ? "Status overridden" : "Override status"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProjectSetup?.(selected.id)}
                  >
                    <UsersRound size={14} /> Assign team
                  </button>
                  <ProjectTrackerExport
                    scope="project"
                    projectId={selected.id}
                    projectName={selected.name}
                    compact
                  />
                </div>
              </div>

              <TrackerDetailTabs detailView={detailView} setDetailView={setDetailView} />

              <div className="apt-metrics">
                <Metric
                  label="Budget remaining"
                  value={money((selected.financials.overallBudget || 0) - (selected.financials.chargeOutSpend || 0))}
                  tone={(selected.financials.overallBudget || 0) - (selected.financials.chargeOutSpend || 0) < 0 ? "danger" : "moss"}
                />
                <Metric
                  label="Hours remaining"
                  value={hours((selected.financials.budgetHours || 0) - (selected.financials.usedHours || 0))}
                  tone={(selected.financials.budgetHours || 0) - (selected.financials.usedHours || 0) < 0 ? "danger" : "moss"}
                />
                <Metric
                  label="Overall completion"
                  value={`${selected.taskCompletion}%`}
                  tone={selected.taskCompletion >= 100 ? "moss" : "gold"}
                />
              </div>

              {detailView === "budget" ? <button
                type="button"
                onClick={() => setFinancialDetailsOpen((v) => !v)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#cfe0c8", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "4px 0", marginBottom: financialDetailsOpen ? 8 : 18 }}
              >
                {financialDetailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Financial details
              </button> : null}
              {detailView === "budget" && financialDetailsOpen ? (
                <div className="apt-metrics" style={{ marginBottom: 18 }}>
                  <Metric
                    label="Original budget"
                    value={money(selected.financials.originalBudget)}
                  />
                  <Metric
                    label="Approved variations"
                    value={money(selected.financials.variationBudget)}
                    tone="gold"
                  />
                  <Metric
                    label="Overall budget"
                    value={money(selected.financials.overallBudget)}
                  />
                  <Metric
                    label="Quote-rate spend"
                    value={money(selected.financials.chargeOutSpend)}
                    tone="moss"
                  />
                  <Metric
                    label="Delivery cost (60% rate)"
                    value={money(selected.financials.internalCost)}
                  />
                  <Metric
                    label="Estimated profit"
                    value={money(selected.financials.estimatedProfit)}
                    tone={
                      selected.financials.estimatedProfit < 0 ? "danger" : "moss"
                    }
                  />
                  <Metric
                    label="Quoted hours"
                    value={hours(selected.financials.budgetHours)}
                  />
                  <Metric
                    label="Hours used"
                    value={hours(selected.financials.usedHours)}
                    tone="moss"
                  />
                </div>
              ) : null}

              {detailView === "overview" ? (() => {
                const budgetTotal = selected.financials.overallBudget || 0;
                const budgetUsed = selected.financials.chargeOutSpend || 0;
                const budgetPct = budgetTotal > 0 ? Math.min(100, Math.round((budgetUsed / budgetTotal) * 100)) : 0;
                const hoursTotal = selected.financials.budgetHours || 0;
                const hoursUsed = selected.financials.usedHours || 0;
                const hoursPct = hoursTotal > 0 ? Math.min(100, Math.round((hoursUsed / hoursTotal) * 100)) : 0;
                return (
                  <div className="apt-card" style={{ marginBottom: 18 }}>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8a927c", marginBottom: 4 }}>
                        <span>Budget — {money(budgetUsed)} used</span>
                        <span>{money(budgetTotal - budgetUsed)} remaining</span>
                      </div>
                      <div style={{ background: "#2a3a2a", borderRadius: 6, height: 10, overflow: "hidden" }}>
                        <div style={{ width: `${budgetPct}%`, background: budgetPct >= 90 ? "#a5342a" : "#2c6a34", height: "100%" }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8a927c", marginBottom: 4 }}>
                        <span>Hours — {number(hoursUsed)} used</span>
                        <span>{number(hoursTotal - hoursUsed)} remaining</span>
                      </div>
                      <div style={{ background: "#2a3a2a", borderRadius: 6, height: 10, overflow: "hidden" }}>
                        <div style={{ width: `${hoursPct}%`, background: hoursPct >= 90 ? "#a5342a" : "#2c6a34", height: "100%" }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8a927c", marginBottom: 4 }}>
                        <span>Task progress</span>
                        <span>{selected.taskCompletion}% delivery complete</span>
                      </div>
                      <div style={{ background: "#2a3a2a", borderRadius: 6, height: 10, overflow: "hidden" }}>
                        <div style={{ width: `${selected.taskCompletion}%`, background: "#c98a1e", height: "100%" }} />
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              <div className={`apt-grid apt-grid--${detailView}`}>
                {detailView === "budget" ? <section className="apt-card apt-allocations">
                  <div className="apt-card-head">
                    <div>
                      <span className="apt-kicker">
                        Controlled budget allocation
                      </span>
                      <h3>Budget allocations</h3>
                    </div>
                    <button
                      type="button"
                      className="apt-add"
                      disabled={!financialReady || !selected.sources.length}
                      onClick={() =>
                        setAllocationEditor(
                          emptyAllocation(selected.sources[0]),
                        )
                      }
                    >
                      <Plus size={14} /> New allocation
                    </button>
                  </div>
                  {selected.sources.length ? (
                    <div className="apt-allocation-table">
                      <div className="apt-row apt-table-head">
                        <span>Allocation</span>
                        <span>Approved</span>
                        <span>Spend</span>
                        <span>Hours</span>
                        <span>Consumed</span>
                        <span>Status</span>
                        <span />
                      </div>
                      {selected.sources.map((source) => (
                        <div className="apt-source-block" key={source.id}>
                          <div className="apt-source-line">
                            <strong>{source.source_name}</strong>
                            <span>{source.source_code}</span>
                            <em>
                              {source.source_type === "original"
                                ? (source.approval_status ? source.approval_status.charAt(0).toUpperCase() + source.approval_status.slice(1) : "Approved")
                                : `${source.source_type} · ${source.approval_status}`}
                            </em>
                            <button
                              type="button"
                              onClick={() =>
                                setSourceEditor({
                                  id: source.id,
                                  sourceCode: source.source_code,
                                  sourceName: source.source_name,
                                  sourceType: source.source_type,
                                  approvedValue: source.approved_value,
                                  approvedHours: source.approved_hours,
                                  approvalStatus: source.approval_status,
                                  variationReason:
                                    source.variation_reason || "",
                                  effectiveDate: source.effective_date || "",
                                })
                              }
                            >
                              <Pencil size={12} /> Edit source
                            </button>
                            {source.source_type !== "original" ? (
                              <button
                                type="button"
                                className="apt-text-danger"
                                onClick={() =>
                                  remove(
                                    "source",
                                    source.id,
                                    source.source_name,
                                  )
                                }
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            ) : null}
                          </div>
                          {source.allocations?.length ? (
                            source.allocations.map((allocation) => (
                              <div className="apt-row" key={allocation.id}>
                                <span>
                                  <strong>{allocation.allocation_name}</strong>
                                  <small>{allocation.allocation_code}</small>
                                </span>
                                <span>
                                  {money(allocation.allocation_value)}
                                </span>
                                <span>
                                  {money(allocation.charge_out_spend)}
                                </span>
                                <span>
                                  {number(allocation.allocation_hours)} h
                                </span>
                                <span>
                                  <i>
                                    <b
                                      style={{
                                        width: `${Math.max(percent(allocation.hours_consumed, allocation.allocation_hours), percent(allocation.charge_out_spend, allocation.allocation_value))}%`,
                                      }}
                                    />
                                  </i>
                                  {Math.max(
                                    percent(
                                      allocation.hours_consumed,
                                      allocation.allocation_hours,
                                    ),
                                    percent(
                                      allocation.charge_out_spend,
                                      allocation.allocation_value,
                                    ),
                                  )}
                                  %
                                </span>
                                <span>
                                  <em
                                    className={`apt-allocation-state ${allocation.health}`}
                                  >
                                    {allocation.health.replace("_", " ")}
                                  </em>
                                </span>
                                <span className="apt-row-actions">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAllocationEditor({
                                        id: allocation.id,
                                        sourceId: source.id,
                                        allocationCode:
                                          allocation.allocation_code,
                                        allocationName:
                                          allocation.allocation_name,
                                        allocationValue:
                                          allocation.allocation_value,
                                        allocationHours:
                                          allocation.allocation_hours,
                                        hoursConsumed:
                                          allocation.hours_consumed,
                                        chargeOutSpend:
                                          allocation.charge_out_spend,
                                        internalCost: allocation.internal_cost,
                                        thresholdPercent:
                                          allocation.threshold_percent,
                                        status: allocation.status,
                                        staffVisible: allocation.staff_visible,
                                      })
                                    }
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className="apt-icon-danger"
                                    onClick={() =>
                                      remove(
                                        "allocation",
                                        allocation.id,
                                        allocation.allocation_name,
                                      )
                                    }
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="apt-no-allocation">
                              No operational allocations configured for this
                              source.
                            </div>
                          )}
                          <button
                            type="button"
                            className="apt-add-inline"
                            disabled={!financialReady}
                            onClick={() =>
                              setAllocationEditor(emptyAllocation(source))
                            }
                          >
                            <Plus size={13} /> Add allocation to{" "}
                            {source.source_name}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="apt-empty small">
                      <ClipboardList size={18} />
                      <strong>Set the original project budget</strong>
                      <span>
                        Begin with the agreed original contract, then add
                        approved variations and operational allocations.
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="apt-add-source"
                    disabled={!financialReady}
                    onClick={() =>
                      setSourceEditor(
                        selected.sources.length
                          ? emptySource(selected)
                          : {
                              ...emptySource(selected),
                              sourceCode: "ORG-01",
                              sourceName: "Original Scope",
                              sourceType: "original",
                              approvedValue:
                                selected.financials.originalBudget || "",
                              approvedHours:
                                selected.financials.budgetHours || "",
                              approvalStatus: "approved",
                            },
                      )
                    }
                  >
                    <Plus size={14} />{" "}
                    {selected.sources.length
                      ? "Add variation or budget source"
                      : "Set original project budget"}
                  </button>
                </section> : null}

                <aside className="apt-side">
                  {detailView === "overview" ? <section className="apt-card">
                    <span className="apt-kicker">Project actions</span>
                    <h3>Needs attention</h3>
                    <ul>
                      <li>
                        <CheckCircle2 size={14} />{" "}
                        {selected.entrySummary?.count
                          ? `${selected.entrySummary.count} staff Project Tracker entr${selected.entrySummary.count === 1 ? "y" : "ies"} · ${number(selected.entrySummary.submittedHours)} hours recorded`
                          : "No staff Project Tracker entries recorded"}
                      </li>
                      <li>
                        <CheckCircle2 size={14} />{" "}
                        {selected.activitySummary.paused
                          ? `${selected.activitySummary.paused} delivery entr${selected.activitySummary.paused === 1 ? "y" : "ies"} paused or awaiting information`
                          : "No blocked delivery entries"}
                      </li>
                      <li>
                        <CheckCircle2 size={14} />{" "}
                        {selected.activitySummary.atRiskAllocations
                          ? `${selected.activitySummary.atRiskAllocations === 1 ? "1 allocation has" : `${selected.activitySummary.atRiskAllocations} allocations have`} exceeded the approved limit`
                          : "No allocations over their approved limit"}
                      </li>
                      <li>
                        <CheckCircle2 size={14} />{" "}
                        {selected.activitySummary.watchAllocations
                          ? `${selected.activitySummary.watchAllocations === 1 ? "1 allocation is" : `${selected.activitySummary.watchAllocations} allocations are`} approaching threshold`
                          : "No allocations approaching threshold"}
                      </li>
                    </ul>
                  </section> : null}
                  {detailView === "timesheets" ? (() => {
                    const allEntries = selected.entrySummary?.all || [];
                    const staffOptions = [...new Set(allEntries.map((e) => e.staff_name).filter(Boolean))];
                    const activityOptions = [...new Set(allEntries.map((e) => e.activity_category).filter(Boolean))];
                    const filteredEntries = allEntries.filter((e) =>
                      (entryStaffFilter === "all" || e.staff_name === entryStaffFilter) &&
                      (entryActivityFilter === "all" || e.activity_category === entryActivityFilter) &&
                      (entryStatusFilter === "all" || e.status === entryStatusFilter) &&
                      (!entryDateFrom || (e.work_date && e.work_date >= entryDateFrom)) &&
                      (!entryDateTo || (e.work_date && e.work_date <= entryDateTo))
                    );
                    return (
                      <section className="apt-card apt-recent-entries">
                        <span className="apt-kicker">Timesheet position</span>
                        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
                          <div><div style={{ fontSize: 11, color: "#8a927c", textTransform: "uppercase" }}>Total recorded</div><div style={{ fontSize: 18, fontWeight: 700 }}>{number(selected.entrySummary?.submittedHours || 0)} hrs</div></div>
                          <div><div style={{ fontSize: 11, color: "#8a927c", textTransform: "uppercase" }}>Approved</div><div style={{ fontSize: 18, fontWeight: 700, color: "#2c6a34" }}>{number(selected.entrySummary?.approvedHours || 0)} hrs</div></div>
                          <div><div style={{ fontSize: 11, color: "#8a927c", textTransform: "uppercase" }}>Awaiting approval</div><div style={{ fontSize: 18, fontWeight: 700, color: "#c98a1e" }}>{number(selected.entrySummary?.awaitingHours || 0)} hrs</div></div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                          <h3 style={{ margin: 0 }}>Timesheet entries</h3>
                          <button
                            type="button"
                            onClick={() => (missedEntryOpen ? setMissedEntryOpen(false) : openMissedEntry())}
                            style={{ background: missedEntryOpen ? "rgba(231,201,121,0.14)" : "#1f5a34", color: missedEntryOpen ? "#e7c979" : "#fff", border: "1px solid #e7c979", borderRadius: 8, padding: "7px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          >
                            {missedEntryOpen ? "Cancel" : "Log missed entry"}
                          </button>
                        </div>
                        {missedEntryOpen ? (
                          <div style={{ margin: "10px 0 16px", padding: 14, border: "1px solid rgba(231,201,121,0.3)", borderRadius: 10, background: "rgba(4,24,14,0.4)" }}>
                            <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "#a9c0a4" }}>
                              This logs an entry exactly as if the staff member had submitted it themselves — they'll be notified it was added on their behalf.
                            </p>
                            {missedEntryLoading ? (
                              <p style={{ fontSize: 12.5, color: "#a9c0a4" }}>Loading eligible staff…</p>
                            ) : missedEntryStaff.length === 0 ? (
                              <p style={{ fontSize: 12.5, color: "#e0b9a0" }}>No staff have an active allocation on this project.</p>
                            ) : (
                              <>
                                {missedEntryError ? <p style={{ fontSize: 12, color: "#ffb7ae", margin: "0 0 10px" }}>{missedEntryError}</p> : null}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginBottom: 8 }}>
                                  <select value={missedEntryForm.staffUserId} onChange={(e) => setMissedEntryForm((f) => ({ ...f, staffUserId: e.target.value }))}>
                                    <option value="">Staff member…</option>
                                    {missedEntryStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                  <select
                                    value={missedEntryForm.sourceId}
                                    onChange={(e) => setMissedEntryForm((f) => ({ ...f, sourceId: e.target.value, allocationId: "" }))}
                                  >
                                    <option value="">Budget source…</option>
                                    {selected.sources.map((s) => <option key={s.id} value={s.id}>{s.source_name}</option>)}
                                  </select>
                                  <select
                                    value={missedEntryForm.allocationId}
                                    onChange={(e) => setMissedEntryForm((f) => ({ ...f, allocationId: e.target.value }))}
                                    disabled={!missedEntryForm.sourceId}
                                  >
                                    <option value="">Allocation…</option>
                                    {(selected.sources.find((s) => s.id === missedEntryForm.sourceId)?.allocations || [])
                                      .filter((a) => a.status === "active" && a.staff_visible)
                                      .map((a) => <option key={a.id} value={a.id}>{a.allocation_name}</option>)}
                                  </select>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginBottom: 8 }}>
                                  <input type="date" value={missedEntryForm.workDate} onChange={(e) => setMissedEntryForm((f) => ({ ...f, workDate: e.target.value }))} />
                                  <select value={missedEntryForm.activityCategory} onChange={(e) => setMissedEntryForm((f) => ({ ...f, activityCategory: e.target.value }))}>
                                    <option value="">Activity category…</option>
                                    {missedEntryCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <input type="number" min="0" step="0.25" placeholder="Hours" value={missedEntryForm.hours} onChange={(e) => setMissedEntryForm((f) => ({ ...f, hours: e.target.value }))} />
                                </div>
                                <textarea
                                  placeholder="What was done — same as a normal timesheet description"
                                  value={missedEntryForm.activityInformation}
                                  onChange={(e) => setMissedEntryForm((f) => ({ ...f, activityInformation: e.target.value }))}
                                  style={{ width: "100%", minHeight: 60, marginBottom: 8, boxSizing: "border-box" }}
                                />
                                <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                                  <select value={missedEntryForm.status} onChange={(e) => setMissedEntryForm((f) => ({ ...f, status: e.target.value }))}>
                                    <option value="completed">Completed</option>
                                    <option value="active">Active</option>
                                  </select>
                                  <button
                                    type="button"
                                    disabled={missedEntrySaving || !missedEntryForm.staffUserId || !missedEntryForm.allocationId || !missedEntryForm.workDate || !missedEntryForm.activityCategory || !missedEntryForm.activityInformation || !missedEntryForm.hours}
                                    onClick={submitMissedEntry}
                                    style={{ background: "#1f5a34", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: missedEntrySaving ? 0.6 : 1 }}
                                  >
                                    {missedEntrySaving ? "Saving…" : "Save entry"}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                        {entryEditor ? (
                          <div className="apt-entry-editor" role="region" aria-label="Edit tracker entry">
                            <div className="apt-entry-editor__head">
                              <div><span className="apt-kicker">Administrator correction</span><h4>Edit {entryEditor.staffName}&apos;s entry</h4></div>
                              <button type="button" className="aps-secondary" onClick={() => setEntryEditor(null)} disabled={Boolean(entryMutationBusy)}>Cancel</button>
                            </div>
                            <div className="apt-entry-editor__grid">
                              <label>Work date<input type="date" value={entryEditor.workDate} onChange={(event) => setEntryEditor((current) => ({ ...current, workDate: event.target.value }))} /></label>
                              <label>Activity category<input value={entryEditor.activityCategory} onChange={(event) => setEntryEditor((current) => ({ ...current, activityCategory: event.target.value }))} /></label>
                              <label>Hours<input type="number" min="0" max="24" step="0.25" value={entryEditor.hours} onChange={(event) => setEntryEditor((current) => ({ ...current, hours: event.target.value }))} /></label>
                              <label>Status<select value={entryEditor.status} onChange={(event) => setEntryEditor((current) => ({ ...current, status: event.target.value }))}>
                                <option value="not_commenced">Not commenced</option><option value="active">Active</option><option value="need_info">Information required</option><option value="paused_other">Paused</option><option value="qa_review">QA review</option><option value="completed">Completed</option>
                              </select></label>
                              <label className="apt-entry-editor__wide">Description<textarea rows={3} value={entryEditor.activityInformation} onChange={(event) => setEntryEditor((current) => ({ ...current, activityInformation: event.target.value }))} /></label>
                              <label className="apt-entry-editor__wide">Notable issues<textarea rows={2} value={entryEditor.notableIssues} onChange={(event) => setEntryEditor((current) => ({ ...current, notableIssues: event.target.value }))} /></label>
                              <label className="apt-entry-editor__wide">Correction note <span className="apt-entry-editor__requirement">Optional — recorded in the audit trail if supplied</span><textarea rows={2} value={entryEditor.correctionReason} aria-describedby="tracker-correction-reason-help" placeholder="Optional context for this correction." onChange={(event) => setEntryEditor((current) => ({ ...current, correctionReason: event.target.value }))} /></label>
                            </div>
                            <p id="tracker-correction-reason-help" className="apt-entry-editor__help">The original entry and the correction are retained in the audit trail. If no note is added, the system records that this was an administrator correction.</p>
                            <button type="button" className="aps-primary" disabled={Boolean(entryMutationBusy) || !entryEditor.workDate || !entryEditor.activityCategory.trim() || !entryEditor.activityInformation.trim() || entryEditor.hours === ""} onClick={saveEntryEdit}>
                              <CheckCircle2 size={14} /> {entryMutationBusy ? "Saving correction…" : "Save corrected entry"}
                            </button>
                          </div>
                        ) : null}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                          <select value={entryStaffFilter} onChange={(e) => setEntryStaffFilter(e.target.value)}>
                            <option value="all">All staff</option>
                            {staffOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <select value={entryActivityFilter} onChange={(e) => setEntryActivityFilter(e.target.value)}>
                            <option value="all">All activities</option>
                            {activityOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <select value={entryStatusFilter} onChange={(e) => setEntryStatusFilter(e.target.value)}>
                            <option value="all">All statuses</option>
                            <option value="active">Active</option>
                            <option value="completed">Completed</option>
                          </select>
                          <input type="date" value={entryDateFrom} onChange={(e) => setEntryDateFrom(e.target.value)} title="From date" />
                          <input type="date" value={entryDateTo} onChange={(e) => setEntryDateTo(e.target.value)} title="To date" />
                          {(entryStaffFilter !== "all" || entryActivityFilter !== "all" || entryStatusFilter !== "all" || entryDateFrom || entryDateTo) ? (
                            <button type="button" onClick={() => { setEntryStaffFilter("all"); setEntryActivityFilter("all"); setEntryStatusFilter("all"); setEntryDateFrom(""); setEntryDateTo(""); }} style={{ background: "none", border: "1px solid #3a4a3a", color: "#cfe0c8", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>Clear filters</button>
                          ) : null}
                        </div>
                        {filteredEntries.length ? (
                          <div className="apt-timesheet-table-wrap">
                            <table className="apt-timesheet-table">
                              <thead>
                                <tr style={{ textAlign: "left", borderBottom: "1px solid #3a4a3a" }}>
                                  <th style={{ padding: "6px 8px" }}>Date</th>
                                  <th style={{ padding: "6px 8px" }}>Staff</th>
                                  <th style={{ padding: "6px 8px" }}>Activity</th>
                                  <th style={{ padding: "6px 8px" }}>Description</th>
                                  <th style={{ padding: "6px 8px" }}>Hours</th>
                                  <th style={{ padding: "6px 8px" }}>Status</th>
                                  <th style={{ padding: "6px 8px" }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredEntries.map((entry) => (
                                  <tr key={entry.id} style={{ borderBottom: "1px solid #2a3a2a" }}>
                                    <td style={{ padding: "6px 8px" }}>{entry.work_date}</td>
                                    <td style={{ padding: "6px 8px" }}>
                                      {entry.staff_name}
                                      {entry.entered_by_admin_id ? <span title="Logged by an admin on this staff member's behalf" style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#e7c979", border: "1px solid rgba(231,201,121,0.4)", borderRadius: 4, padding: "1px 5px" }}>ADMIN</span> : null}
                                    </td>
                                    <td style={{ padding: "6px 8px" }}>{entry.activity_category}</td>
                                    <td style={{ padding: "6px 8px" }}>{entry.activity_information || "—"}</td>
                                    <td style={{ padding: "6px 8px" }}>{number(entry.hours)}</td>
                                    <td style={{ padding: "6px 8px" }}>
                                      <em className={`apt-allocation-state ${entry.status === "completed" ? "on_track" : "watch"}`}>{entry.status.replaceAll("_", " ")}</em>
                                    </td>
                                    <td style={{ padding: "6px 8px" }}>
                                      <div className="apt-entry-actions">
                                        <button type="button" onClick={() => editEntry(entry)} disabled={Boolean(entryMutationBusy)} title="Edit tracker entry"><Pencil size={13} /> Edit</button>
                                        <button type="button" className="danger" onClick={() => deleteEntry(entry)} disabled={Boolean(entryMutationBusy)} title="Delete tracker entry"><Trash2 size={13} /> Delete</button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>{allEntries.length ? "No entries match the selected filters." : "No staff tracker entries have been submitted."}</p>
                        )}
                      </section>
                    );
                  })() : null}

                  {detailView === "activities" && (selected.activityPosition || []).length ? (
                    <section className="apt-card">
                      <span className="apt-kicker">Activity position</span>
                      <h3>What's allocated, who owns it, what's left</h3>
                      <p className="apt-activity-override-intro">Staff update their own assigned activities in My Projects → Work activities. Use an administrator override only when an authorised correction is needed; the reason is retained in the activity audit trail and the assigned staff member is notified.</p>
                      {activityOverride ? (
                        <div className="apt-activity-override" role="region" aria-label="Administrator activity status override">
                          <div className="apt-entry-editor__head">
                            <div><span className="apt-kicker">Administrator override</span><h4>{activityOverride.title}</h4><p>{activityOverride.assignedTo || "Unassigned"}</p></div>
                            <button type="button" className="aps-secondary" onClick={() => setActivityOverride(null)} disabled={activityOverrideBusy}>Cancel</button>
                          </div>
                          <div className="apt-activity-override__grid">
                            <label>Delivery status<select value={activityOverride.status} onChange={(event) => setActivityOverride((current) => ({ ...current, status: event.target.value }))}>
                              <option value="not_commenced">Not commenced</option><option value="active">Active</option><option value="need_info">Information required</option><option value="paused_other">Paused</option><option value="qa_review">QA review</option><option value="completed">Completed</option>
                            </select></label>
                            <label>Completion (%)<input type="number" min="0" max="100" step="5" value={activityOverride.status === "completed" ? 100 : activityOverride.progressPercent} disabled={activityOverride.status === "completed"} onChange={(event) => setActivityOverride((current) => ({ ...current, progressPercent: event.target.value }))} /></label>
                            <label className="apt-entry-editor__wide">Override reason <span className="apt-entry-editor__requirement">Required for the audit trail — {activityOverride.reason.trim().length}/10 characters</span><textarea rows={2} value={activityOverride.reason} placeholder="Explain the authorised reason for overriding this staff work activity." onChange={(event) => setActivityOverride((current) => ({ ...current, reason: event.target.value }))} /></label>
                          </div>
                          <button type="button" className="aps-primary" disabled={activityOverrideBusy || activityOverride.reason.trim().length < 10} onClick={saveActivityOverride}>
                            <CheckCircle2 size={14} /> {activityOverrideBusy ? "Saving override…" : activityOverride.reason.trim().length < 10 ? "Add override reason to save" : "Save status override"}
                          </button>
                        </div>
                      ) : null}
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                          <thead>
                            <tr style={{ textAlign: "left", borderBottom: "1px solid #3a4a3a" }}>
                              <th style={{ padding: "6px 8px" }}>Activity</th>
                              <th style={{ padding: "6px 8px" }}>Assigned to</th>
                              <th style={{ padding: "6px 8px" }}>Allocated hrs</th>
                              <th style={{ padding: "6px 8px" }}>Actual hrs</th>
                              <th style={{ padding: "6px 8px" }}>Remaining hrs</th>
                              <th style={{ padding: "6px 8px" }}>Status</th>
                              <th style={{ padding: "6px 8px" }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selected.activityPosition.map((row) => (
                              <tr key={row.id} style={{ borderBottom: "1px solid #2a3a2a" }}>
                                <td style={{ padding: "6px 8px" }}>{row.title}</td>
                                <td style={{ padding: "6px 8px" }}>{row.assignedTo}</td>
                                <td style={{ padding: "6px 8px" }}>{row.allocatedHours ?? "—"}</td>
                                <td style={{ padding: "6px 8px" }}>{row.actualHours}</td>
                                <td style={{ padding: "6px 8px", color: row.remainingHours !== null && row.remainingHours < 0 ? "#a5342a" : "inherit" }}>{row.remainingHours ?? "—"}</td>
                                <td style={{ padding: "6px 8px" }}><em className={`apt-allocation-state ${row.status === "completed" ? "on_track" : "watch"}`}>{(row.status || "").replaceAll("_", " ")}</em></td>
                                <td style={{ padding: "6px 8px" }}><button type="button" className="apt-activity-override-button" onClick={() => openActivityOverride(row)} disabled={activityOverrideBusy || !row.staffUserId} title={row.staffUserId ? `Override ${row.title} delivery status` : "Assign a staff member before overriding an activity status"}><Pencil size={13} /> Override</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : detailView === "activities" ? <section className="apt-card"><p className="apt-no-allocation">No active work activities are available for this project.</p></section> : null}

                </aside>
              </div>
            </div>
          </div>

          {sourceEditor ? (
            <SourceEditor
              source={sourceEditor}
              setSource={setSourceEditor}
              onSave={saveSource}
              onCancel={() => setSourceEditor(null)}
              saving={saving}
            />
          ) : null}
          {allocationEditor ? (
            <AllocationEditor
              allocation={allocationEditor}
              setAllocation={setAllocationEditor}
              sources={selected.sources}
              onSave={saveAllocation}
              onCancel={() => setAllocationEditor(null)}
              saving={saving}
            />
          ) : null}

          {healthOverrideOpen ? (
            <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }} onClick={() => setHealthOverrideOpen(false)}>
              <div style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: 12, padding: 22 }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Override project status</h3>
                <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#6b7280" }}>
                  System would currently show <strong>{selected.computedHealth}</strong> based on budget and activity data. An override is visible to anyone viewing this project, with your note attached.
                </p>
                <label style={{ display: "block", marginBottom: 10 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Status</span>
                  <select value={overrideStatus} onChange={(e) => setOverrideStatus(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d9d3c6" }}>
                    <option>On Track</option><option>Watch</option><option>At Risk</option>
                  </select>
                </label>
                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Note — why does this differ from the computed status</span>
                  <textarea rows={3} value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d9d3c6", boxSizing: "border-box", fontFamily: "inherit" }} />
                </label>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  {selected.healthOverridden ? (
                    <button type="button" onClick={() => submitHealthOverride(null, null)} disabled={overrideBusy} style={{ background: "none", border: "1px solid #d9d3c6", borderRadius: 6, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" }}>Clear override</button>
                  ) : <span />}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => setHealthOverrideOpen(false)} style={{ background: "none", border: "1px solid #d9d3c6", borderRadius: 6, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
                    <button type="button" onClick={() => submitHealthOverride(overrideStatus, overrideNote)} disabled={overrideBusy} style={{ background: "#1f5a34", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Save override</button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function TrackerDetailTabs({ detailView, setDetailView }) {
  const tabs = [
    ["overview", "Overview"],
    ["budget", "Budget & variations"],
    ["timesheets", "Timesheets"],
    ["activities", "Work activities"],
  ];
  return (
    <nav className="apt-tabs apt-detail-tabs" aria-label="Selected project details">
      {tabs.map(([value, label]) => (
        <button type="button" key={value} className={detailView === value ? "selected" : ""} onClick={() => setDetailView(value)}>
          {value === "overview" ? <BarChart3 size={14} /> : value === "timesheets" ? <ClipboardList size={14} /> : value === "activities" ? <CheckCircle2 size={14} /> : <FileSpreadsheet size={14} />} {label}
        </button>
      ))}
    </nav>
  );
}
function Metric({ label, value, tone = "" }) {
  return (
    <div className={`apt-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function SourceEditor({ source, setSource, onSave, onCancel, saving }) {
  const update = (key, value) => setSource({ ...source, [key]: value });
  return (
    <div className="apt-modal-backdrop" role="presentation">
      <section
        className="apt-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Budget source editor"
      >
        <div className="apt-card-head">
          <div>
            <span className="apt-kicker">Commercial baseline</span>
            <h3>{source.id ? "Edit budget source" : "Add budget source"}</h3>
          </div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="apt-editor-grid">
          <label>
            Code
            <input
              value={source.sourceCode}
              onChange={(event) => update("sourceCode", event.target.value)}
              placeholder="e.g. VAR-01"
            />
          </label>
          <label>
            Name
            <input
              value={source.sourceName}
              onChange={(event) => update("sourceName", event.target.value)}
              placeholder="e.g. Additional fauna survey"
            />
          </label>
          <label>
            Type
            <select
              value={source.sourceType}
              onChange={(event) => update("sourceType", event.target.value)}
            >
              <option value="original">Original scope</option>
              <option value="variation">Approved variation</option>
              <option value="internal_reallocation">
                Internal reallocation
              </option>
            </select>
          </label>
          <label>
            Approval
            <select
              value={source.approvalStatus}
              onChange={(event) => update("approvalStatus", event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label>
            Approved budget (AUD)
            <input
              inputMode="decimal"
              value={source.approvedValue}
              onChange={(event) => update("approvedValue", event.target.value)}
            />
          </label>
          <label>
            Approved hours
            <input
              inputMode="decimal"
              value={source.approvedHours}
              onChange={(event) => update("approvedHours", event.target.value)}
            />
          </label>
          <label>
            Effective date
            <input
              type="date"
              value={source.effectiveDate}
              onChange={(event) => update("effectiveDate", event.target.value)}
            />
          </label>
          {source.sourceType === "variation" ? (
            <label className="wide">
              Variation reason
              <textarea
                value={source.variationReason}
                onChange={(event) =>
                  update("variationReason", event.target.value)
                }
              />
            </label>
          ) : null}
        </div>
        <button
          type="button"
          className="apt-save"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save budget source"}
        </button>
      </section>
    </div>
  );
}
function AllocationEditor({
  allocation,
  setAllocation,
  sources,
  onSave,
  onCancel,
  saving,
}) {
  const update = (key, value) => setAllocation({ ...allocation, [key]: value });
  return (
    <div className="apt-modal-backdrop" role="presentation">
      <section
        className="apt-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Budget allocation editor"
      >
        <div className="apt-card-head">
          <div>
            <span className="apt-kicker">Operational allocation</span>
            <h3>{allocation.id ? "Edit allocation" : "Add allocation"}</h3>
          </div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="apt-editor-grid">
          <label>
            Budget source
            <select
              value={allocation.sourceId}
              onChange={(event) => update("sourceId", event.target.value)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.source_name} · {source.source_code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Allocation code
            <input
              value={allocation.allocationCode}
              onChange={(event) => update("allocationCode", event.target.value)}
              placeholder="e.g. FIELD"
            />
          </label>
          <label className="wide">
            Allocation name
            <input
              value={allocation.allocationName}
              onChange={(event) => update("allocationName", event.target.value)}
              placeholder="e.g. Fieldwork and travel"
            />
          </label>
          <label>
            Approved value (AUD)
            <input
              inputMode="decimal"
              value={allocation.allocationValue}
              onChange={(event) =>
                update("allocationValue", event.target.value)
              }
            />
          </label>
          <label>
            Approved hours
            <input
              inputMode="decimal"
              value={allocation.allocationHours}
              onChange={(event) =>
                update("allocationHours", event.target.value)
              }
            />
          </label>
          <label>
            Hours consumed
            <input
              inputMode="decimal"
              value={allocation.hoursConsumed}
              onChange={(event) => update("hoursConsumed", event.target.value)}
            />
          </label>
          <label>
            Quote-rate spend (calculated from tracker entries)
            <input
              inputMode="decimal"
              value={allocation.chargeOutSpend}
              readOnly
              aria-readonly="true"
            />
          </label>
          <label>
            Delivery cost (60% of quote-rate spend)
            <input
              inputMode="decimal"
              value={allocation.internalCost}
              readOnly
              aria-readonly="true"
            />
          </label>
          <label>
            Threshold %
            <input
              inputMode="numeric"
              value={allocation.thresholdPercent}
              onChange={(event) =>
                update("thresholdPercent", event.target.value)
              }
            />
          </label>
          <label>
            Status
            <select
              value={allocation.status}
              onChange={(event) => update("status", event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="apt-check">
            <input
              type="checkbox"
              checked={allocation.staffVisible}
              onChange={(event) => update("staffVisible", event.target.checked)}
            />{" "}
            Available to allocated staff
          </label>
        </div>
        <button
          type="button"
          className="apt-save"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save allocation"}
        </button>
      </section>
    </div>
  );
}
