"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/AuthProvider";
import { EMPLOYMENT_TYPES, getRegisterToday, trainingExpiry, summariseTrainingRecords, normaliseRegisterStaff, normaliseTrainingRecord } from "../lib/internalTrainingRegister";
import styles from "./AdminInternalRegisters.module.css";

const API = "/api/internal-registers";
const PAGE_SIZE = 100;
const MAX_ROWS = 10000;
const DISPLAY_SIZE = 25;
const VIEWS = [{ value: "summary", label: "Summary" }, { value: "staff", label: "Staff Register" }, { value: "training", label: "Training & Competency Register" }];
const STATUSES = [{ value: "expired", label: "Expired" }, { value: "amber", label: "Due within 14 days" }, { value: "yellow", label: "Due within 30 days" }, { value: "current", label: "Current" }, { value: "no_expiry", label: "No expiry recorded" }];
const active = (row) => !row.archived_at;
const dateLabel = (date) => date ? new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }) : "—";
const employmentLabel = (value) => EMPLOYMENT_TYPES.find((item) => item.value === value)?.label || value || "—";
const compareNames = (a, b) => a.localeCompare(b, "en-AU", { sensitivity: "base", numeric: true });
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error("A secure mutation key could not be created. Please use a current browser.");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function validationMessage(errors) {
  if (!errors) return "";
  const list = Array.isArray(errors) ? errors : typeof errors === "object" ? Object.values(errors) : [errors];
  return list.filter(Boolean).map((item) => typeof item === "string" ? item : item.message || "Check the entered fields.").join(" ");
}
function initialLocation() {
  if (typeof window === "undefined") return { register: "training", view: "summary" };
  const params = new URLSearchParams(window.location.search);
  return { register: params.get("registerView") === "assets" ? "assets" : "training", view: VIEWS.some((item) => item.value === params.get("trainingView")) ? params.get("trainingView") : "summary" };
}
function staffValues(row = {}) {
  return { staff_name: row.staff_name || "", position: row.position || "", employment_type: row.employment_type || "", ...(row.linked_user_id ? { linked_user_id: row.linked_user_id } : {}) };
}
function trainingValues(row = {}) {
  return { staff_id: row.staff_id || "", qualification: row.qualification || "", training_organisation: row.training_organisation || "", completion_date: (row.completion_date || "").slice(0, 10), expiry_date: (row.expiry_date || "").slice(0, 10) };
}

export default function AdminInternalRegisters({ onToast }) {
  const { session, isAdmin, loading, portal } = useAuth();
  if (loading) return <section className={styles.root}><p role="status">Checking administrator access…</p></section>;
  if (!isAdmin || !session?.access_token || portal === "staff") return <section className={styles.root}><h2>Internal Registers</h2><p role="alert">Administrator portal access is required to view internal registers.</p></section>;
  return <RegisterWorkspace key={session.user?.id || "administrator"} token={session.access_token} onToast={onToast} />;
}

function RegisterWorkspace({ token, onToast }) {
  const id = useId();
  const [location, setLocation] = useState({ register: "training", view: "summary" });
  const [locationReady, setLocationReady] = useState(false);
  const [dataset, setDataset] = useState({ staff: [], training: [] });
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState(null);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef(null);
  const mutationBusy = useRef(false);
  const controller = useRef(null);
  const serial = useRef(0);
  const mounted = useRef(true);
  const editorPanel = useRef(null);
  const searchInput = useRef(null);

  useEffect(() => {
    mounted.current = true;
    setLocation(initialLocation()); setLocationReady(true);
    return () => { mounted.current = false; serial.current += 1; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!locationReady) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("registerView", location.register);
      url.searchParams.set("trainingView", location.view);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* URL persistence is non-essential to safe register operations. */ }
  }, [location, locationReady]);
  useEffect(() => { if (editor) editorPanel.current?.focus(); }, [editor]);

  const request = useCallback(async (method, path, body, signal) => {
    const response = await fetch(path, { method, signal, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : "The register request could not be completed.";
      const failure = new Error(message); failure.status = response.status;
      failure.code = typeof data?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(data.code) ? data.code : "";
      throw failure;
    }
    if (!data) throw new Error("The server returned an unreadable response.");
    return data;
  }, [token]);

  const loadAll = useCallback(async (entity, signal) => {
    const rows = []; const seen = new Set(); let total = null;
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const data = await request("GET", `${API}?entity=${entity}&limit=${PAGE_SIZE}&offset=${offset}&includeArchived=false`, null, signal);
      if (!Array.isArray(data.rows) || data.rows.length > PAGE_SIZE || !Number.isInteger(data.total) || data.total < 0 || typeof data.hasMore !== "boolean") throw new Error(`The ${entity} response was incomplete. Summary counts are unavailable; refresh to retry.`);
      if (data.total > MAX_ROWS) throw new Error(`The ${entity} register exceeds the ${MAX_ROWS.toLocaleString("en-AU")}-record safety limit. Summary counts are unavailable. Ask an administrator to review the register size.`);
      if (total !== null && data.total !== total) throw new Error("The register changed while loading. Refresh to load a consistent set; no partial summary is shown.");
      total = data.total;
      for (const row of data.rows) {
        if (!row?.id || seen.has(row.id)) throw new Error("Register pagination did not advance consistently. Refresh to retry; no partial summary is shown.");
        seen.add(row.id); rows.push(row);
      }
      if (!data.hasMore) {
        if (rows.length !== total) throw new Error("Not all authorised records could be loaded. Summary counts are unavailable; refresh to retry.");
        return rows.filter(active);
      }
      if (data.rows.length !== PAGE_SIZE || rows.length >= total) throw new Error("Register pagination was incomplete. Refresh to retry; no partial summary is shown.");
    }
    throw new Error("The register loading safety limit was reached. No partial summary is shown.");
  }, [request]);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const current = ++serial.current;
    setLoading(true); setComplete(false); setLoadError("");
    try {
      const [staff, training] = await Promise.all([loadAll("staff", abort.signal), loadAll("training", abort.signal)]);
      const staffIds = new Set(staff.map((row) => row.id));
      if (training.some((row) => !staffIds.has(row.staff_id))) throw new Error("Staff and training records changed while loading. Refresh to retry with a complete matching dataset.");
      if (!mounted.current || serial.current !== current) return null;
      const next = { staff, training };
      setDataset(next); setComplete(true); setLastRefresh(new Date());
      return next;
    } catch (failure) {
      if (mounted.current && serial.current === current && failure.name !== "AbortError") { setLoadError(failure.message || "Could not load the register. Refresh to retry."); abort.abort(); }
      return null;
    } finally { if (mounted.current && serial.current === current) setLoading(false); }
  }, [loadAll]);
  useEffect(() => { if (locationReady && location.register === "training") reload(); }, [reload, locationReady, location.register]);

  const now = new Date();
  const today = getRegisterToday(now);
  const asOf = now.toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });
  const staff = useMemo(() => [...dataset.staff].sort((a, b) => compareNames(a.staff_name, b.staff_name) || a.id.localeCompare(b.id)), [dataset.staff]);
  const staffMap = useMemo(() => new Map(staff.map((row) => [row.id, row])), [staff]);
  const training = useMemo(() => [...dataset.training].sort((a, b) => compareNames(staffMap.get(a.staff_id)?.staff_name || "", staffMap.get(b.staff_id)?.staff_name || "") || compareNames(a.qualification || "", b.qualification || "") || a.id.localeCompare(b.id)), [dataset.training, staffMap]);
  const summary = useMemo(() => summariseTrainingRecords(training, staff, today), [training, staff, today]);
  const alerts = useMemo(() => [...summary.alerts].sort((a, b) => compareNames(a.staff_name || staffMap.get(a.staff_id)?.staff_name || "", b.staff_name || staffMap.get(b.staff_id)?.staff_name || "") || compareNames(a.qualification || "", b.qualification || "") || a.id.localeCompare(b.id)), [summary, staffMap]);
  const source = location.view === "staff" ? staff : location.view === "summary" ? alerts : training;
  const query = search.trim().toLocaleLowerCase("en-AU");
  const filtered = source.filter((row) => {
    const isStaff = location.view === "staff";
    const text = isStaff ? [row.staff_name, row.position, employmentLabel(row.employment_type)] : [staffMap.get(row.staff_id)?.staff_name, row.qualification, row.training_organisation];
    return (!query || text.join(" ").toLocaleLowerCase("en-AU").includes(query)) && (!filter || (isStaff ? row.employment_type === filter : trainingExpiry(row.expiry_date, today).key === filter));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / DISPLAY_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const displayed = filtered.slice(currentPage * DISPLAY_SIZE, (currentPage + 1) * DISPLAY_SIZE);

  const navigate = (register, view = location.view) => {
    if (editor) return;
    setLocation({ register, view }); setSearch(""); setFilter(""); setPage(0); setNotice("");
  };
  const openEditor = (entity, action, row = null) => {
    if (mutationBusy.current || pending.current) return;
    setEditor({ entity, action, row }); setValues(entity === "staff" ? staffValues(row || {}) : trainingValues(row || {}));
    setReason(""); setSaveError(""); setConflict(false); setUncertain(false); setNotice("");
  };
  const closeEditor = () => {
    if (mutationBusy.current || pending.current) return;
    setEditor(null); setSaveError(""); setConflict(false); searchInput.current?.focus();
  };
  const updateValue = (key, value) => { setValues((previous) => ({ ...previous, [key]: value })); setSaveError(""); };
  const submitMutation = async (event) => {
    event.preventDefault();
    if (!editor || mutationBusy.current || conflict) return;
    let payload = pending.current;
    if (!payload) {
      const { entity, action, row } = editor;
      let validated;
      if (action === "archive") {
        if (!reason.trim()) { setSaveError("Enter an archive reason for the audit trail."); return; }
        if (reason.trim().length > 1000 || /[<>\u0000-\u001f\u007f]/.test(reason.trim())) { setSaveError("Use a plain-text archive reason, without markup or line breaks (maximum 1000 characters)."); return; }
      } else {
        validated = entity === "staff" ? normaliseRegisterStaff(values) : normaliseTrainingRecord(values);
        const message = validationMessage(validated.errors);
        if (message) { setSaveError(message); return; }
      }
      if (action !== "create" && (!row?.id || !Number.isInteger(row.version) || row.version < 1)) { setSaveError("This record has no valid version. Refresh and reopen it before saving."); return; }
      try {
        payload = { entity, action, ...(row ? { id: row.id, expected_version: row.version } : {}), ...(action === "archive" ? { reason: reason.trim() } : { values: validated.value }), mutation_key: uuid() };
        // A single immutable payload is retained for every uncertain retry. Never
        // reuse its key for edited values, a different record, or another action.
        pending.current = JSON.parse(JSON.stringify(payload)); payload = pending.current;
      } catch (failure) { setSaveError(failure.message); return; }
    }
    mutationBusy.current = true; setSaving(true); setSaveError("");
    let succeeded = false;
    try {
      const result = await request("POST", API, payload);
      if (!result.row?.id) throw new Error("The server did not confirm the saved record.");
      succeeded = true; pending.current = null;
      if (mounted.current) { setUncertain(false); setEditor(null); setConflict(false); setNotice(payload.action === "archive" ? "Record archived. It has been removed from active registers; the audit history is retained." : "Record saved."); }
    } catch (failure) {
      if (!mounted.current) return;
      const isUncertain = !failure.status || failure.status >= 500 || failure.status === 408;
      if (!isUncertain) pending.current = null;
      const staleVersion = failure.status === 409 && !["IR_DUPLICATE_STAFF", "IR_STAFF_HAS_TRAINING"].includes(failure.code);
      setUncertain(isUncertain); setConflict(staleVersion);
      const conflictText = staleVersion ? " No changes were overwritten. Reload the latest record before trying again." : "";
      const retryText = isUncertain ? " The outcome is not yet confirmed. Retry the same submission below; its mutation key and payload are unchanged to prevent duplicate writes." : "";
      setSaveError(`${failure.message}${failure.code ? ` (${failure.code})` : ""}${conflictText}${retryText}`);
    } finally {
      if (succeeded && mounted.current) {
        try { onToast?.(payload.action === "archive" ? "Register record archived." : "Register record saved."); } catch { /* A parent notification must not turn a committed save into a retry. */ }
        await reload();
      }
      mutationBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const reloadEditor = async () => {
    if (!editor || saving || pending.current) return;
    const next = await reload();
    if (!next || !mounted.current) return;
    const row = next[editor.entity].find((item) => item.id === editor.row?.id);
    if (!row) { setSaveError("This record is no longer active. Close this form to return to the refreshed register."); return; }
    setEditor({ ...editor, row }); setValues(editor.entity === "staff" ? staffValues(row) : trainingValues(row)); setConflict(false); setSaveError(""); setNotice("Latest record loaded. Review the fields before saving.");
  };

  const expiryCell = (row) => {
    const expiry = trainingExpiry(row.expiry_date, today);
    const label = STATUSES.find((item) => item.value === expiry.key)?.label || expiry.status;
    return <><td className={styles[expiry.key]}>{dateLabel(row.expiry_date)}</td><td className={styles[expiry.key]}>{expiry.daysRemaining == null ? "—" : expiry.daysRemaining}</td><td><span className={`${styles.status} ${styles[expiry.key]}`}>{label}</span></td></>;
  };
  const rowActions = (entity, row) => <td className={styles.noPrint}><div className={styles.rowActions}><button type="button" disabled={!!editor || saving || loading} onClick={() => openEditor(entity, "update", row)} aria-label={`Edit ${entity === "staff" ? row.staff_name : `${staffMap.get(row.staff_id)?.staff_name || "staff"}: ${row.qualification}`}`}>Edit</button><button type="button" disabled={!!editor || saving || loading} onClick={() => openEditor(entity, "archive", row)} aria-label={`Archive ${entity === "staff" ? row.staff_name : `${staffMap.get(row.staff_id)?.staff_name || "staff"}: ${row.qualification}`}`}>Archive</button></div></td>;

  return <section className={styles.root} aria-label="Internal Registers">
    <header className={styles.header}><div><p className={styles.eyebrow}>Admin Portal · Internal Registers</p><h2>Internal Registers</h2><p>Controlled staff and training records, maintained by administrators.</p></div></header>
    <nav className={`${styles.domains} ${styles.noPrint}`} aria-label="Internal register areas">
      <button type="button" aria-pressed={location.register === "training"} className={location.register === "training" ? styles.selected : ""} disabled={!!editor || saving} onClick={() => navigate("training")}>Training &amp; Competency Register</button>
      <button type="button" aria-pressed={location.register === "assets"} className={location.register === "assets" ? styles.selected : ""} disabled={!!editor || saving} onClick={() => navigate("assets")}>Asset &amp; Equipment <span className={styles.comingLabel}>Coming soon</span></button>
    </nav>
    {location.register === "assets" ? <div className={styles.comingSoon}><h3>Asset &amp; Equipment</h3><strong>Coming soon</strong><p>This register is not available yet. No asset or equipment records are collected here.</p></div> : <>
      <nav className={`${styles.views} ${styles.noPrint}`} aria-label="Training register views">{VIEWS.map((view) => <button key={view.value} type="button" aria-pressed={location.view === view.value} disabled={!!editor || saving} className={location.view === view.value ? styles.selected : ""} onClick={() => navigate("training", view.value)}>{view.label}</button>)}</nav>
      <div className={styles.headingRow}><div><h3>{VIEWS.find((view) => view.value === location.view)?.label}</h3><p className={styles.asOf}>As of {asOf} (Australia/Sydney){lastRefresh ? ` · Last loaded ${lastRefresh.toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit" })}` : ""}</p></div><div className={`${styles.actions} ${styles.noPrint}`}><button type="button" disabled={loading || saving || uncertain} onClick={reload}>{loading ? "Loading…" : "Refresh"}</button><button type="button" disabled={!complete || loading || !!editor || saving} onClick={() => window.print()}>Print current view</button><button type="button" className={styles.primary} disabled={!complete || loading || !!editor || saving} onClick={() => openEditor("staff", "create")}>Add staff</button>{location.view !== "staff" && <button type="button" className={styles.primary} disabled={!complete || !staff.length || loading || !!editor || saving} onClick={() => openEditor("training", "create")}>Add training record</button>}</div></div>
      <p className={styles.guidance}>Training attendance is not independent proof of competency or task authorisation. Expiry dates flag review needs only. Today remains valid and is flagged within 14 days.</p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {loading && <p className={styles.loadState} role="status">Loading all authorised staff and training records… Summary counts will appear only when loading is complete.</p>}
      {loadError && <p className={styles.error} role="alert">{loadError} No partial counts are displayed.</p>}
      {editor && <section ref={editorPanel} tabIndex={-1} className={`${styles.editor} ${styles.noPrint}`} aria-labelledby={`${id}-editor-title`}>
        <h4 id={`${id}-editor-title`}>{editor.action === "archive" ? "Confirm archive" : editor.action === "create" ? `Add ${editor.entity === "staff" ? "staff" : "training record"}` : `Edit ${editor.entity === "staff" ? "staff" : "training record"}`}</h4>
        <form onSubmit={submitMutation}>
          {editor.action === "archive" ? <><p>Archive <strong>{editor.entity === "staff" ? editor.row.staff_name : `${staffMap.get(editor.row.staff_id)?.staff_name || "Staff"} — ${editor.row.qualification}`}</strong>? This removes the record from active registers, not its audit history. {editor.entity === "staff" && "Staff with active training records cannot be archived."}</p><label className={styles.field} htmlFor={`${id}-reason`}>Archive reason (required)<textarea id={`${id}-reason`} required maxLength={1000} rows={3} value={reason} disabled={saving || uncertain || conflict} onChange={(event) => { setReason(event.target.value); setSaveError(""); }} /></label></> : <><p className={styles.formHint}>{editor.entity === "staff" ? "Enter staff details manually. A portal login is not required; no account details are copied or changed." : "Choose an active staff record and enter the qualification details. Leave expiry blank if no expiry is recorded."}</p><fieldset disabled={saving || uncertain || conflict} className={styles.fields}>
            <legend className={styles.srOnly}>{editor.entity === "staff" ? "Staff details" : "Training details"}</legend>
            {editor.entity === "staff" ? <>
              <label className={styles.field} htmlFor={`${id}-staff-name`}>Staff name (required)<input id={`${id}-staff-name`} name="staff_name" required maxLength={150} autoComplete="off" value={values.staff_name} onChange={(event) => updateValue("staff_name", event.target.value)} /></label>
              <label className={styles.field} htmlFor={`${id}-position`}>Position (required)<input id={`${id}-position`} name="position" required maxLength={150} autoComplete="off" value={values.position} onChange={(event) => updateValue("position", event.target.value)} /></label>
              <label className={styles.field} htmlFor={`${id}-employment`}>Employment type (required)<select id={`${id}-employment`} name="employment_type" required value={values.employment_type} onChange={(event) => updateValue("employment_type", event.target.value)}><option value="">Select employment type</option>{EMPLOYMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            </> : <>
              <label className={styles.field} htmlFor={`${id}-training-staff`}>Staff member (required)<select id={`${id}-training-staff`} name="staff_id" required value={values.staff_id} onChange={(event) => updateValue("staff_id", event.target.value)}><option value="">Select staff member</option>{staff.map((row) => <option key={row.id} value={row.id}>{row.staff_name}</option>)}</select></label>
              <label className={styles.field} htmlFor={`${id}-qualification`}>Qualification (required)<input id={`${id}-qualification`} name="qualification" required maxLength={200} value={values.qualification} onChange={(event) => updateValue("qualification", event.target.value)} /></label>
              <label className={styles.field} htmlFor={`${id}-organisation`}>Training organisation (required)<input id={`${id}-organisation`} name="training_organisation" required maxLength={200} value={values.training_organisation} onChange={(event) => updateValue("training_organisation", event.target.value)} /></label>
              <label className={styles.field} htmlFor={`${id}-completion`}>Completion date (required)<input id={`${id}-completion`} name="completion_date" type="date" required value={values.completion_date} onChange={(event) => updateValue("completion_date", event.target.value)} /></label>
              <label className={styles.field} htmlFor={`${id}-expiry`}>Expiry date (optional)<input id={`${id}-expiry`} name="expiry_date" type="date" min={values.completion_date || undefined} value={values.expiry_date} onChange={(event) => updateValue("expiry_date", event.target.value)} /></label>
            </>}
          </fieldset></>}
          {saveError && <p className={styles.error} role="alert">{saveError}</p>}
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={saving || conflict}>{saving ? "Saving…" : uncertain ? "Retry same submission" : editor.action === "archive" ? "Confirm archive" : "Save record"}</button>{conflict && <button type="button" disabled={loading || saving} onClick={reloadEditor}>Reload latest record</button>}<button type="button" disabled={saving || uncertain} onClick={closeEditor}>Cancel</button></div>
        </form>
      </section>}
      {complete && !loading && <>
        {location.view === "summary" && <><div className={styles.counts} aria-label="Full active register totals"><span><strong>{staff.length}</strong> staff</span><span><strong>{summary.total}</strong> training records</span><span className={styles.expired}><strong>{summary.expired}</strong> expired</span><span className={styles.amber}><strong>{summary.dueWithin14}</strong> due within 14 days</span><span className={styles.yellow}><strong>{summary.dueWithin30}</strong> due in 15–30 days</span></div><h4>Flagged training records</h4><p className={styles.formHint}>Totals include all active authorised records, not just the table page or search results.</p></>}
        {!staff.length && <div className={styles.empty}><h4>No staff records yet</h4><p>Start with Add staff and enter the staff name, position and employment type. Then add training records using the staff dropdown. No existing accounts or training content have been seeded.</p><button type="button" className={`${styles.primary} ${styles.noPrint}`} disabled={!!editor || saving} onClick={() => openEditor("staff", "create")}>Add staff</button></div>}
        <div className={`${styles.toolbar} ${styles.noPrint}`}><label className={styles.searchField} htmlFor={`${id}-search`}>Search {location.view === "staff" ? "staff" : "staff, qualification or organisation"}<input ref={searchInput} id={`${id}-search`} type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search records…" /></label><label className={styles.filterField} htmlFor={`${id}-filter`}>{location.view === "staff" ? "Employment type" : "Expiry status"}<select id={`${id}-filter`} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="">All {location.view === "staff" ? "employment types" : "statuses"}</option>{(location.view === "staff" ? EMPLOYMENT_TYPES : STATUSES).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        <p className={styles.selectedCount} role="status">{filtered.length} {location.view === "staff" ? "staff" : "records"} selected · Staff name A–Z{filtered.length > DISPLAY_SIZE ? ` · Showing ${currentPage * DISPLAY_SIZE + 1}–${Math.min((currentPage + 1) * DISPLAY_SIZE, filtered.length)}` : ""}</p>
        {displayed.length ? <div className={styles.tableScroll} role="region" aria-label={`${VIEWS.find((view) => view.value === location.view)?.label} table`} tabIndex={0}><table className={styles.table}><caption>{location.view === "summary" ? "Active training records requiring expiry review" : location.view === "staff" ? "Active staff register" : "Active training and competency register"}</caption><thead><tr><th scope="col">Staff name</th>{location.view === "staff" ? <><th scope="col">Position</th><th scope="col">Employment type</th></> : <><th scope="col">Qualification</th><th scope="col">Training organisation</th><th scope="col">Completion date</th><th scope="col">Expiry date</th><th scope="col">Days remaining</th><th scope="col">Expiry status</th></>}<th scope="col" className={styles.noPrint}>Actions</th></tr></thead><tbody>{displayed.map((row) => <tr key={row.id}><th scope="row">{location.view === "staff" ? row.staff_name : staffMap.get(row.staff_id)?.staff_name || "Staff record unavailable"}</th>{location.view === "staff" ? <><td>{row.position}</td><td>{employmentLabel(row.employment_type)}</td></> : <><td>{row.qualification}</td><td>{row.training_organisation}</td><td>{dateLabel(row.completion_date)}</td>{expiryCell(row)}</>}{rowActions(location.view === "staff" ? "staff" : "training", row)}</tr>)}</tbody></table></div> : <p className={styles.empty} role="status">{query || filter ? "No records match your search or filter." : location.view === "summary" ? training.length ? "No active training records are expired or due within 30 days." : "No training records yet. Add staff first, then add a training record." : location.view === "staff" ? "The staff register is empty." : "No training records yet. Add staff first, then use Add training record."}</p>}
        {pages > 1 && <nav className={`${styles.pagination} ${styles.noPrint}`} aria-label="Register table pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pages}</span><button type="button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
        <p className={styles.printNote}>Printed view includes the current search and displayed table page only. Summary totals cover the complete active register. As of {asOf} (Australia/Sydney).</p>
      </>}
    </>}
  </section>;
}
