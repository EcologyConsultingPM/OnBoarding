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
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import ProjectTrackerSetup from "./ProjectTrackerSetup";
import ProjectTrackerExport from "./ProjectTrackerExport";

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
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
  const [section, setSection] = useState("trackers");
  const [projects, setProjects] = useState([]);
  const [financialReady, setFinancialReady] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
      setSelectedId((current) => current || nextProjects[0]?.id || "");
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

  if (section === "setup") {
    return (
      <section className="admin-project-tracker">
        <TrackerTabs section={section} setSection={setSection} />
        <ProjectTrackerSetup onToast={onToast} />
      </section>
    );
  }
  if (loading)
    return (
      <section className="admin-project-tracker">
        <TrackerTabs section={section} setSection={setSection} />
        <div className="apt-loading">
          <Loader2 className="spin" size={18} /> Loading active project
          trackers…
        </div>
      </section>
    );

  return (
    <section className="admin-project-tracker" aria-label="Project Tracker">
      <TrackerTabs section={section} setSection={setSection} />
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
              onClick={() => setSection("setup")}
            >
              <FolderCog size={14} /> Configure tracker after creation
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
              {projects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  onClick={() => {
                    setSelectedId(project.id);
                    setSourceEditor(null);
                    setAllocationEditor(null);
                  }}
                  className={`apt-project ${project.id === selected.id ? "selected" : ""}`}
                >
                  <span
                    className={`apt-health ${project.health.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    {project.health}
                  </span>
                  <strong>{project.name}</strong>
                  <small>{project.clientName}</small>
                  <em>{project.taskCompletion}% tasks complete</em>
                </button>
              ))}
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

              <div className="apt-metrics">
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
                  label="Charge-out spend"
                  value={money(selected.financials.chargeOutSpend)}
                  tone="moss"
                />
                <Metric
                  label="Internal cost"
                  value={money(selected.financials.internalCost)}
                />
                <Metric
                  label="Estimated profit"
                  value={money(selected.financials.estimatedProfit)}
                  tone={
                    selected.financials.estimatedProfit < 0 ? "danger" : "moss"
                  }
                />
              </div>

              <div className="apt-grid">
                <section className="apt-card apt-allocations">
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
                            <strong>{source.source_code}</strong>
                            <span>{source.source_name}</span>
                            <em>
                              {source.source_type === "original"
                                ? "Original scope"
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
                            {source.source_code}
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
                </section>

                <aside className="apt-side">
                  <section className="apt-card">
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
                  </section>
                  <section className="apt-card apt-recent-entries">
                    <span className="apt-kicker">Review entries</span>
                    <h3>Recent staff activity</h3>
                    {selected.entrySummary?.recent?.length ? (
                      <div>
                        {selected.entrySummary.recent.map((entry) => (
                          <div className="apt-recent-entry" key={entry.id}>
                            <span>
                              <strong>{entry.activity_category}</strong>
                              <small>
                                {entry.work_date} · {number(entry.hours)} h
                              </small>
                            </span>
                            <em
                              className={`apt-allocation-state ${entry.status === "completed" ? "on_track" : entry.status === "active" ? "watch" : entry.status === "paused_other" ? "at_risk" : "watch"}`}
                            >
                              {entry.status.replaceAll("_", " ")}
                            </em>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>No staff tracker entries have been submitted.</p>
                    )}
                  </section>
                  <section className="apt-card">
                    <span className="apt-kicker">
                      Budget burn vs task progress
                    </span>
                    <h3>{selected.taskCompletion}% delivery complete</h3>
                    <div className="apt-driver">
                      <span>Budget burn</span>
                      <b>
                        {percent(
                          selected.financials.chargeOutSpend,
                          selected.financials.overallBudget,
                        )}
                        %
                      </b>
                      <i>
                        <strong
                          style={{
                            width: `${percent(selected.financials.chargeOutSpend, selected.financials.overallBudget)}%`,
                          }}
                        />
                      </i>
                    </div>
                    <div className="apt-driver">
                      <span>Hours consumed</span>
                      <b>
                        {percent(
                          selected.financials.usedHours,
                          selected.financials.budgetHours,
                        )}
                        %
                      </b>
                      <i>
                        <strong
                          style={{
                            width: `${percent(selected.financials.usedHours, selected.financials.budgetHours)}%`,
                          }}
                        />
                      </i>
                    </div>
                    <div className="apt-driver">
                      <span>Task progress</span>
                      <b>{selected.taskCompletion}%</b>
                      <i>
                        <strong
                          style={{ width: `${selected.taskCompletion}%` }}
                        />
                      </i>
                    </div>
                  </section>
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
        </>
      )}
    </section>
  );
}

function TrackerTabs({ section, setSection }) {
  return (
    <nav className="apt-tabs" aria-label="Project Tracker sub-domains">
      <button
        type="button"
        className={section === "trackers" ? "selected" : ""}
        onClick={() => setSection("trackers")}
      >
        <BarChart3 size={14} /> Active project trackers
      </button>
      <button
        type="button"
        className={section === "setup" ? "selected" : ""}
        onClick={() => setSection("setup")}
      >
        <FolderCog size={14} /> Enable staff timesheets
      </button>
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
                  {source.source_code} · {source.source_name}
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
            Charge-out spend
            <input
              inputMode="decimal"
              value={allocation.chargeOutSpend}
              onChange={(event) => update("chargeOutSpend", event.target.value)}
            />
          </label>
          <label>
            Internal cost
            <input
              inputMode="decimal"
              value={allocation.internalCost}
              onChange={(event) => update("internalCost", event.target.value)}
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
