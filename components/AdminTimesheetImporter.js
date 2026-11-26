"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownUp, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import {
  inferTimesheetColumnMap,
  mapRawTimesheetRows,
  TIMESHEET_IMPORT_FIELDS,
  timesheetImportCategoryOptions,
} from "../lib/projectTimesheetImport";

const fieldByKey = new Map(TIMESHEET_IMPORT_FIELDS.map((field) => [field.key, field]));
const mappingRequired = ["workDate", "staffName", "hours", "activityCategory"];
const identityFields = ["projectId", "activityCategory", "staffUserId", "workDate", "budgetAllocationId", "budgetAssignment"];
const numberFormatter = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
const chargeFormatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function isExactDuplicate(row) {
  return row.issues?.some((item) => /^(duplicate_(existing|file|exact)(?:_|$)|exact_duplicate)/.test(item.code || "")) || false;
}

function hasPossibleOverlap(row) {
  return Boolean(row.possibleDuplicates?.length || row.fileOverlaps?.length);
}

function isExcluded(row) {
  return isExactDuplicate(row) || row.isSkipped || row.duplicateDecision === "skip" || (hasPossibleOverlap(row) && row.duplicateDecision !== "separate");
}

function rowState(row) {
  if (isExactDuplicate(row)) return "duplicate";
  if (isExcluded(row)) return "excluded";
  return row.isImportable ? "ready" : "review";
}

function reviewValues(row, drafts) {
  return drafts[row.sourceRow] || { decision: row.duplicateDecision || "skip", reason: row.duplicateReason || "" };
}

function reviewIsPending(row, drafts) {
  if (isExactDuplicate(row) || !hasPossibleOverlap(row) || !drafts[row.sourceRow]) return false;
  const draft = reviewValues(row, drafts);
  return draft.decision !== (row.duplicateDecision || "skip") || (draft.decision === "separate" && draft.reason.trim() !== String(row.duplicateReason || "").trim());
}

function hasSubstantiveReason(reason) {
  return String(reason || "").trim().length >= 10 && /[\p{L}\p{N}]/u.test(reason || "");
}

function formatNumber(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "—" : numberFormatter.format(Number(value));
}

function formatCharge(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "—" : chargeFormatter.format(Number(value));
}

function sourceValue(value) {
  return value === null || value === undefined || value === "" ? "Not supplied" : String(value);
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString("en-AU") : "Not supplied";
}

function inputRowPayload(row) {
  const keys = ["sourceRow", "workDate", "staffName", "staffUserId", "clientName", "projectName", "projectNumber", "projectId", "budgetAssignment", "budgetSourceId", "budgetAllocationId", "hours", "expenses", "km", "vehicle", "activityCategory", "sourceTask", "comments", "duplicateDecision", "duplicateReason", "duplicateReviewToken", "chargeRate", "mileageChargeRate"];
  const payload = Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
  if (payload.budgetAssignment === "unassigned") {
    payload.budgetSourceId = null;
    payload.budgetAllocationId = null;
  }
  return payload;
}

function patchImportRow(row, patch) {
  const next = { ...row, ...patch };
  const identityChanged = ["projectId", "activityCategory", "staffUserId", "workDate"].some((field) => Object.prototype.hasOwnProperty.call(patch, field));
  if (next.budgetAssignment === "unassigned") {
    next.budgetSourceId = null;
    next.budgetAllocationId = null;
  } else if (identityChanged) {
    next.budgetAssignment = "";
    next.budgetSourceId = "";
    next.budgetAllocationId = "";
  } else if (Object.prototype.hasOwnProperty.call(patch, "budgetAllocationId") || Object.prototype.hasOwnProperty.call(patch, "budgetAssignment")) {
    next.budgetSourceId = patch.budgetSourceId || "";
    next.budgetAllocationId = patch.budgetAllocationId || "";
    next.budgetAssignment = next.budgetAllocationId ? "assigned" : "";
  }
  if (identityFields.some((field) => Object.prototype.hasOwnProperty.call(patch, field))) {
    const staySkipped = row.isSkipped || row.duplicateDecision === "skip";
    next.duplicateDecision = staySkipped ? "skip" : "";
    next.duplicateReason = "";
    next.duplicateReviewToken = "";
    next.isSkipped = Boolean(staySkipped);
  }
  return next;
}

export default function AdminTimesheetImporter({ session, onClose, onImported }) {
  const [fileInfo, setFileInfo] = useState(null);
  const [mapping, setMapping] = useState({});
  const [inputRows, setInputRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewValidated, setPreviewValidated] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [done, setDone] = useState(null);
  const operationInFlight = useRef(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);
  const sourceRows = useMemo(() => mapRawTimesheetRows(fileInfo?.rawRows || [], mapping), [fileInfo, mapping]);
  const sourceByRow = useMemo(() => new Map(sourceRows.map((row) => [row.sourceRow, row])), [sourceRows]);
  const missingMappings = mappingRequired.filter((key) => mapping[key] === "" || mapping[key] === undefined || mapping[key] === null);
  const hasProjectMapping = [mapping.projectName, mapping.projectNumber].some((value) => value !== "" && value !== undefined && value !== null);
  const mappingReady = !missingMappings.length && hasProjectMapping;
  const summary = preview?.summary;
  const unresolvedCount = summary?.unresolved ?? (preview?.rows || []).filter((row) => !row.isImportable && !isExcluded(row)).length;
  const pendingReviewCount = (preview?.rows || []).filter((row) => reviewIsPending(row, reviewDrafts)).length;
  const canImport = previewValidated && Boolean(summary?.ready) && !unresolvedCount && !pendingReviewCount && !busy && !done;

  const uploadFile = async (file) => {
    if (!file || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy("upload");
    setError("");
    setPreview(null);
    setPreviewValidated(false);
    setReviewDrafts({});
    setDone(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/project-tracker-timesheet-import", { method: "POST", headers, body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not read the timesheet file.");
      setFileInfo(body);
      setMapping(inferTimesheetColumnMap(body.headers || []));
      setInputRows([]);
    } catch (uploadError) {
      setError(uploadError.message || "Could not read the timesheet file.");
    } finally {
      operationInFlight.current = false;
      setBusy("");
    }
  };

  const requestPreview = async (rows) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy("preview");
    setPreviewValidated(false);
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-timesheet-import", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", rows: rows.map(inputRowPayload), fileName: fileInfo?.fileName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not validate the mapped timesheets.");
      setPreview(body);
      setInputRows(body.rows || rows);
      setPreviewValidated(true);
    } catch (previewError) {
      setError(previewError.message || "Could not validate the mapped timesheets.");
    } finally {
      operationInFlight.current = false;
      setBusy("");
    }
  };

  const makePreview = () => {
    if (!fileInfo || operationInFlight.current) return;
    if (!mappingReady) {
      const missing = missingMappings.map((key) => fieldByKey.get(key)?.label || key);
      if (!hasProjectMapping) missing.push("Project name or project number");
      setError(`Map these fields before previewing: ${[...new Set(missing)].join(", ")}.`);
      return;
    }
    // Rechecking the same mapping must not discard row resolutions or review reasons.
    const rows = inputRows.length ? inputRows : sourceRows;
    setInputRows(rows);
    requestPreview(rows);
  };

  // `sourceRow` may be a single source row number or "all" (whole-column change).
  const updateRow = (sourceRow, patch) => {
    if (operationInFlight.current) return;
    const current = preview?.rows || inputRows;
    const resetsReview = identityFields.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    const affects = (row) => sourceRow === "all" || row.sourceRow === sourceRow;
    const next = current.map((row) => affects(row) ? patchImportRow(row, patch) : row);
    if (resetsReview) {
      setReviewDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        current.filter(affects).forEach((row) => { delete nextDrafts[row.sourceRow]; });
        return nextDrafts;
      });
    }
    setInputRows(next);
    setPreview((currentPreview) => currentPreview ? { ...currentPreview, rows: next } : currentPreview);
    requestPreview(next);
  };

  const updateReviewDraft = (row, patch) => {
    setReviewDrafts((drafts) => ({ ...drafts, [row.sourceRow]: { ...reviewValues(row, drafts), ...patch } }));
  };

  const applyReviewDecision = (row) => {
    if (isExactDuplicate(row) || operationInFlight.current) return;
    const draft = reviewValues(row, reviewDrafts);
    if (draft.decision === "separate" && (!hasSubstantiveReason(draft.reason) || !row.duplicateReviewToken)) return;
    updateRow(row.sourceRow, {
      duplicateDecision: draft.decision,
      duplicateReason: draft.reason.trim(),
      duplicateReviewToken: row.duplicateReviewToken || "",
      isSkipped: draft.decision === "skip",
    });
  };

  const importRows = async () => {
    const rows = preview?.rows || [];
    // The API atomically validates the full review, including explicitly excluded rows.
    if (!canImport || !rows.length || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy("import");
    setError("");
    try {
      const response = await fetch("/api/admin/project-tracker-timesheet-import", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", rows: rows.map(inputRowPayload), fileName: fileInfo?.fileName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.preview) {
          setPreview(body.preview);
          setInputRows(body.preview.rows || []);
          setPreviewValidated(true);
          // Keep local reasons so a refreshed conflict can be reviewed and reapplied.
        } else {
          setPreviewValidated(false);
        }
        throw new Error(body.error || "Could not import the reviewed entries.");
      }
      setDone(body);
      await onImported?.(body);
    } catch (importError) {
      setError(importError.message || "Could not import the reviewed entries.");
    } finally {
      operationInFlight.current = false;
      setBusy("");
    }
  };

  const visibleRows = useMemo(() => {
    const rows = [...(preview?.rows || [])].filter((row) => {
      if (filter === "all") return true;
      if (filter === "possible") return hasPossibleOverlap(row) && !isExactDuplicate(row);
      if (filter === "excluded") return isExcluded(row);
      return rowState(row) === filter;
    });
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
  const allProjectCategories = projectOptions.flatMap((project) => project.categoryOptions || []);
  const reviewRows = (preview?.rows || []).filter((row) => row.issues?.length || row.warnings?.length || isExcluded(row) || reviewIsPending(row, reviewDrafts));

  return (
    <section className="ati-panel" aria-label="Bulk timesheet import" aria-busy={Boolean(busy)}>
      <header className="ati-panel__head">
        <div><span className="apt-kicker">Administrator import</span><h4><FileSpreadsheet size={18} /> Weekly timesheet upload</h4><p>Map the source columns, reconcile weekly hours, and include or skip every row before importing new entries to active Project Trackers.</p></div>
        <button type="button" className="ati-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Close timesheet import"><X size={16} /></button>
      </header>

      <div className="ati-safety-notice"><AlertTriangle size={18} aria-hidden="true" /><div><strong>No existing tracker entries will be overwritten.</strong><p>Skip uploaded corrections and use the audited tracker editor to correct the existing entry. Exact duplicates are always blocked. Only genuinely separate work may be imported after reviewing an overlap and recording a substantive reason.</p></div></div>
      {error ? <div className="ati-alert" role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}
      {done ? (
        <div className="ati-success" role="status"><CheckCircle2 size={18} /><div><strong>Timesheets approved and uploaded</strong><span>{done.importedCount} entries uploaded · {done.skippedCount || 0} skipped · {formatNumber(done.totalHours || 0)} hours · {formatNumber(done.totalKilometres || 0)} km</span><span>{formatCharge(done.labourCharge || 0)} labour + {formatCharge(done.mileageCharge || 0)} mileage</span><small>Updated {done.allocationsRecalculated} allocation totals and refreshed project budget and hours remaining. Staff were notified. Unassigned hours and costs count in project-level actuals, without charging an individual allocation. Expenses and vehicle values remain references.</small></div></div>
      ) : null}

      <div className="ati-steps" aria-label="Import steps"><span className={fileInfo ? "complete" : "current"}>1. Import file</span><span className={fileInfo ? "current" : ""}>2. Review &amp; adjust</span><span className={done ? "complete" : canImport ? "current" : ""}>3. Approve &amp; upload</span></div>

      <div className="ati-upload-row">
        <label className="ati-file-button"><Upload size={15} /> {busy === "upload" ? "Reading file…" : fileInfo ? "Choose another file" : "Choose CSV or Excel file"}<input key={fileInputKey} type="file" aria-label="Upload CSV or Excel timesheet" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={Boolean(busy)} onChange={(event) => uploadFile(event.target.files?.[0])} /></label>
        {fileInfo ? <span className="ati-file-name">{fileInfo.fileName} · {fileInfo.sheetName} · {fileInfo.rawRows?.length || 0} rows</span> : <span className="ati-help">CSV, XLSX or XLS · up to 10 MB and 1,000 data rows</span>}
        {fileInfo ? <button type="button" className="ati-reset" disabled={Boolean(busy)} onClick={() => { setFileInfo(null); setPreview(null); setPreviewValidated(false); setReviewDrafts({}); setInputRows([]); setDone(null); setError(""); setFileInputKey((current) => current + 1); }}>Start over</button> : null}
      </div>

      {fileInfo && !done ? (
        <>
          <div className="ati-mapping" aria-label="Map uploaded columns">
            <div className="ati-section-title"><div><strong>Map the source columns</strong><small>Detected headers are preselected when possible. Job# is the primary project match; Client job and Client are verification references. Unknown or duplicate numbers require an explicit project choice. Files without Job# may match a unique project name. Expenses and vehicle are optional references only.</small></div><button type="button" className="ati-primary" onClick={makePreview} disabled={Boolean(busy) || !mappingReady}><ArrowDownUp size={14} /> {busy === "preview" ? "Checking rows…" : "Preview changes"}</button></div>
            <div className="ati-map-grid">
              {TIMESHEET_IMPORT_FIELDS.map((field) => (
                <label key={field.key} className="ati-map-field">{field.label}{field.required ? <b aria-label="required"> *</b> : null}
                  <select value={mapping[field.key] === "" || mapping[field.key] === undefined || mapping[field.key] === null ? "" : String(mapping[field.key])} disabled={Boolean(busy)} onChange={(event) => { setPreview(null); setPreviewValidated(false); setReviewDrafts({}); setInputRows([]); setMapping((current) => ({ ...current, [field.key]: event.target.value === "" ? "" : Number(event.target.value) })); }}>
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
                <Metric label="Possible overlaps" value={summary?.possibleDuplicates || 0} tone="review" />
                <Metric label="Excluded rows" value={summary?.excluded || 0} />
                <Metric label="Unresolved rows" value={unresolvedCount} tone="review" />
                <Metric label="Ready hours" value={`${formatNumber(summary?.totalHours || 0)} h`} />
                <Metric label="Unassigned rows" value={summary?.unassigned || 0} />
                <Metric label="Unassigned ready rows" value={summary?.unassignedReady || 0} />
                <Metric label="Unassigned ready hours" value={`${formatNumber(summary?.unassignedReadyHours || 0)} h`} />
                <Metric label="Ready kilometres" value={`${formatNumber(summary?.totalKm || 0)} km`} />
                <Metric label="Total charges (labour + mileage)" value={formatCharge(summary?.totalCharge || 0)} tone="ready" />
              </div>

              <Reconciliation summary={summary} groups={preview.reconciliation || []} />
              <p className="ati-rate-card-guidance">Rates come from the confirmed rate card for this job; configure them in Project Operations → Charge-out Rates. Company role rates are suggestions, not guaranteed charges. Rows without a confirmed job rate card must be resolved or skipped.</p>
              <p className="ati-safety-notice">No budget assignment is an explicit reviewed choice, not a blank selection. These hours and costs are included in project-level actuals and remaining totals; individual budgets are unchanged by unassigned rows. Approved Task mappings apply only to new imports, preserving original Task and Notes; existing templates and historical categories are not renamed.</p>

              <div className="ati-validation-status" role="status" aria-live="polite">
                {busy === "preview" ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Validating the full review… Approval is disabled until checking finishes.</> : !previewValidated ? "This review is not currently validated. Select Preview changes to recheck before approving." : pendingReviewCount ? `${pendingReviewCount} unapplied overlap review decision${pendingReviewCount === 1 ? "" : "s"}. Apply each decision before approving.` : unresolvedCount ? `${unresolvedCount} unresolved row${unresolvedCount === 1 ? "" : "s"}. Resolve the highlighted fields or explicitly choose Skip for every invalid or unmatched row.` : "Review complete. Adjust any row if needed, then select Approve & upload timesheets. Only included, ready rows are saved; excluded rows remain unchanged."}
              </div>
              <div className="ati-review-controls">
                <label>Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All rows</option><option value="ready">Ready</option><option value="review">Needs resolution</option><option value="possible">Possible overlaps</option><option value="duplicate">Exact duplicates</option><option value="excluded">Excluded / skipped</option></select></label>
                <label>Sort by<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="date">Work date</option><option value="staff">Staff name</option><option value="project">Project name</option><option value="row">Source row</option></select></label>
                <span>{visibleRows.length} shown of {summary?.total ?? preview.rows?.length ?? 0}</span>
                <button type="button" className="ati-primary" onClick={importRows} disabled={!canImport} aria-describedby="ati-import-guidance">{busy === "import" ? <><Loader2 size={14} className="spin" /> Uploading…</> : <><CheckCircle2 size={14} /> Approve &amp; upload timesheets</>}</button>
              </div>
              <div className="ati-table-wrap" role="region" aria-label="Scrollable timesheet row review" tabIndex={0}>
                <table className="ati-table">
                  <caption className="ati-visually-hidden">Uploaded timesheet rows and labour plus configured mileage charges. Flagged items and decisions are below the table.</caption>
                  <thead><tr><th scope="col">Row</th><th scope="col">Date</th><th scope="col">Staff — resolve if needed</th><th scope="col">Project — resolve if needed<small className="ati-column-note">Choosing a project applies it to every row</small></th><th scope="col">Category</th><th scope="col">Budget source / allocation</th><th scope="col">Hours</th><th scope="col">Km</th><th scope="col">Role / charge-out rates</th><th scope="col">Line charge</th></tr></thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const state = rowState(row);
                      const source = sourceByRow.get(row.sourceRow) || row;
                      const projectValue = row.projectId || "";
                      const projectOption = projectOptions.find((project) => project.id === projectValue);
                      // Same full list on every row: the chosen project's categories, otherwise every
                      // active project's categories, plus the mapped targets and the row's current value.
                      const categories = timesheetImportCategoryOptions([
                        ...(projectOption ? projectOption.categoryOptions || [] : allProjectCategories),
                        ...(row.categoryOptions || []),
                        ...(row.activityCategory ? [row.activityCategory] : []),
                      ]);
                      const originalTask = row.sourceTask || source.sourceTask || source.activityCategory;
                      return (
                        <tr key={row.sourceRow} className={`ati-row ati-row--${state}`}>
                          <td>#{row.sourceRow}<small>{state === "ready" ? row.budgetAssignment === "unassigned" ? "Ready · unassigned" : "Ready" : state === "duplicate" ? "Exact duplicate · skipped" : state === "excluded" ? "Excluded" : "Needs review"}</small></td>
                          <td><input key={`${row.sourceRow}-${row.workDate || ""}`} className="ati-date-input" type="date" aria-label={`Work date for source row ${row.sourceRow}`} defaultValue={/^\d{4}-\d{2}-\d{2}$/.test(row.workDate || "") ? row.workDate : ""} disabled={Boolean(busy)} onBlur={(event) => { if (event.target.value !== (row.workDate || "")) updateRow(row.sourceRow, { workDate: event.target.value, budgetAllocationId: "" }); }} />{!row.workDate ? <small className="ati-missing">Invalid date — resolve or skip</small> : null}<small>Source: {sourceValue(source.workDate)}</small></td>
                          <td><select aria-label={`Staff for source row ${row.sourceRow}`} value={row.staffUserId || ""} disabled={Boolean(busy)} onChange={(event) => updateRow(row.sourceRow, { staffUserId: event.target.value, budgetAllocationId: "" })}><option value="">Choose staff…</option>{staffOptions.map((person) => <option value={person.id} key={person.id}>{person.name}{person.email ? ` · ${person.email}` : ""}</option>)}</select><small>Source: {sourceValue(source.staffName)}</small></td>
                          <td><select aria-label={`Project for source row ${row.sourceRow}`} value={projectValue} disabled={Boolean(busy)} onChange={(event) => updateRow("all", { projectId: event.target.value, budgetAllocationId: "" })}><option value="">Choose active project…</option>{projectOptions.map((project) => <option value={project.id} key={project.id}>{project.name}{project.projectNumbers?.length ? ` · ${project.projectNumbers.join(", ")}` : ""}{project.clientName ? ` · ${project.clientName}` : ""}</option>)}</select><small>Source: {sourceValue(source.projectName || source.projectNumber || source.clientName)}</small></td>
                          <td><select aria-label={`Activity category for source row ${row.sourceRow}`} value={categories.find((category) => category === row.activityCategory) || ""} disabled={Boolean(busy) || !categories.length} onChange={(event) => updateRow(row.sourceRow, { activityCategory: event.target.value, budgetAllocationId: "" })}><option value="">Choose category…</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select>{originalTask && originalTask !== row.activityCategory ? <small className="ati-original-task">Original Task: {originalTask}</small> : row.activityCategory && !categories.includes(row.activityCategory) ? <small>Source: {row.activityCategory}</small> : null}</td>
                          <td><select aria-label={`Budget allocation for source row ${row.sourceRow}`} value={row.budgetAssignment === "unassigned" ? "unassigned" : (row.allocationOptions || []).some((option) => option.id === row.budgetAllocationId) ? row.budgetAllocationId : ""} disabled={Boolean(busy)} onChange={(event) => updateRow(row.sourceRow, { budgetAssignment: event.target.value === "unassigned" ? "unassigned" : event.target.value ? "assigned" : "", budgetAllocationId: event.target.value === "unassigned" ? null : event.target.value })}><option value="">Choose budget allocation…</option><option value="unassigned">No budget assignment</option>{(row.allocationOptions || []).map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select><small>{row.budgetAssignment === "unassigned" ? "Unassigned · project-level actuals only" : row.allocationOptions?.length === 1 ? "Approved work-date budget" : "Choose an eligible allocation or No budget assignment"}</small></td>
                          <td className="ati-numeric">{formatNumber(row.hours)}</td>
                          <td className="ati-numeric">{formatNumber(row.km)}</td>
                          <td className="ati-charge-cell"><strong>{row.chargeRole || "Role unresolved"}</strong><span>{formatCharge(row.chargeRate)} / hour</span>{Number(row.km) > 0 ? <small>Mileage: {formatCharge(row.mileageChargeRate)} / km</small> : null}<small>Administrator-only · confirmed job rate card</small>{row.issues?.some((item) => ["missing_project_rates", "missing_mileage_rate"].includes(item.code)) ? <small className="ati-issue">Configure this job in Project Operations → Charge-out Rates, then recheck or skip.</small> : null}</td>
                          <td className="ati-charge-cell ati-numeric"><strong>{formatCharge(row.chargeAmount)}</strong>{isExcluded(row) ? <small>Excluded from totals</small> : <small>{Number(row.km) > 0 ? "Labour + mileage" : "Labour only"}</small>}</td>
                        </tr>
                      );
                    })}
                    {!visibleRows.length ? <tr><td colSpan="10" className="ati-empty">No rows match this filter.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              {reviewRows.length ? (
                <section className="ati-reconciliation" aria-label="Items requiring review">
                  <div className="ati-section-title"><strong>Items requiring review</strong><span>{reviewRows.length} flagged or excluded rows</span></div>
                  {reviewRows.map((row) => {
                    const state = rowState(row);
                    const exactDuplicate = isExactDuplicate(row);
                    const possibleOverlap = hasPossibleOverlap(row) && !exactDuplicate;
                    const draft = reviewValues(row, reviewDrafts);
                    const pending = reviewIsPending(row, reviewDrafts);
                    const separateReasonValid = hasSubstantiveReason(draft.reason);
                    const source = sourceByRow.get(row.sourceRow) || row;
                    return (
                      <details className="ati-comparison" key={row.sourceRow} open={state === "review" || pending}>
                        <summary>Row #{row.sourceRow} · {row.staffLabel || row.staffName} · {row.projectLabel || row.projectName} · {state === "duplicate" ? "Exact duplicate — skipped" : state === "excluded" ? "Excluded / skipped" : state === "review" ? "Needs resolution" : "Verify source warnings"}</summary>
                        <div className="ati-comparison-body">
                          {row.issues?.map((item, index) => <p className="ati-issue" key={`${item.code}-${index}`}>{item.message}</p>)}
                          {row.warnings?.map((warning, index) => <p className="ati-warning" key={`warning-${index}`}>{warning}</p>)}
                          <div className="ati-decision-cell">
                            {exactDuplicate ? <><select aria-label={`Import decision for source row ${row.sourceRow}: exact duplicate always skipped`} value="skip" disabled><option value="skip">Skipped — exact duplicate</option></select><small className="ati-issue">Cannot override. Skip corrections and use the audited tracker editor.</small></> : possibleOverlap ? <>
                              <label className="ati-review-label" htmlFor={`ati-decision-${row.sourceRow}`}>Possible overlap</label>
                              <select id={`ati-decision-${row.sourceRow}`} aria-label={`Overlap decision for source row ${row.sourceRow}`} value={draft.decision} disabled={Boolean(busy)} onChange={(event) => updateReviewDraft(row, { decision: event.target.value })}><option value="skip">Skip (default)</option><option value="separate">Import as separate work</option></select>
                              {draft.decision === "separate" ? <div className="ati-reason-editor"><label htmlFor={`ati-reason-${row.sourceRow}`}>Why is this distinct work?</label><textarea id={`ati-reason-${row.sourceRow}`} value={draft.reason} disabled={Boolean(busy)} rows={3} maxLength={1000} placeholder="Describe the separate work, not a correction…" aria-describedby={`ati-reason-help-${row.sourceRow}`} aria-invalid={!separateReasonValid} onChange={(event) => updateReviewDraft(row, { reason: event.target.value })} /><small id={`ati-reason-help-${row.sourceRow}`}>A substantive reason of at least 10 characters and a current review are required. {draft.reason.trim().length} characters.</small>{!row.duplicateReviewToken ? <small className="ati-issue">Refresh the preview before approving separate work.</small> : null}</div> : <small>Will not create a new entry or alter existing work.</small>}
                              <button type="button" className="ati-apply-review" disabled={Boolean(busy) || (draft.decision === "separate" && (!separateReasonValid || !row.duplicateReviewToken))} onClick={() => applyReviewDecision(row)} aria-label={`Apply review decision for source row ${row.sourceRow}`}>Apply review decision</button>
                              {pending ? <small className="ati-warning">Draft not applied — import is disabled.</small> : row.duplicateDecision === "separate" ? <small>Separate-work decision validated{row.duplicateReason ? `: ${row.duplicateReason}` : ""}</small> : null}
                            </> : <><select aria-label={`Import decision for source row ${row.sourceRow}`} value={row.isSkipped || row.duplicateDecision === "skip" ? "skip" : "include"} disabled={Boolean(busy)} onChange={(event) => updateRow(row.sourceRow, { duplicateDecision: event.target.value === "skip" ? "skip" : "", isSkipped: event.target.value === "skip" })}><option value="include">Include</option><option value="skip">Skip</option></select><small>{isExcluded(row) ? "Explicitly excluded from this import" : row.isImportable ? "Validated for import" : "Resolve the fields in the main table or explicitly choose Skip"}</small></>}
                          </div>
                          <RowComparison row={row} source={source} sourceByRow={sourceByRow} />
                        </div>
                      </details>
                    );
                  })}
                </section>
              ) : null}
              <p id="ati-import-guidance" className="ati-footnote">Every invalid or unmatched row must be resolved or explicitly skipped. Possible overlaps are skipped by default; exact duplicates can never be imported. Changing staff, project, date, category, or budget source resets the overlap review and rechecks the row.</p>
              <p className="ati-footnote">Approve &amp; upload timesheets saves new completed, administrator-entered entries. Labour uses the reviewed job hourly rate; new kilometres use the configured job mileage rate, including an explicit zero for non-billable mileage. Missing mileage rates must be resolved before uploading positive kilometres. Assigned rows update allocation balances; all included rows update project actuals and remaining balances. Expenses and vehicle values remain references. Historical reference-only kilometres are not retrospectively charged. Existing entries are never overwritten; correct them through the audited tracker editor.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function RowComparison({ row, source, sourceByRow }) {
  const existing = row.possibleDuplicates || [];
  const peers = row.fileOverlaps || [];
  return (
    <details className="ati-comparison">
      <summary>View uploaded source{existing.length ? ` · ${existing.length} existing ${existing.length === 1 ? "entry" : "entries"}` : ""}{peers.length ? ` · ${peers.length} file ${peers.length === 1 ? "peer" : "peers"}` : ""}</summary>
      <div className="ati-comparison-body">
        <div className="ati-comparison-entry ati-comparison-entry--upload"><strong>Uploaded source · row #{row.sourceRow}</strong><EntryDetails date={source.workDate} staff={source.staffName} category={source.sourceTask || source.activityCategory} hours={source.hours} km={source.km} comments={source.comments} /><small>Client: {sourceValue(source.clientName)} · Job#: {sourceValue(source.projectNumber)} · Client job: {sourceValue(source.projectName)}</small><small>Expenses: {sourceValue(source.expenses)} · Vehicle: {sourceValue(source.vehicle)} · Not charged</small>{String(source.workDate ?? "") !== String(row.workDate ?? "") || (source.sourceTask || source.activityCategory) !== row.activityCategory ? <small>Reviewed date: {sourceValue(row.workDate)} · Canonical category: {sourceValue(row.activityCategory)}</small> : null}</div>
        {existing.map((entry, index) => <div className="ati-comparison-entry" key={entry.id || index}><strong>Existing tracker entry</strong><EntryDetails date={entry.workDate} staff={entry.staffLabel} category={entry.activityCategory} hours={entry.hours} km={entry.km} comments={entry.comments} /><small>Source: {entry.enteredByAdmin === true ? "Administrator-entered" : entry.enteredByAdmin === false ? "Staff-entered" : "Entry source not supplied"} · Updated: {formatUpdatedAt(entry.updatedAt)}</small></div>)}
        {peers.map((peer, index) => {
          const peerSource = sourceByRow.get(peer.sourceRow);
          return <div className="ati-comparison-entry" key={`${peer.sourceRow}-${index}`}><strong>Uploaded file peer · row #{peer.sourceRow}</strong><EntryDetails date={peerSource?.workDate || row.workDate} staff={peerSource?.staffName || row.staffLabel || row.staffName} category={peer.activityCategory} hours={peer.hours} km={peer.km} comments={peer.comments} /><small>Source: same uploaded file — review this row separately.</small></div>;
        })}
        {!existing.length && !peers.length ? <small>No overlap details were returned for this row.</small> : null}
      </div>
    </details>
  );
}

function EntryDetails({ date, staff, category, hours, km, comments }) {
  return <><dl className="ati-entry-details"><div><dt>Date</dt><dd>{sourceValue(date)}</dd></div><div><dt>Staff</dt><dd>{sourceValue(staff)}</dd></div><div><dt>Task / category</dt><dd>{sourceValue(category)}</dd></div><div><dt>Hours / km</dt><dd>{sourceValue(hours)} h · {sourceValue(km)} km</dd></div></dl><p className="ati-entry-comment"><b>Comments:</b> {sourceValue(comments)}</p></>;
}

function Reconciliation({ summary, groups = [] }) {
  return (
    <section className="ati-reconciliation" aria-label="Weekly hours reconciliation">
      <div className="ati-section-title"><div><strong>Weekly hours reconciliation</strong><small>Existing tracker hours + new included hours = resulting week hours. Uploaded exclusions do not change existing hours.</small></div><span className="ati-reconciliation-charge"><small>New included labour charges</small><strong>{formatCharge(summary?.totalCharge || 0)}</strong></span></div>
      <div className="ati-reconciliation-wrap" role="region" aria-label="Scrollable weekly hours reconciliation" tabIndex={0}>
        <table className="ati-reconciliation-table">
          <caption className="ati-visually-hidden">Existing, uploaded, new included, excluded and resulting hours grouped by staff, project and week</caption>
          <thead><tr><th scope="col">Staff</th><th scope="col">Project</th><th scope="col">Week starting</th><th scope="col">Existing h</th><th scope="col">Uploaded h</th><th scope="col">New included h</th><th scope="col">Excluded h</th><th scope="col">Resulting h</th></tr></thead>
          <tbody>{groups.map((group, index) => <tr key={`${group.staffLabel}-${group.projectLabel}-${group.weekStart}-${index}`}><th scope="row">{group.staffLabel || "Unresolved staff"}</th><td>{group.projectLabel || "Unresolved project"}</td><td>{group.weekStart || "Unresolved week"}</td><td>{formatNumber(group.existingHours)}</td><td>{formatNumber(group.uploadHours)}</td><td className="ati-reconciliation-new">{formatNumber(group.newHours)}</td><td>{formatNumber(group.excludedHours)}</td><td className="ati-reconciliation-result">{formatNumber(group.resultingHours)}</td></tr>)}{!groups.length ? <tr><td colSpan="8" className="ati-empty">No weekly reconciliation groups are available yet.</td></tr> : null}</tbody>
        </table>
      </div>
      <p className="ati-footnote">Labour charges only. Expenses, kilometres, and vehicle references are not included in these charges.</p>
    </section>
  );
}

function Metric({ label, value, tone = "" }) {
  return <div className={`ati-metric ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}
