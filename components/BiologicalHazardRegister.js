"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/AuthProvider";
import {
  BIOLOGICAL_CATEGORIES,
  BIOLOGICAL_DOCUMENT_CODE,
  BIOLOGICAL_DOCUMENT_REVISION,
  BIOLOGICAL_FIELD_SECTIONS,
  buildBiologicalHotspots,
  exportBiologicalRegisterCsv,
} from "../lib/biologicalHazardRegister";
import styles from "./BiologicalHazardRegister.module.css";

const API = "/api/biological-hazards";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const DISPLAY_PAGE_SIZE = 25;
const STATUSES = ["Open", "In progress", "Closed"];
const categoryLabel = (value) => BIOLOGICAL_CATEGORIES.find((category) => category.value === value)?.label || value || "—";
const dateLabel = (value) => value ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`).toLocaleDateString("en-AU") : new Date(value).toLocaleString("en-AU")) : "—";
const shown = (value) => Array.isArray(value) ? value.join(", ") || "—" : value === "" || value == null ? "—" : String(value);
function sectionNumber(section) {
  const keys = { bio_date: 2, bio_haz: 3, bio_hot: 4, bio_dur: 5, bio_extype: 6, bio_sym: 7, bio_fail: 8, bio_ca: 10, bio_fu: 11 };
  const first = (section.fields || []).find((field) => keys[field.key]);
  return first ? keys[first.key] : Number(String(section.title).match(/^\s*(\d+)/)?.[1] || section.id);
}
function sectionTitle(section) { return /^\s*\d+\./.test(section.title) ? section.title : `${sectionNumber(section)}. ${section.title}`; }
function reviewValues(event) {
  return { status: event.status || "Open", admin_notes: event.admin_notes || "", follow_up_date: (event.follow_up_date || "").slice(0, 10), follow_up_notes: event.follow_up_notes || "", closure_reason: "" };
}
async function readResponse(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || fallback);
    error.status = response.status;
    throw error;
  }
  return data;
}

function ProtectedPhotograph({ eventId, photo, request }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setUrl(""); setError(""); }, [eventId, photo.id]);
  const load = async () => {
    setLoading(true); setError(""); setUrl("");
    try {
      const data = await request("GET", `${API}/${encodeURIComponent(eventId)}/photos?photoId=${encodeURIComponent(photo.id)}`);
      const signedUrl = data.url || data.signedUrl;
      if (!signedUrl || !/^https:\/\//i.test(signedUrl)) throw new Error("The server did not return a secure photograph link.");
      if (alive.current) setUrl(signedUrl);
    } catch (failure) { if (alive.current) setError(failure.message || "Could not open this private photograph."); }
    finally { if (alive.current) setLoading(false); }
  };
  return <figure className={styles.photoCard}>
    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className={styles.photoLink}><img src={url} alt={`Biological hazard evidence: ${photo.file_name || "photograph"}`} referrerPolicy="no-referrer" onError={() => { setUrl(""); setError("The private link expired or the image could not be loaded. Request a fresh link."); }} /></a> : <div className={styles.photoPlaceholder}>Private photograph</div>}
    <figcaption><strong>{photo.file_name || "Photograph"}</strong><span>{photo.size_bytes ? `${Math.ceil(photo.size_bytes / 1024)} KB · ` : ""}{dateLabel(photo.created_at)}</span></figcaption>
    <button type="button" className={`${styles.secondary} ${styles.noPrint}`} disabled={loading} onClick={load}>{loading ? "Authorising…" : url ? "Refresh private link" : "View private photograph"}</button>
    {error && <p className={styles.errorText} role="alert">{error}</p>}
  </figure>;
}

export default function BiologicalHazardRegister({ audience = "admin", onToast }) {
  const { session, loading: authLoading } = useAuth();
  const admin = audience === "admin";
  const scope = admin ? "admin" : "mine";
  const userId = session?.user?.id || "";
  const token = session?.access_token || "";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [warning, setWarning] = useState("");
  const [complete, setComplete] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [edit, setEdit] = useState(null);
  const [editVersion, setEditVersion] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  const refreshBusy = useRef(false);
  const listAbort = useRef(null);
  const requestSerial = useRef(0);
  const selectedRef = useRef("");
  const detailRef = useRef(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const detailSerial = useRef(0);
  const mounted = useRef(true);
  const detailPanel = useRef(null);
  const [printHint, setPrintHint] = useState("");

  const request = useCallback(async (method, path, body, signal) => {
    if (!token) throw new Error("Your sign-in session has expired. Sign in again to access this private register.");
    const scopedPath = /[?&]scope=/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}scope=${scope}`;
    const response = await fetch(scopedPath, {
      method, signal, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return readResponse(response, "Could not access the biological hazard register.");
  }, [token, scope]);

  const loadDetail = useCallback(async (eventId, { resetEditor = false } = {}) => {
    if (!eventId || !token) return;
    const serial = ++detailSerial.current;
    setDetailLoading(true); setDetailError("");
    try {
      const data = await request("GET", `${API}/${encodeURIComponent(eventId)}`);
      if (!data.event?.id) throw new Error("The record could not be loaded.");
      let updates = data.updates || [];
      let updatesOffset = updates.length;
      let updatesHasMore = !!data.updatesHasMore;
      let updatesWarning = "";
      for (let pageIndex = 1; updatesHasMore && pageIndex < MAX_PAGES; pageIndex += 1) {
        if (!mounted.current || serial !== detailSerial.current || selectedRef.current !== eventId) return;
        try {
          const history = await request("GET", `${API}/${encodeURIComponent(eventId)}?updatesOffset=${updatesOffset}`);
          const historyRows = history.updates || [];
          const known = new Set(updates.map((update) => update.id));
          const additional = historyRows.filter((update) => !update.id || !known.has(update.id));
          updates = updates.concat(additional);
          updatesOffset += historyRows.length;
          updatesHasMore = !!history.updatesHasMore;
          if (updatesHasMore && (!historyRows.length || !additional.length)) { updatesWarning = "Update history pagination did not advance. The history shown is partial; refresh the report to retry."; break; }
        } catch { updatesWarning = "Some update history could not be loaded. The history shown is partial; refresh the report to retry."; break; }
      }
      if (updatesHasMore && !updatesWarning) updatesWarning = "The update-history safety limit was reached. The history shown is partial.";
      data.updates = updates;
      data.updatesWarning = updatesWarning;
      if (!mounted.current || serial !== detailSerial.current || selectedRef.current !== eventId) return;
      const previousVersion = detailRef.current?.event?.version;
      setDetail(data); detailRef.current = data;
      if (resetEditor || (!dirtyRef.current && !savingRef.current)) {
        setEdit(reviewValues(data.event)); setEditVersion(data.event.version); setDirty(false); dirtyRef.current = false; setConflict(false);
      } else if (previousVersion != null && data.event.version !== previousVersion) {
        setConflict(true); setSaveError("Another reviewer changed this record. Your edits are retained. Reload the latest review before saving; the signed submission has not changed.");
      }
    } catch (failure) {
      if (mounted.current && serial === detailSerial.current) setDetailError(failure.message || "Could not load the selected report.");
    } finally { if (mounted.current && serial === detailSerial.current) setDetailLoading(false); }
  }, [request, token]);

  const refresh = useCallback(async () => {
    if (!token || refreshBusy.current || !mounted.current) return;
    refreshBusy.current = true;
    const serial = ++requestSerial.current;
    const abort = new AbortController();
    listAbort.current = abort;
    setLoading(true); setLoadError("");
    try {
      let all = [];
      let offset = 0;
      let finished = false;
      let total;
      const seen = new Set();
      let limitedWarning = "";
      for (let index = 0; index < MAX_PAGES; index += 1) {
        const data = await request("GET", `${API}?scope=${scope}&limit=${PAGE_SIZE}&offset=${offset}`, undefined, abort.signal);
        if (!Array.isArray(data.events)) throw new Error("The register returned an invalid page. Previous results have been retained.");
        const items = data.events;
        if (typeof data.total === "number") total = data.total;
        const newItems = items.filter((row) => row.id && !seen.has(row.id));
        newItems.forEach((row) => seen.add(row.id));
        all = all.concat(newItems);
        offset += items.length;
        const hasMore = typeof data.hasMore === "boolean" ? data.hasMore : total != null ? offset < total : items.length === PAGE_SIZE;
        if (!hasMore) { finished = true; break; }
        if (!items.length || !newItems.length) { limitedWarning = "Pagination did not advance. Some authorised records could not be retrieved. Counts and hotspot indicators are partial; full CSV export is disabled."; break; }
      }
      if (!finished && !limitedWarning) limitedWarning = `The safety limit of ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} records) was reached. Counts and hotspot indicators are partial${total != null ? ` (${total} records reported by the server)` : ""}. Full CSV export is disabled; ask an administrator for a complete export.`;
      if (finished && total != null && all.length < total) {
        finished = false;
        limitedWarning = "The register changed while pages were being retrieved. Counts may be incomplete. Refresh again before exporting all records.";
      }
      if (!mounted.current || serial !== requestSerial.current) return;
      setRows(all); setComplete(finished); setWarning(limitedWarning); setLastRefresh(new Date());
      if (selectedRef.current) loadDetail(selectedRef.current);
    } catch (failure) {
      if (failure.name !== "AbortError" && mounted.current && serial === requestSerial.current) setLoadError(`${failure.message || "Register refresh failed."} Previous successful results, if any, are retained and may be out of date.`);
    } finally {
      if (serial === requestSerial.current) { refreshBusy.current = false; if (mounted.current) setLoading(false); }
    }
  }, [request, token, scope, loadDetail]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; listAbort.current?.abort(); requestSerial.current += 1; detailSerial.current += 1; };
  }, []);

  useEffect(() => {
    listAbort.current?.abort(); requestSerial.current += 1; refreshBusy.current = false;
    detailSerial.current += 1;
    selectedRef.current = ""; detailRef.current = null; dirtyRef.current = false;
    setRows([]); setComplete(false); setLastRefresh(null); setSelectedId(""); setDetail(null); setEdit(null); setDirty(false); setSaveError(""); setMessage(""); setWarning(""); setLoadError(""); setDetailError(""); setCategory(""); setStatus(""); setSearch(""); setPage(0);
  }, [userId, scope]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const visibleRefresh = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(visibleRefresh, 20000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener("biological-register-updated", visibleRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      window.removeEventListener("biological-register-updated", visibleRefresh);
      listAbort.current?.abort(); requestSerial.current += 1; refreshBusy.current = false;
    };
  }, [token, refresh]);

  const hotspots = useMemo(() => buildBiologicalHotspots(rows), [rows]);
  const stats = useMemo(() => ({
    total: rows.length,
    open: rows.filter((row) => row.status !== "Closed").length,
    exposure: rows.filter((row) => ["exp", "inj"].includes(row.details?.category)).length,
    hotspots: hotspots.filter((group) => group.hotspot).length,
  }), [rows, hotspots]);
  const filtered = useMemo(() => rows.filter((row) => {
    const fields = row.details?.fields || {};
    const matches = !search.trim() || [row.register_number, fields.bio_haz, fields.bio_worker, fields.bio_proj, fields.bio_loc].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase()));
    return matches && (!category || row.details?.category === category) && (!status || row.status === status);
  }), [rows, category, status, search]);
  const hotspotFilter = useMemo(() => hotspots.filter((group) => !search.trim() || [group.location, group.project, ...(group.hazards || [])].some((value) => String(value).toLowerCase().includes(search.trim().toLowerCase()))), [hotspots, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / DISPLAY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const displayed = filtered.slice(currentPage * DISPLAY_PAGE_SIZE, (currentPage + 1) * DISPLAY_PAGE_SIZE);
  useEffect(() => { setPage(0); }, [category, status, search]);

  const select = async (id) => {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm("Discard your unsaved reviewer edits and open another report?")) return;
    selectedRef.current = id; detailRef.current = null; dirtyRef.current = false;
    setSelectedId(id); setDetail(null); setEdit(null); setDirty(false); setConflict(false); setSaveError(""); setMessage(""); setPrintHint(""); setEvidenceRevision((current) => current + 1);
    await loadDetail(id, { resetEditor: true });
    detailPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const closeDetail = () => {
    if (savingRef.current || (dirtyRef.current && !window.confirm("Discard unsaved reviewer edits?"))) return;
    detailSerial.current += 1; selectedRef.current = ""; detailRef.current = null; dirtyRef.current = false;
    setSelectedId(""); setDetail(null); setEdit(null); setDirty(false); setConflict(false); setSaveError(""); setDetailError("");
  };
  const changeEdit = (key, value) => { setEdit((current) => ({ ...current, [key]: value })); setDirty(true); dirtyRef.current = true; setMessage(""); };
  const reloadReview = async () => {
    if (dirtyRef.current && !window.confirm("Reload the latest reviewer values? Your unsaved reviewer edits will be discarded.")) return;
    dirtyRef.current = false; setDirty(false); setSaveError(""); setConflict(false);
    await loadDetail(selectedId, { resetEditor: true });
  };
  useEffect(() => {
    const warn = (event) => { if (dirtyRef.current || savingRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const saveReview = async (event) => {
    event.preventDefault();
    if (!admin || !detail?.event || !edit || savingRef.current) return;
    setSaveError(""); setMessage("");
    if (edit.status === "Closed" && !edit.closure_reason.trim()) { setSaveError("A closure reason is required before closing this record."); return; }
    if (edit.status === "Closed" && ["exp", "inj"].includes(detail.event.details?.category) && (!edit.follow_up_date || !edit.follow_up_notes.trim())) { setSaveError("Exposure and injury records require a completed follow-up date and notes before closure."); return; }
    if (!Number.isInteger(editVersion)) { setSaveError("No valid record version was loaded. Reload the latest record before saving."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await request("PATCH", `${API}/${encodeURIComponent(detail.event.id)}`, { version: editVersion, status: edit.status, admin_notes: edit.admin_notes, follow_up_date: edit.follow_up_date || null, follow_up_notes: edit.follow_up_notes, closure_reason: edit.closure_reason });
      dirtyRef.current = false; setDirty(false); setConflict(false);
      await loadDetail(selectedId, { resetEditor: true });
      setMessage("Reviewer update saved. The original signed submission is unchanged.");
      onToast?.("Biological hazard reviewer update saved.");
      window.dispatchEvent(new CustomEvent("biological-register-updated", { detail: { eventId: selectedId } }));
      refresh();
    } catch (failure) {
      if (failure.status === 409) { setConflict(true); setSaveError("This record changed after you opened it. Your unsaved edits are retained. Reload the latest review, reconcile your changes, then save again."); }
      else setSaveError(failure.message || "Reviewer update was not saved. Your edits are retained.");
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };

  const exportCsv = () => {
    if (!complete || loading || !rows.length) return;
    const blob = new Blob(["\uFEFF", exportBiologicalRegisterCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `biological-register-${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onToast?.(`Exported all ${rows.length} currently loaded authorised records. Treat this download as confidential.`);
  };
  const printRecord = () => {
    const expected = detail?.photos?.length || 0;
    const ready = Array.from(detailPanel.current?.querySelectorAll(`.${styles.photoCard} img`) || []).filter((image) => image.complete && image.naturalWidth > 0).length;
    if (expected > ready && !window.confirm(`${expected - ready} private photograph(s) are not loaded. View them first to include them. Print this authorised report without those photographs?`)) return;
    setPrintHint(expected > ready ? "Some private photographs were not loaded for this print. Request authorised links to include them." : "");
    // Print CSS limits the portal to this selected authorised record; image links are short-lived.
    window.setTimeout(() => window.print(), 50);
  };

  const selectedEvent = detail?.event;
  const selectedDetails = selectedEvent?.details || {};
  const signedSections = BIOLOGICAL_FIELD_SECTIONS.filter((section) => ![1, 9, 12].includes(sectionNumber(section)) && (!section.categories?.length || section.categories.includes(selectedDetails.category)));

  return <section className={`${styles.root} ${styles.registerRoot}`} aria-label={admin ? "Administrative biological hazard register" : "My biological hazard reports"}>
    <header className={`${styles.hero} ${styles.noPrint}`}><p className={styles.eyebrow}>{admin ? "WHS monitoring · restricted review" : "Staff · my private records"}</p><h2 className={styles.registerTitle}>{admin ? "Biological Register and Hotspot Register" : "My biological hazard reports"}</h2><p>{admin ? "Review recorded hazards, site patterns, follow-up and corrective actions. Signed submissions remain immutable." : "Only reports you submitted are shown here, including when you also have administrator access. Your records are read-only; authorised reviewers manage status and follow-up."}</p><p className={styles.documentMeta}>{BIOLOGICAL_DOCUMENT_CODE} · Rev {BIOLOGICAL_DOCUMENT_REVISION}</p></header>
    <div className={styles.body}>
      <div className={styles.noPrint}>
        {authLoading && !token ? <p className={styles.hint}>Checking your sign-in session…</p> : !token ? <div className={styles.notice}>Sign in to access your authorised biological hazard records.</div> : <>
          <div className={styles.toolbar}><div><p className={styles.hint}>Refreshes on opening, focus and every 20 seconds while visible — not a realtime connection.<br />{lastRefresh ? `Last successful refresh: ${lastRefresh.toLocaleTimeString("en-AU")}.` : "Waiting for the first complete refresh."}{loading && " Refreshing…"}</p></div><div className={styles.inlineActions}><button type="button" className={styles.secondary} disabled={loading} onClick={refresh}>Refresh register</button><button type="button" className={styles.primary} disabled={!complete || loading || !rows.length} onClick={exportCsv}>Export all authorised rows (CSV)</button></div></div>
          {loadError && <div className={styles.error} role="alert">{loadError}</div>}
          {warning && <div className={styles.notice} role="alert">{warning}</div>}
          <div className={styles.stats} aria-label={`${complete ? "Complete loaded" : "Partial loaded"} register statistics`}>
            <div><span>{complete ? "Reports" : "Reports loaded"}</span><strong>{stats.total}</strong></div><div><span>Awaiting closure</span><strong>{stats.open}</strong></div><div><span>Exposure / injury</span><strong>{stats.exposure}</strong></div><div><span>Hotspot indicators</span><strong>{stats.hotspots}</strong></div>
          </div>
          <div className={styles.filters}><div className={styles.field}><label htmlFor={`bio-search-${scope}`}>Search register</label><input id={`bio-search-${scope}`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, hazard, worker, project or location" /></div><div className={styles.field}><label htmlFor={`bio-filter-category-${scope}`}>Category</label><select id={`bio-filter-category-${scope}`} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{BIOLOGICAL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div className={styles.field}><label htmlFor={`bio-filter-status-${scope}`}>Status</label><select id={`bio-filter-status-${scope}`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select></div></div>
          <p className={styles.hint}>Statistics and site indicators use all authorised loaded records, not just the displayed page or category filter. CSV exports all authorised records, regardless of filters. Downloads may contain confidential information; store and share them only with authorised people.</p>
          <section className={styles.card}><header className={styles.sectionHeader}><h3>Biological Register</h3><span className={styles.badge}>{filtered.length} matching</span></header><div className={styles.tableScroll} role="region" aria-label="Biological register table, scroll horizontally on small screens" tabIndex={0}><table className={styles.table}><thead><tr><th>ID</th><th>Date</th><th>Category</th><th>Hazard</th><th>Worker</th><th>Project</th><th>Location</th><th>No.</th><th>Status</th></tr></thead><tbody>{displayed.map((row) => { const fields = row.details?.fields || {}; return <tr key={row.id} className={selectedId === row.id ? styles.selectedRow : ""}><td><button type="button" className={styles.recordButton} onClick={() => select(row.id)} aria-label={`Open report ${row.register_number || row.id}`}>{row.register_number || "Open record"}</button></td><td>{dateLabel(fields.bio_date)}</td><td>{categoryLabel(row.details?.category)}</td><td>{shown(fields.bio_haz)}</td><td>{shown(fields.bio_worker)}</td><td>{shown(fields.bio_proj)}</td><td>{shown(fields.bio_loc)}</td><td>{shown(fields.bio_num)}</td><td><span className={`${styles.status} ${row.status === "Closed" ? styles.closed : ""}`}>{row.status}</span></td></tr>; })}{!displayed.length && <tr><td colSpan={9} className={styles.empty}>{loading && !rows.length ? "Loading authorised records…" : rows.length ? "No records match these filters." : "No biological hazard reports are available in this authorised scope."}</td></tr>}</tbody></table></div><div className={styles.pagination}><span>{filtered.length ? `${currentPage * DISPLAY_PAGE_SIZE + 1}–${Math.min((currentPage + 1) * DISPLAY_PAGE_SIZE, filtered.length)} of ${filtered.length}` : "0 records"}</span><div className={styles.inlineActions}><button type="button" className={styles.secondary} onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button type="button" className={styles.secondary} onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 >= pageCount}>Next</button></div></div></section>
          <section className={styles.card}><header className={styles.sectionHeader}><h3>Hotspot Register</h3><span className={styles.badge}>{admin ? "Authorised register" : "My reports only"}</span></header><div className={styles.cardBody}><p className={styles.hint}>Grouped by normalised location and project. An indicator is raised when marked “Yes”, or when there are at least three events or two exposure / injury reports. These are recorded site patterns, not confirmed medical risk. {admin ? "" : "This view uses only your own reports; it is not the organisation’s full hotspot register."} Search applies to site, project and hazards; category and status filters do not alter these groups.</p></div><div className={styles.tableScroll} role="region" aria-label="Hotspot register table, scroll horizontally on small screens" tabIndex={0}><table className={styles.table}><thead><tr><th>Location</th><th>Project</th><th>Hazards</th><th>Entries</th><th>Exposures</th><th>Last recorded</th><th>Hotspot</th></tr></thead><tbody>{hotspotFilter.map((group, index) => <tr key={`${group.project}:${group.location}:${index}`}><td>{shown(group.location)}</td><td>{shown(group.project)}</td><td>{shown(group.hazards)}</td><td>{group.entries}</td><td>{group.exposures}</td><td>{dateLabel(group.lastRecorded)}</td><td><span className={styles.status}>{group.hotspot ? "Indicator raised" : "Monitor"}</span></td></tr>)}{!hotspotFilter.length && <tr><td colSpan={7} className={styles.empty}>No site groups to display.</td></tr>}</tbody></table></div></section>
        </>}
      </div>
      {selectedId && <article ref={detailPanel} className={`${styles.detail} ${styles.printRecord}`} aria-label="Selected biological hazard report">
        <div className={`${styles.toolbar} ${styles.noPrint}`}><h3>Selected report</h3><div className={styles.inlineActions}><button type="button" className={styles.secondary} disabled={detailLoading || saving} onClick={() => loadDetail(selectedId)}>Refresh report</button><button type="button" className={styles.secondary} disabled={!detail || detailLoading || saving} onClick={printRecord}>Print / save authorised report</button><button type="button" className={styles.textButton} disabled={saving} onClick={closeDetail}>Close details</button></div></div>
        {detailLoading && <p className={styles.hint} role="status">Refreshing private record…</p>}
        {detailError && <p className={styles.error} role="alert">{detailError}</p>}
        {selectedEvent && <>
          <header className={styles.reportHeader}><p className={styles.eyebrow}>{BIOLOGICAL_DOCUMENT_CODE} · Rev {selectedDetails.documentRevision || BIOLOGICAL_DOCUMENT_REVISION}</p><h2>{selectedEvent.register_number || "Biological hazard report"}</h2><p><strong>{categoryLabel(selectedDetails.category)}</strong> · <span className={styles.status}>{selectedEvent.status}</span></p><p className={styles.hint}>Submitted {dateLabel(selectedEvent.created_at)} · Last updated {dateLabel(selectedEvent.updated_at)} · Version {selectedEvent.version}</p><p className={styles.hint}>Private authorised record. Original signed submission is immutable. Do not distribute medical details or photographs outside the authorised WHS review.</p></header>
          <section className={styles.card}><header className={styles.sectionHeader}><h3>1. Register category</h3></header><div className={styles.cardBody}>{categoryLabel(selectedDetails.category)}</div></section>
          {signedSections.filter((section) => sectionNumber(section) < 9).map((section) => <section className={styles.card} key={section.id}><header className={styles.sectionHeader}><h3>{sectionTitle(section)}</h3></header><dl className={`${styles.detailsGrid} ${styles.cardBody}`}>{section.fields.filter((field) => !["bio_id", "bio_status", "bio_closer", "bio_dname", "bio_ddate"].includes(field.key)).map((field) => <div key={field.key} className={field.type === "textarea" ? styles.wide : ""}><dt>{field.label}</dt><dd>{shown(selectedDetails.fields?.[field.key])}</dd></div>)}</dl></section>)}
          <section className={styles.card}><header className={styles.sectionHeader}><h3>9. Photograph</h3><span className={styles.badge}>{detail.photos?.length || 0} attached</span></header><div className={styles.cardBody}><p className={styles.hint}>Private evidence is opened only after the server verifies this record and photograph. Links expire within five minutes; refresh a link if necessary. Open photographs before printing to include them.</p>{detail.photos?.length ? <div className={styles.photoGrid}>{detail.photos.map((photo) => <ProtectedPhotograph key={`${selectedId}:${photo.id}:${evidenceRevision}`} eventId={selectedId} photo={photo} request={request} />)}</div> : <p className={styles.hint}>No photographs attached.</p>}{printHint && <p className={styles.hint}>{printHint}</p>}</div></section>
          {signedSections.filter((section) => sectionNumber(section) > 9).map((section) => <section className={styles.card} key={section.id}><header className={styles.sectionHeader}><h3>{sectionTitle(section)} — original submission</h3></header><dl className={`${styles.detailsGrid} ${styles.cardBody}`}>{section.fields.filter((field) => !["bio_id", "bio_status", "bio_closer", "bio_dname", "bio_ddate"].includes(field.key)).map((field) => <div key={field.key} className={field.type === "textarea" ? styles.wide : ""}><dt>{field.label}</dt><dd>{shown(selectedDetails.fields?.[field.key])}</dd></div>)}</dl></section>)}
          <section className={styles.card}><header className={styles.sectionHeader}><h3>12. Declaration</h3></header><div className={styles.cardBody}><dl className={styles.detailsGrid}><div><dt>Name</dt><dd>{shown(selectedDetails.declaration?.name)}</dd></div><div><dt>Date</dt><dd>{dateLabel(selectedDetails.declaration?.date)}</dd></div></dl>{selectedDetails.declaration?.signature && <img className={styles.signatureImage} src={selectedDetails.declaration.signature} alt={`Original signed declaration by ${selectedDetails.declaration.name}`} />}</div></section>
          <section className={styles.card}><header className={styles.sectionHeader}><h3>Reviewer follow-up and status</h3><span className={styles.badge}>{admin ? "Authorised WHS review" : "Read-only outcome"}</span></header><dl className={`${styles.detailsGrid} ${styles.cardBody}`}><div><dt>Current status</dt><dd>{selectedEvent.status}</dd></div><div><dt>Follow-up date</dt><dd>{dateLabel(selectedEvent.follow_up_date)}</dd></div><div className={styles.wide}><dt>Follow-up notes</dt><dd>{shown(selectedEvent.follow_up_notes)}</dd></div>{admin && <div className={styles.wide}><dt>Internal reviewer notes</dt><dd>{shown(selectedEvent.admin_notes)}</dd></div>}{selectedEvent.closed_at && <div><dt>Closed</dt><dd>{dateLabel(selectedEvent.closed_at)}</dd></div>}</dl>
            {admin && edit && <form onSubmit={saveReview} className={`${styles.reviewForm} ${styles.cardBody} ${styles.noPrint}`} autoComplete="off"><h4>Record a reviewer update</h4><p className={styles.hint}>Version checked against {editVersion}. Updates append an audit entry and do not modify the worker’s signed report. The recorded action-owner role remains in the submission; a named assignee is not selected here because no authorised staff directory has been supplied.</p>
              {saveError && <p className={styles.error} role="alert">{saveError}</p>}{message && <p className={styles.success} role="status">{message}</p>}
              <fieldset className={styles.reviewFieldset} disabled={saving}><legend className={styles.srOnly}>Reviewer update</legend><div className={styles.fieldGrid}><div className={styles.field}><label htmlFor={`bio-review-status-${selectedId}`}>Status</label><select id={`bio-review-status-${selectedId}`} value={edit.status} onChange={(event) => changeEdit("status", event.target.value)}>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select></div><div className={styles.field}><label htmlFor={`bio-review-date-${selectedId}`}>Completed follow-up date{edit.status === "Closed" && ["exp", "inj"].includes(selectedDetails.category) ? " *" : ""}</label><input id={`bio-review-date-${selectedId}`} type="date" value={edit.follow_up_date} onChange={(event) => changeEdit("follow_up_date", event.target.value)} /></div><div className={`${styles.field} ${styles.wide}`}><label htmlFor={`bio-review-followup-${selectedId}`}>Follow-up notes{edit.status === "Closed" && ["exp", "inj"].includes(selectedDetails.category) ? " *" : ""}</label><textarea id={`bio-review-followup-${selectedId}`} rows={3} maxLength={4000} value={edit.follow_up_notes} onChange={(event) => changeEdit("follow_up_notes", event.target.value)} placeholder="Completed check-in, outcome and outstanding controls" /></div><div className={`${styles.field} ${styles.wide}`}><label htmlFor={`bio-review-notes-${selectedId}`}>Internal reviewer notes (restricted)</label><textarea id={`bio-review-notes-${selectedId}`} rows={3} maxLength={4000} value={edit.admin_notes} onChange={(event) => changeEdit("admin_notes", event.target.value)} /></div>{edit.status === "Closed" && <div className={`${styles.field} ${styles.wide}`}><label htmlFor={`bio-review-closure-${selectedId}`}>Closure reason <span className={styles.required}>*</span></label><textarea id={`bio-review-closure-${selectedId}`} rows={2} maxLength={4000} required value={edit.closure_reason} onChange={(event) => changeEdit("closure_reason", event.target.value)} placeholder="Why this record can now be closed" /></div>}</div></fieldset>
              <div className={styles.inlineActions}><button type="submit" className={styles.primary} disabled={saving || !dirty || conflict}>{saving ? "Saving reviewer update…" : "Save reviewer update"}</button><button type="button" className={styles.secondary} disabled={saving} onClick={reloadReview}>{conflict ? "Reload latest review to resolve conflict" : "Reload / discard unsaved edits"}</button>{dirty && <span className={styles.hint}>Unsaved reviewer edits</span>}</div>
            </form>}
          </section>
          <section className={styles.card}><header className={styles.sectionHeader}><h3>Update history</h3></header><div className={styles.cardBody}>{detail.updatesWarning && <p className={styles.notice} role="status">{detail.updatesWarning}</p>}{detail.updates?.length ? <ol className={styles.auditList}>{detail.updates.map((update, index) => { const after = update.after_data || update.after || update.after_values || {}; const before = update.before_data || update.before || update.before_values || {}; return <li key={update.id || index}><strong>{dateLabel(update.created_at)}</strong><span>{shown(update.action || update.update_type || update.event_type || "Record update")}{update.version ? ` · Version ${update.version}` : ""}</span>{(after.status || update.status) && <span>Status: {before.status ? `${before.status} → ` : ""}{shown(after.status || update.status)}</span>}{admin && (update.reason || update.closure_reason || after.closure_reason) && <span>Reason: {shown(update.reason || update.closure_reason || after.closure_reason)}</span>}{admin && after.admin_notes && <span>Internal notes: {shown(after.admin_notes)}</span>}{admin && after.follow_up_notes && <span>Follow-up: {shown(after.follow_up_notes)}</span>}</li>; })}</ol> : <p className={styles.hint}>No subsequent updates recorded.</p>}</div></section>
          <footer className={styles.footer}>Ecology Consulting · {BIOLOGICAL_DOCUMENT_CODE} · Rev {selectedDetails.documentRevision || BIOLOGICAL_DOCUMENT_REVISION}<br />Confidential WHS record · Printed {new Date().toLocaleDateString("en-AU")}</footer>
        </>}
      </article>}
    </div>
  </section>;
}
