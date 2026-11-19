"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownUp, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import {
  inferTimesheetColumnMap,
  mapRawTimesheetRows,
  TIMESHEET_IMPORT_FIELDS,
} from "../lib/projectTimesheetImport";

const fieldByKey = new Map(TIMESHEET_IMPORT_FIELDS.map((field) => [field.key, field]));
const mappingRequired = ["workDate", "staffName", "hours", "activityCategory"];

function rowState(row) {
  if (row.issues?.some((item) => item.code.startsWith("duplicate_"))) return "duplicate";
  return row.isImportable ? "ready" : "review";
}

export default function AdminTimesheetImporter({ session, onClose, onImported }) {
  const [fileInfo, setFileInfo] = useState(null);
  const [mapping, setMapping] = useState({});
  const [inputRows, setInputRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [done, setDone] = useState(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);
  const missingMappings = mappingRequired.filter((key) => mapping[key] === "" || mapping[key] === undefined || mapping[key] === null);
  const hasProjectMapping = [mapping.projectName, mapping.projectNumber].some((value) => value !== "" && value !== undefined && value !== null);
  const mappingReady = !missingMappings.length && hasProjectMapping;

  const uploadFile = async (file) => {
    if (!file) return;
    setBusy("upload");
    setError("");
    setPreview(null);
    setDone(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/project-tracker-timesheet-import", { method: "POST", headers, body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not read the timesheet file.");
      const nextMapping = inferTimesheetColumnMap(body.headers || []);
      setFileInfo(body);
      setMapping(nextMapping);
      setInputRows([]);
    } catch (uploadError) {
      setError(uploadError.message || "Could not read the timesheet file.");
    } finally {
      setBusy("");
    }
  };

  const requestPreview = async (rows) => {
    setBusy("preview");
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-timesheet-import", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", rows, fileName: fileInfo?.fileName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not validate the mapped timesheets.");
      setPreview(body);
      setInputRows(body.rows || rows);
    } catch (previewError) {
      setError(previewError.message || "Could not validate the mapped timesheets.");
    } finally {
      setBusy("");
    }
  };

  const makePreview = () => {
    if (!fileInfo) return;
    if (!mappingReady) {
      const missing = missingMappings.map((key) => fieldByKey.get(key)?.label || key);
      if (!hasProjectMapping) missing.push("Project name or project number");
      setError(`Map these fields before previewing: ${[...new Set(missing)].join(", ")}.`);
      return;
    }
    const rows = mapRawTimesheetRows(fileInfo.rawRows || [], mapping);
    setInputRows(rows);
    requestPreview(rows);
  };

  const updateRow = (sourceRow, patch) => {
    const current = preview?.rows || inputRows;
    const next = current.map((row) => row.sourceRow === sourceRow ? { ...row, ...patch } : row);
    setInputRows(next);
    requestPreview(next);
  };

  const importRows = async () => {
    const rows = (preview?.rows || []).filter((row) => row.isImportable);
    if (!rows.length) return;
    setBusy("import");
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-timesheet-import", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", rows, fileName: fileInfo?.fileName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.preview) {
          setPreview(body.preview);
          setInputRows(body.preview.rows || []);
        }
        throw new Error(body.error || "Could not import the reviewed entries.");
      }
      setDone(body);
      await onImported?.(body);
    } catch (importError) {
      setError(importError.message || "Could not import the reviewed entries.");
    } finally {
      setBusy("");
    }
  };

  const visibleRows = useMemo(() => {
    const rows = [...(preview?.rows || [])].filter((row) => filter === "all" || rowState(row) === filter);
    const comparators = {
      date: (a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")) || a.sourceRow - b.sourceRow,
      staff: (a, b) => String(a.staffLabel || a.staffName || "").localeCompare(String(b.staffLabel || b.staffName || "")) || a.sourceRow - b.sourceRow,
      project: (a, b) => String(a.projectLabel || a.projectName || "").localeCompare(String(b.projectLabel || b.projectName || "")) || a.sourceRow - b.sourceRow,
      row: (a, b) => a.sourceRow - b.sourceRow,
    };
    rows.sort(comparators[sortBy] || comparators.date);
    return rows;
  }, [filter, preview?.rows, sortBy]);

  const projectOptions = preview?.projectOptions || [];
  const staffOptions = preview?.staffOptions || [];
  const summary = preview?.summary;

  return (
    <section className="ati-panel" aria-label="Bulk timesheet import">
      <header className="ati-panel__head">
        <div><span className="apt-kicker">Administrator import</span><h4><FileSpreadsheet size={18} /> Weekly timesheet upload</h4><p>Map and review the source rows first. Only validated, non-duplicate rows are written to active Project Trackers.</p></div>
        <button type="button" className="ati-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Close timesheet import"><X size={16} /></button>
      </header>

      {error ? <div className="ati-alert" role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}
      {done ? (
        <div className="ati-success" role="status"><CheckCircle2 size={18} /><div><strong>Timesheet import complete</strong><span>{done.importedCount} entries · {Number(done.totalHours || 0).toLocaleString("en-AU", { maximumFractionDigits: 2 })} hours · {Number(done.totalKilometres || 0).toLocaleString("en-AU", { maximumFractionDigits: 2 })} km</span><small>Updated {done.allocationsRecalculated} project allocation totals. Staff were notified.</small></div></div>
      ) : null}

      <div className="ati-steps" aria-label="Import steps"><span className={fileInfo ? "complete" : "current"}>1. Upload</span><span className={fileInfo ? "current" : ""}>2. Map &amp; review</span><span className={done ? "complete" : preview?.summary?.ready ? "current" : ""}>3. Import</span></div>

      <div className="ati-upload-row">
        <label className="ati-file-button"><Upload size={15} /> {busy === "upload" ? "Reading file…" : fileInfo ? "Choose another file" : "Choose CSV or Excel file"}<input key={fileInputKey} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={Boolean(busy)} onChange={(event) => uploadFile(event.target.files?.[0])} /></label>
        {fileInfo ? <span className="ati-file-name">{fileInfo.fileName} · {fileInfo.sheetName} · {fileInfo.rawRows?.length || 0} rows</span> : <span className="ati-help">CSV, XLSX or XLS · up to 10 MB and 1,000 data rows</span>}
        {fileInfo ? <button type="button" className="ati-reset" disabled={Boolean(busy)} onClick={() => { setFileInfo(null); setPreview(null); setInputRows([]); setDone(null); setError(""); setFileInputKey((current) => current + 1); }}>Start over</button> : null}
      </div>

      {fileInfo && !done ? (
        <>
          <div className="ati-mapping" aria-label="Map uploaded columns">
            <div className="ati-section-title"><div><strong>Map the source columns</strong><small>Detected headers are preselected when possible. Project name or number is required.</small></div><button type="button" className="ati-primary" onClick={makePreview} disabled={Boolean(busy) || !mappingReady}><ArrowDownUp size={14} /> {busy === "preview" ? "Checking rows…" : "Preview changes"}</button></div>
            <div className="ati-map-grid">
              {TIMESHEET_IMPORT_FIELDS.map((field) => (
                <label key={field.key} className="ati-map-field">{field.label}{field.required ? <b aria-label="required"> *</b> : null}
                  <select value={mapping[field.key] === "" || mapping[field.key] === undefined ? "" : String(mapping[field.key])} disabled={Boolean(busy)} onChange={(event) => { setPreview(null); setInputRows([]); setMapping((current) => ({ ...current, [field.key]: event.target.value === "" ? "" : Number(event.target.value) })); }}>
                    <option value="">Not mapped</option>
                    {(fileInfo.headers || []).map((header, index) => <option value={index} key={`${index}-${header}`}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          {preview ? (
            <div className="ati-review">
              <div className="ati-summary" aria-label="Import preview summary">
                <Metric label="Ready to import" value={summary?.ready || 0} tone="ready" />
                <Metric label="Needs review" value={summary?.needsReview || 0} tone="review" />
                <Metric label="Duplicates" value={summary?.duplicates || 0} tone="duplicate" />
                <Metric label="Ready hours" value={`${Number(summary?.totalHours || 0).toLocaleString("en-AU", { maximumFractionDigits: 2 })} h`} />
                <Metric label="Ready kilometres" value={`${Number(summary?.totalKm || 0).toLocaleString("en-AU", { maximumFractionDigits: 2 })} km`} />
              </div>
              <div className="ati-review-controls">
                <label>Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All rows</option><option value="ready">Ready</option><option value="review">Needs review</option><option value="duplicate">Duplicates</option></select></label>
                <label>Sort by<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="date">Work date</option><option value="staff">Staff name</option><option value="project">Project name</option><option value="row">Source row</option></select></label>
                <span>{visibleRows.length} shown of {summary?.total || 0}</span>
                <button type="button" className="ati-primary" onClick={importRows} disabled={Boolean(busy) || !summary?.ready}>{busy === "import" ? <><Loader2 size={14} className="spin" /> Importing…</> : <><CheckCircle2 size={14} /> Import {summary?.ready || 0} entries</>}</button>
              </div>
              <div className="ati-table-wrap">
                <table className="ati-table">
                  <thead><tr><th>Row</th><th>Date</th><th>Staff — resolve if needed</th><th>Project — resolve if needed</th><th>Category</th><th>Budget source / allocation</th><th>Hours</th><th>Km</th><th>Comments</th><th>Review</th></tr></thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const state = rowState(row);
                      const projectValue = row.projectId || "";
                      const projectOption = projectOptions.find((project) => project.id === projectValue);
                      const categories = projectOption?.categoryOptions?.length ? projectOption.categoryOptions : row.categoryOptions || [];
                      return (
                        <tr key={row.sourceRow} className={`ati-row ati-row--${state}`}>
                          <td>#{row.sourceRow}</td>
                          <td>{row.workDate || <span className="ati-missing">Invalid date</span>}</td>
                          <td><select aria-label={`Staff for source row ${row.sourceRow}`} value={row.staffUserId || ""} disabled={Boolean(busy)} onChange={(event) => updateRow(row.sourceRow, { staffUserId: event.target.value })}><option value="">Choose staff…</option>{staffOptions.map((person) => <option value={person.id} key={person.id}>{person.name}{person.email ? ` · ${person.email}` : ""}</option>)}</select><small>{row.staffName}</small></td>
                          <td><select aria-label={`Project for source row ${row.sourceRow}`} value={projectValue} disabled={Boolean(busy)} onChange={(event) => updateRow(row.sourceRow, { projectId: event.target.value, budgetAllocationId: "" })}><option value="">Choose active project…</option>{projectOptions.map((project) => <option value={project.id} key={project.id}>{project.name}{project.projectNumbers?.length ? ` · ${project.projectNumbers.join(", ")}` : ""}{project.clientName ? ` · ${project.clientName}` : ""}</option>)}</select><small>{row.projectName || row.projectNumber || row.clientName || "Project not supplied"}</small></td>
                          <td><select aria-label={`Activity category for source row ${row.sourceRow}`} value={categories.find((category) => category === row.activityCategory) || ""} disabled={Boolean(busy) || !categories.length} onChange={(event) => updateRow(row.sourceRow, { activityCategory: event.target.value, budgetAllocationId: "" })}><option value="">Choose category…</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><small>{row.activityCategory && !categories.includes(row.activityCategory) ? `Source: ${row.activityCategory}` : ""}</small></td>
                          <td><select aria-label={`Budget allocation for source row ${row.sourceRow}`} value={(row.allocationOptions || []).some((option) => option.id === row.budgetAllocationId) ? row.budgetAllocationId : ""} disabled={Boolean(busy) || !row.allocationOptions?.length} onChange={(event) => updateRow(row.sourceRow, { budgetAllocationId: event.target.value })}><option value="">Choose budget allocation…</option>{(row.allocationOptions || []).map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select><small>{row.allocationOptions?.length > 1 ? "Explicit source choice required" : "Approved work-date budget"}</small></td>
                          <td>{row.hours ?? "—"}</td>
                          <td>{row.km ?? "—"}</td>
                          <td className="ati-comment">{row.comments || <span className="ati-muted">No comment supplied</span>}</td>
                          <td><span className={`ati-badge ati-badge--${state}`}>{state === "ready" ? "Ready" : state === "duplicate" ? "Duplicate" : "Review"}</span>{row.issues?.map((item, index) => <small className="ati-issue" key={`${item.code}-${index}`}>{item.message}</small>)}{row.warnings?.map((warning, index) => <small className="ati-warning" key={`warning-${index}`}>{warning}</small>)}</td>
                        </tr>
                      );
                    })}
                    {!visibleRows.length ? <tr><td colSpan="10" className="ati-empty">No rows match this filter.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <p className="ati-footnote">Imported entries are marked completed and administrator-entered. Kilometres are retained for reference and do not change project budget calculations. Budget availability is recalculated from the imported hours and staff rate.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value, tone = "" }) {
  return <div className={`ati-metric ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}
