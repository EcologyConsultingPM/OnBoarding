"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, Download, FileText, Lock, Plus, Save, Send, Trash2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { createCloseoutReport, normaliseCloseoutReport, closeoutTotals, renderCloseoutHtml } from "../lib/projectCloseoutTemplate";
import styles from "./ProjectCloseOut.module.css";

const BLANK = {
  deliverables: { title: "", budget: "", hrs: "", actual: "" },
  seniors: { name: "", role: "" }, ecologists: { name: "", role: "" },
  hurdles: { hurdle: "", impact: "", resolution: "" },
  lessons: { lesson: "", action: "", owner: "", due: "", status: "Open" },
};
const CAPS = { seniors: 3, ecologists: 10, deliverables: 100, hurdles: 100, lessons: 100 };
const number = (value) => Number(value || 0);
const hours = (value) => Number(value || 0).toLocaleString("en-AU", { maximumFractionDigits: 2 });
const money = (value) => Number(value || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
const variance = (value) => `${value > 0 ? "+" : ""}${hours(value)}`;
const stamp = (value) => value ? new Date(value).toLocaleString("en-AU") : "Not yet saved";
// Project completion and report approval are separate. A completed project's
// report can be prepared or reasonedly reopened without reactivating it.
const isLocked = (data) => Boolean(data?.closeout?.locked_at || data?.closeout?.locked || ["closed", "archived"].includes(data?.closeout?.status) || data?.project?.status === "archived");
const ownEntry = (data, userId) => {
  const entries = (data?.feedback || []).filter((entry) => entry.staff_user_id === userId);
  const invitation = data?.invitation;
  if (invitation) return entries.find((entry) => entry.invitation_id === invitation.id || (entry.review_round && entry.review_round === invitation.review_round)) || entries.find((entry) => !entry.review_round && !entry.invitation_id) || null;
  return [...entries].sort((a, b) => Number(b.review_round || 0) - Number(a.review_round || 0) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0] || null;
};
const feedbackResponse = (entry) => ({ hurdles: entry?.response?.hurdles || [{ ...BLANK.hurdles }], lessons: entry?.response?.lessons || [{ ...BLANK.lessons }] });
const serverIdentity = (data, staff, userId) => JSON.stringify({
  revision: data?.closeout?.report_revision || 0,
  report: data?.closeout?.report_data || null,
  updatedAt: data?.closeout?.updated_at || null,
  status: data?.closeout?.status || null,
  lockedAt: data?.closeout?.locked_at || null,
  projectStatus: data?.project?.status || null,
  reviewRound: data?.closeout?.review_round || null,
  feedback: staff ? ownEntry(data, userId) : null,
  invitation: staff ? data?.invitation : null,
});

function Field({ label, value, onChange, readOnly = false, type = "text", placeholder, multiline = false, className = "" }) {
  const Tag = multiline ? "textarea" : "input";
  return <label className={`${styles.field} ${className}`}><span>{label}</span><Tag type={multiline ? undefined : type} rows={multiline ? 2 : undefined} value={value ?? ""} readOnly={readOnly} maxLength={type === "date" || type === "number" ? undefined : 5000} min={type === "number" ? "0" : undefined} step={type === "number" ? "any" : undefined} inputMode={type === "number" ? "decimal" : undefined} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} /></label>;
}

function Section({ number: sectionNumber, title, description, children }) {
  return <section className={styles.card}><header className={styles.sectionHeader}><span className={styles.sectionNumber}>{sectionNumber}</span><div><h2>{title}</h2><p>{description}</p></div></header><div className={styles.cardBody}>{children}</div></section>;
}

function ResponseRows({ list, rows, editable, disabled, onChange, onAdd, onRemove }) {
  const lesson = list === "lessons";
  return <><div className={styles.responseRows}>{rows.map((row, index) => <div key={index} className={lesson ? styles.lessonRow : styles.hurdleRow}>
    {lesson ? <>
      <Field label="Lesson learnt" value={row.lesson} placeholder="What we learnt" multiline readOnly={!editable || disabled} onChange={(value) => onChange(index, "lesson", value)} />
      <Field label="Action" value={row.action} placeholder="What we'll do differently" multiline readOnly={!editable || disabled} onChange={(value) => onChange(index, "action", value)} />
      <Field label="Owner" value={row.owner} placeholder="Owner" readOnly={!editable || disabled} onChange={(value) => onChange(index, "owner", value)} />
      <Field label="Due" type="date" value={row.due} readOnly={!editable || disabled} onChange={(value) => onChange(index, "due", value)} />
      <label className={styles.field}><span>Status</span><select aria-label={`Lesson ${index + 1} status`} value={row.status || "Open"} disabled={!editable || disabled} onChange={(event) => onChange(index, "status", event.target.value)}>{["Open", "In progress", "Complete"].map((status) => <option key={status}>{status}</option>)}</select></label>
    </> : <>
      <Field label="Hurdle" value={row.hurdle} placeholder="What got in the way" multiline readOnly={!editable || disabled} onChange={(value) => onChange(index, "hurdle", value)} />
      <Field label="Impact" value={row.impact} placeholder="Effect on time, budget or quality" multiline readOnly={!editable || disabled} onChange={(value) => onChange(index, "impact", value)} />
      <Field label="How it was resolved" value={row.resolution} placeholder="Resolution" multiline readOnly={!editable || disabled} onChange={(value) => onChange(index, "resolution", value)} />
    </>}
    {editable && <button type="button" className={styles.remove} disabled={disabled} aria-label={`Remove ${lesson ? "lesson" : "hurdle"} ${index + 1}`} onClick={() => onRemove(index)}><Trash2 size={15} /></button>}
  </div>)}</div>{!rows.length && <p className={styles.note}>No {lesson ? "lessons" : "hurdles"} recorded.</p>}{editable && <button type="button" className={styles.add} disabled={disabled || rows.length >= 100} onClick={onAdd}><Plus size={14} /> Add {lesson ? "lesson" : "hurdle"}</button>}</>;
}

export function ProjectCloseOutSelector({ onOpen }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!session?.access_token) return;
    let active = true;
    setLoading(true);
    fetch("/api/projects", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load projects.");
      return (data.projects || []).filter((project) => ["active", "on_hold", "complete", "completed", "archived"].includes(String(project.status || "").toLowerCase()));
    }).then((rows) => { if (active) { setProjects(rows); setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || ""); setError(""); } }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.access_token]);
  return <section className={`${styles.root} ${styles.picker}`}><span className={styles.kicker}><ClipboardCheck size={15} /> Project governance</span><h2>Project Close Report</h2><p>Choose an active or on-hold project, or open a completed or archived report for history.</p>{error && <p role="alert" className={styles.error}>{error}</p>}{loading ? <p role="status">Loading projects…</p> : projects.length ? <div className={styles.pickerControls}><label className={styles.field}><span>Project</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.client_name ? ` — ${project.client_name}` : ""} ({project.status?.replaceAll("_", " ")})</option>)}</select></label><button type="button" className={styles.primary} onClick={() => onOpen?.(projects.find((project) => project.id === selectedId))}>Open close-out</button></div> : <p>No eligible projects are available.</p>}</section>;
}

export default function ProjectCloseOut(props) {
  const { session } = useAuth();
  return <CloseoutWorkspace key={`${props.projectId}:${session?.user?.id || "signed-out"}:${Boolean(props.staffMode)}`} {...props} />;
}

function CloseoutWorkspace({ projectId, projectName, onToast, staffMode = false }) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const token = useRef(session?.access_token);
  token.current = session?.access_token;
  const [data, setData] = useState(null);
  const [report, setReport] = useState(() => createCloseoutReport({ name: projectName }));
  const [response, setResponse] = useState(() => feedbackResponse(null));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [localStatus, setLocalStatus] = useState("");
  const [recovery, setRecovery] = useState(null);
  const [localNotice, setLocalNotice] = useState("");
  const [selectedTeam, setSelectedTeam] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reasonMode, setReasonMode] = useState("");
  const [reason, setReason] = useState("");
  const [actionForm, setActionForm] = useState({ title: "", description: "", dueDate: "" });
  const operation = useRef(false);
  const loadedIdentity = useRef("");
  const master = !staffMode && data?.canManage === true;
  const staff = !master;
  const locked = isLocked(data);
  const archived = data?.project?.status === "archived" || data?.closeout?.status === "archived";
  const feedback = ownEntry(data, userId);
  const feedbackLocked = feedback?.status === "submitted" || Boolean(feedback?.submitted_at) || ["submitted", "cancelled", "dismissed", "closed"].includes(data?.invitation?.status);
  const currentRound = !data?.closeout?.review_round || data?.invitation?.review_round === data.closeout.review_round;
  const canRespond = staff && Boolean(data?.invitation) && currentRound && !locked && !feedbackLocked;
  const editable = master && !locked;
  const disabled = Boolean(busy) || conflict;
  const revision = Number(data?.closeout?.report_revision || 0);
  const localKey = userId && projectId ? `ecology-project-close:v2:${userId}:${projectId}:${staff ? "feedback" : "report"}` : "";

  const api = useCallback(async (method = "GET", body) => {
    if (!token.current) throw new Error("Your session has expired. Sign in again before saving.");
    const result = await fetch(`/api/projects/${encodeURIComponent(projectId)}/closeout${staffMode ? "?audience=staff" : ""}`, { method, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` }, body: body ? JSON.stringify(body) : undefined });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) { const failure = new Error([payload.error || "The close-out action could not be completed.", ...(Array.isArray(payload.errors) ? payload.errors : Array.isArray(payload.details) ? payload.details.filter((item) => typeof item === "string") : [])].join(" ")); failure.status = result.status; failure.code = payload.code; throw failure; }
    return payload;
  }, [projectId, staffMode]);

  const applyServer = useCallback((next) => {
    const nextReport = next.closeout?.report_data ? normaliseCloseoutReport(next.closeout.report_data, next.project || {}) : createCloseoutReport(next.project || { name: projectName });
    setData(next); setReport(nextReport); setResponse(feedbackResponse(ownEntry(next, userId))); setDirty(false); setLocalStatus(""); setRecovery(null);
    loadedIdentity.current = serverIdentity(next, staffMode || next.canManage !== true, userId);
    return nextReport;
  }, [projectName, staffMode, userId]);

  useEffect(() => {
    if (!userId || !projectId || !token.current) return;
    let active = true;
    api().then((next) => {
      if (!active) return;
      applyServer(next);
      const nextStaff = staffMode || next.canManage !== true;
      const key = `ecology-project-close:v2:${userId}:${projectId}:${nextStaff ? "feedback" : "report"}`;
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) || "null");
        if (!saved) return;
        if (isLocked(next) || (nextStaff && (ownEntry(next, userId)?.status === "submitted" || ["submitted", "cancelled", "dismissed", "closed"].includes(next.invitation?.status)))) setLocalNotice("A device draft exists but cannot be restored because this report or response is locked.");
        else if (saved.userId !== userId || saved.projectId !== projectId || saved.serverIdentity !== loadedIdentity.current || saved.revision !== Number(next.closeout?.report_revision || 0)) setLocalNotice("An older device draft was not restored: the server report or review round has changed. The server version is shown.");
        else { const candidate = nextStaff ? normaliseCloseoutReport({ ...createCloseoutReport(), hurdles: saved.response?.hurdles, lessons: saved.response?.lessons }) : normaliseCloseoutReport(saved.report, next.project || {}); setRecovery({ ...saved, report: candidate, response: { hurdles: candidate.hurdles, lessons: candidate.lessons } }); }
      } catch { setLocalNotice("The device draft could not be read. The server version is shown; no server data was changed."); }
    }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, applyServer, userId, projectId, staffMode]);

  useEffect(() => {
    if (!dirty || loading || !data || !localKey || locked || (staff && !canRespond)) return;
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(localKey, JSON.stringify({ userId, projectId, revision, serverIdentity: loadedIdentity.current, savedAt: new Date().toISOString(), ...(staff ? { response } : { report }) }));
        setLocalStatus(`Saved on this device at ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })} — not saved to server.`);
      } catch { setLocalStatus("Device autosave unavailable. Use Save draft to save to the server."); }
    }, 550);
    return () => clearTimeout(timer);
  }, [dirty, loading, data, localKey, locked, staff, canRespond, userId, projectId, revision, report, response]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const notify = (text) => { setMessage(text); onToast?.(text); };
  const clearLocal = () => { try { window.localStorage.removeItem(localKey); } catch { /* Device storage may be blocked. */ } };
  const handleFailure = (err) => {
    const stale = err.status === 409 && (!err.code || ["REVISION_CONFLICT", "LOCKED", "STATE_CONFLICT", "RESPONSE_SUBMITTED"].includes(err.code));
    setError(stale ? `${err.message} Your unsaved work has been retained. Download a copy before reloading the server version.` : err.message);
    if (stale) setConflict(true);
  };
  const run = async (label, task) => {
    if (operation.current) return;
    operation.current = true; setBusy(label); if (!conflict) setError(""); setMessage("");
    try { await task(); } catch (err) { handleFailure(err); } finally { operation.current = false; setBusy(""); }
  };
  const refreshAfter = async (payload, savedWork = false) => {
    // Never discard the editor on an unsuccessful mutation or failed refresh.
    let next;
    try { next = await api(); }
    catch (err) { setConflict(true); throw new Error(`The server accepted the action, but the latest report could not be loaded. Your editor is retained. Reload before further changes. ${err.message}`); }
    applyServer(next); setConflict(false); if (savedWork) clearLocal();
    return next;
  };
  const refreshActions = async () => {
    const next = await api();
    // A report changed by another editor must never advance our expectedRevision
    // while this editor still contains the old master report and unsaved edits.
    setData((current) => ({ ...current, actions: next.actions || [] }));
    if (serverIdentity(next, staff, userId) !== loadedIdentity.current) {
      setConflict(true);
      throw new Error("The improvement action succeeded, but the server report has changed. Your report edits are retained. Download a copy, then reload the latest server version before editing further.");
    }
  };
  const saveReport = async () => {
    const validated = normaliseCloseoutReport(report, data?.project || {});
    const result = await api("POST", { action: "save_report", report: validated, expectedRevision: revision });
    return refreshAfter(result, true);
  };
  const adminAction = (action, confirmation) => {
    if (confirmation && !window.confirm(confirmation)) return;
    run(action, async () => {
      const validated = normaliseCloseoutReport(report, data?.project || {});
      const result = await api("POST", { action, report: validated, expectedRevision: revision });
      await refreshAfter(result, true);
      notify(action === "submit_report" ? "Report submitted. The project is complete and the report is locked." : "Editing locked. This does not complete the project.");
    });
  };
  const saveFeedback = (submit) => {
    if (submit && !window.confirm("Submit your response? Your hurdles and lessons will be locked and sent to the project lead for review. They will not overwrite the master report.")) return;
    run(submit ? "submit_feedback" : "save_feedback", async () => {
      const validated = normaliseCloseoutReport({ ...createCloseoutReport(), ...response });
      const result = await api("POST", { action: submit ? "submit_feedback" : "save_feedback", response: { hurdles: validated.hurdles, lessons: validated.lessons } });
      await refreshAfter(result, true); notify(submit ? "Your response was submitted for review. The master report has not been overwritten." : "Your feedback draft was saved to the server.");
    });
  };
  const setField = (key, value) => { if (!editable || disabled) return; setReport((current) => ({ ...current, [key]: value })); setDirty(true); setLocalStatus("Device autosave pending — not saved to server."); };
  const changeRow = (list, index, key, value) => {
    if (disabled || !(staff && ["hurdles", "lessons"].includes(list) ? canRespond : editable)) return;
    const setter = staff && ["hurdles", "lessons"].includes(list) ? setResponse : setReport;
    setter((current) => ({ ...current, [list]: current[list].map((row, i) => i === index ? { ...row, [key]: value } : row) })); setDirty(true); setLocalStatus("Device autosave pending — not saved to server.");
  };
  const alterRow = (list, removeIndex) => {
    if (disabled || !(staff && ["hurdles", "lessons"].includes(list) ? canRespond : editable)) return;
    const setter = staff && ["hurdles", "lessons"].includes(list) ? setResponse : setReport;
    setter((current) => ({ ...current, [list]: removeIndex === undefined ? current[list].length < CAPS[list] ? [...current[list], { ...BLANK[list] }] : current[list] : current[list].filter((_, i) => i !== removeIndex) })); setDirty(true); setLocalStatus("Device autosave pending — not saved to server.");
  };
  const exportReport = (print = false) => run(print ? "export_pdf" : "offline", async () => {
    const validated = normaliseCloseoutReport(report, data?.project || {});
    const exportFeedback = master ? (data?.feedback || []).map((entry) => ({ ...entry, staff_name: entry.staff_name || data?.team?.find((person) => person.id === entry.staff_user_id)?.name || entry.staff_user_id })) : [{ ...(feedback || {}), staff_user_id: userId, staff_name: session?.user?.user_metadata?.full_name || session?.user?.email || "Your response", response, status: dirty ? "draft (device only)" : feedback?.status || "draft" }];
    // Staff exports receive only the public template and this person's own response.
    const exportedCloseout = master ? { ...data?.closeout } : { status: data?.closeout?.status, report_revision: revision, locked_at: data?.closeout?.locked_at, approved_at: data?.closeout?.approved_at };
    if (dirty) exportedCloseout.history = [...(Array.isArray(exportedCloseout.history) ? exportedCloseout.history : exportedCloseout.history ? [exportedCloseout.history] : []), { source: "Device-only draft", note: "This export contains unsaved device edits; it is not a confirmed server save.", exported_at: new Date().toISOString() }];
    const html = renderCloseoutHtml({ report: validated, closeout: exportedCloseout, feedback: exportFeedback, project: data?.project || {} });
    if (print) {
      const popup = window.open("", "_blank");
      if (!popup) throw new Error("Allow pop-ups to open the complete printable report, or download the offline copy and print it to PDF.");
      popup.opener = null; popup.document.open(); popup.document.write(html); popup.document.close();
      popup.document.title = `${validated.name || projectName || "Project"} — Project Close Report`;
      // Print the generated, complete document, never the clipped portal editor.
      setTimeout(() => { if (!popup.closed) { popup.focus(); popup.print(); } }, 400);
      notify("The complete report is open in the print dialog. Choose Save as PDF.");
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `${(validated.name || "project").replace(/[^a-z0-9_-]+/gi, "-")}-close-report.html`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Offline report downloaded. This does not save changes to the server.");
    }
  });
  const reload = () => {
    if ((dirty || conflict) && !window.confirm("Reload the latest server version? Unsaved editor changes will be replaced. Download an offline copy first if you need to keep them.")) return;
    run("reload", async () => { const next = await api(); applyServer(next); setConflict(false); setError(""); setLocalNotice(""); clearLocal(); notify("Latest server version loaded."); });
  };

  if (loading) return <section className={`${styles.root} ${styles.loading}`} role="status">Loading project close-out…</section>;
  if (!data) return <section className={`${styles.root} ${styles.picker}`}><h2>Project Close Report</h2><p className={styles.error} role="alert">{error || "This report could not be loaded."}</p><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => run("reload", async () => { const next = await api(); applyServer(next); })}>Try again</button></section>;
  let totals = { budget: 0, budgetHours: 0, actualHours: 0, variance: 0, durationDays: 0 };
  let validationError = "";
  try { totals = closeoutTotals(report); }
  catch (err) { validationError = err.message || "Check the report values before saving."; }
  const duration = totals.durationDays > 0 ? totals.durationDays >= 14 ? `${hours(totals.durationDays / 7)} weeks` : `${totals.durationDays} days` : "—";
  const responseRows = staff ? response : report;
  const unfinished = report.lessons.filter((lesson) => (lesson.lesson?.trim() || lesson.action?.trim()) && lesson.status !== "Complete").length;
  const status = archived ? "Archived" : data.closeout?.status === "closed" ? "Submitted" : locked ? "Locked draft" : "Draft";
  const legacyFields = [["success_score", "Success score"], ["client_outcome", "Client outcome"], ["delivery_summary", "Delivery summary"], ["lessons_learned", "Lessons learned"], ["stakeholder_feedback", "Stakeholder feedback"], ["financial_review_notes", "Financial review notes"], ["recommendations", "Recommendations"], ["approval_note", "Approval note"]];
  return <article className={styles.root} aria-busy={Boolean(busy)}>
    <header className={styles.hero}><div className={styles.heroInner}>
      <div className={styles.heroTop}><div className={styles.logo}><img src="/logo.png" alt="Ecology Consulting" /></div><div className={styles.toolbar}>
        <span className={styles.status}>{staff ? feedbackLocked ? "Response submitted" : `Your response · ${status}` : status}</span>
        {master ? <>
          <button type="button" disabled={disabled || locked} onClick={() => run("save_report", async () => { await saveReport(); notify("Report draft saved to the server."); })}><Save size={14} /> {busy === "save_report" ? "Saving…" : "Save draft"}</button>
          {!locked ? <button type="button" disabled={disabled} onClick={() => adminAction("lock_report", "Lock editing? This saves the report without completing the project.")}><Lock size={14} /> Lock editing</button> : !archived && <button type="button" disabled={disabled} onClick={() => { setReasonMode("reopen_report"); setReason(""); }}>Reopen as draft</button>}
        </> : <button type="button" disabled={disabled || !canRespond} onClick={() => saveFeedback(false)}><Save size={14} /> {busy === "save_feedback" ? "Saving…" : "Save draft"}</button>}
        <button type="button" disabled={Boolean(busy)} onClick={() => exportReport(true)}><FileText size={14} /> Export {staff ? "own report " : ""}PDF</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => exportReport(false)}><Download size={14} /> Download offline copy</button>
        {master ? <><button type="button" disabled={disabled || locked} onClick={() => setInviteOpen(!inviteOpen)}><Send size={14} /> Send to project team</button><button type="button" className={styles.submit} disabled={disabled || locked} onClick={() => adminAction("submit_report", `Submit this project close report? The project will be marked complete and the report locked.${unfinished ? ` ${unfinished} unfinished lesson/action(s) will remain recorded.` : ""} Outstanding invited team reviews must be submitted first.`)}>{busy === "submit_report" ? "Submitting…" : status === "Submitted" ? "Submitted" : "Submit"}</button></> : <button type="button" className={styles.submit} disabled={disabled || !canRespond} onClick={() => saveFeedback(true)}>{busy === "submit_feedback" ? "Submitting…" : feedbackLocked ? "Response submitted" : "Submit response"}</button>}
      </div></div>
      <div><p className={styles.eyebrow}>Project Close Report</p><Field label="Project name" value={report.name} placeholder="Project name" className={styles.projectName} readOnly={!editable || disabled} onChange={(value) => setField("name", value)} /></div>
      <div className={styles.metaGrid}><Field label="Project number" value={report.number} placeholder="e.g. EC-2026-041" readOnly={!editable || disabled} onChange={(value) => setField("number", value)} /><Field label="Client" value={report.client} placeholder="Client name" readOnly={!editable || disabled} onChange={(value) => setField("client", value)} /><Field label="Start date" type="date" value={report.start} readOnly={!editable || disabled} onChange={(value) => setField("start", value)} /><Field label="Final date" type="date" value={report.end} readOnly={!editable || disabled} onChange={(value) => setField("end", value)} /></div>
    </div></header>
    <div className={styles.stateBar}><span><strong>{status}</strong> · Revision {revision} · Last server update: {stamp(data.closeout?.updated_at)}</span>{locked && <span><Lock size={13} /> The report is locked.</span>}{staff && <span>Invited team review — only your own hurdles and lessons can be edited.</span>}</div>
    <div className={styles.body}>
      {error && <div className={styles.error} role="alert"><strong>Action not completed</strong><p>{error}</p>{conflict && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={reload}>Reload latest server version</button>}</div>}
      {message && <p className={styles.success} role="status">{message}</p>}
      {localNotice && <p className={styles.notice}>{localNotice}</p>}
      {recovery && <div className={styles.notice}><p>A matching device-only draft from {stamp(recovery.savedAt)} is available. It has not been saved to the server.</p><div className={styles.inlineActions}><button type="button" className={styles.secondary} disabled={disabled || locked || (staff && !canRespond)} onClick={() => run("restore", async () => { const current = await api(); if (isLocked(current) || serverIdentity(current, staff, userId) !== recovery.serverIdentity) { setConflict(true); throw new Error("The server report or your review changed after loading. This device draft was not restored. Download your current copy, then reload the server version."); } if (staff) setResponse(recovery.response); else setReport(recovery.report); setRecovery(null); setDirty(true); })}>Restore device draft</button><button type="button" className={styles.secondary} onClick={() => { setRecovery(null); clearLocal(); }}>Discard device draft</button></div></div>}
      <p className={styles.saveStatus} role="status">{localStatus || (dirty ? "Unsaved changes — not saved to server." : "Server version shown. Device autosave is separate from Save draft.")}</p>
      {master && dirty && locked && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={reload}>Reload saved server report</button>}
      {validationError && <p className={styles.error} role="alert">{validationError} Totals are unavailable until this is corrected; your changes are retained.</p>}
      {staff && <div className={styles.notice}><strong>Your review</strong><p>The project report is read-only. Sections 03 and 04 below contain your own response, not other staff responses or changes to the master report. Submitted responses are kept separately for the Project Manager to review.</p>{(feedbackLocked || !currentRound) && <p>This response is locked or belongs to an earlier review round. Reopening does not alter original responses; a new invitation is required for the new round.</p>}</div>}
      {inviteOpen && master && <section className={styles.panel} aria-label="Invite project team"><h2>Send to project team</h2><p>Only selected current project team members will receive an invitation. The report is saved to the server before invitations are sent. Their responses remain separate and do not automatically overwrite the report.</p><div className={styles.teamChoices}>{(data.team || []).map((person) => <label key={person.id}><input type="checkbox" checked={selectedTeam.includes(person.id)} disabled={disabled || locked} onChange={(event) => setSelectedTeam((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} /><span><strong>{person.name || person.email}</strong><small>{person.role || "Project team"}{person.email ? ` · ${person.email}` : ""}</small></span></label>)}</div>{!data.team?.length && <p>No current project team members are available to invite.</p>}<button type="button" className={styles.primary} disabled={disabled || locked || !selectedTeam.length} onClick={() => run("invite_team", async () => { const saved = await saveReport(); const result = await api("POST", { action: "invite_team", staffUserIds: selectedTeam, expectedRevision: Number(saved.closeout?.report_revision || 0) }); await refreshAfter(result); setSelectedTeam([]); setInviteOpen(false); notify("Report saved and invitations sent to the selected project team. Existing pending invitations are not duplicated."); })}>{busy === "invite_team" ? "Saving and inviting…" : "Save report & send selected invitations"}</button></section>}
      {reasonMode === "reopen_report" && master && <section className={styles.panel}><h2>Reopen as draft</h2><p>A reason is required and retained in the audit history. A project completed by this close-out returns to active; archived projects are never reopened here. Reopening starts a new review round. Previous draft and submitted responses are retained read-only; select and invite the team again for new responses.</p><Field label="Reason for reopening" multiline value={reason} onChange={setReason} /><div className={styles.inlineActions}><button type="button" className={styles.primary} disabled={disabled || !reason.trim()} onClick={() => run("reopen_report", async () => { const result = await api("POST", { action: "reopen_report", reason: reason.trim(), expectedRevision: revision }); await refreshAfter(result); setReasonMode(""); setReason(""); notify("Report reopened for a new review round. Previous responses are retained read-only; invite the team again for new responses."); })}>Confirm reopen</button><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => setReasonMode("")}>Cancel</button></div></section>}
      <div className={styles.summary}><div><span>Duration</span><strong>{duration}</strong></div><div><span>Total budget</span><strong>{money(totals.budget)}</strong></div><div><span>Hours — budget / actual</span><strong>{hours(totals.budgetHours)} / {hours(totals.actualHours)}</strong></div><div className={totals.variance > 0 ? styles.overBudget : styles.withinBudget}><span>Hours variance</span><strong>{variance(totals.variance)} hrs</strong></div></div>
      <Section number="01" title="Deliverables, Budget & Hours" description="To be completed by the Project Manager"><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Deliverables, budget and hours table"><table className={styles.deliverables}><thead><tr><th scope="col">#</th><th scope="col">Deliverable</th><th scope="col">Budget ($)</th><th scope="col">Budget hrs</th><th scope="col">Actual hrs</th><th scope="col">Variance</th>{editable && <th scope="col"><span className={styles.srOnly}>Remove</span></th>}</tr></thead><tbody>{report.deliverables.map((row, index) => <tr key={index}><td><span className={styles.rowNumber}>{index + 1}</span></td><td><input aria-label={`Deliverable ${index + 1}`} maxLength={5000} value={row.title} placeholder="Deliverable description" readOnly={!editable || disabled} onChange={(event) => changeRow("deliverables", index, "title", event.target.value)} /></td>{["budget", "hrs", "actual"].map((key) => <td key={key}><input aria-label={`Deliverable ${index + 1} ${key === "hrs" ? "budget hours" : key === "actual" ? "actual hours" : "budget dollars"}`} type="number" min="0" step="any" inputMode="decimal" value={row[key]} placeholder="0" readOnly={!editable || disabled} onChange={(event) => changeRow("deliverables", index, key, event.target.value)} /></td>)}<td className={number(row.actual) - number(row.hrs) > 0 ? styles.positive : styles.negative}>{row.hrs !== "" && row.actual !== "" ? variance(number(row.actual) - number(row.hrs)) : "—"}</td>{editable && <td><button type="button" className={styles.remove} disabled={disabled} aria-label={`Remove deliverable ${index + 1}`} onClick={() => alterRow("deliverables", index)}><Trash2 size={15} /></button></td>}</tr>)}</tbody><tfoot><tr><td /><th scope="row">Total</th><td>{money(totals.budget)}</td><td>{hours(totals.budgetHours)}</td><td>{hours(totals.actualHours)}</td><td className={totals.variance > 0 ? styles.positive : styles.negative}>{variance(totals.variance)}</td>{editable && <td />}</tr></tfoot></table></div>{editable && <button type="button" className={styles.add} disabled={disabled || report.deliverables.length >= 100} onClick={() => alterRow("deliverables")}><Plus size={14} /> Add deliverable</button>}</Section>
      <Section number="02" title="Project Team" description="To be completed by the Project Manager"><div className={styles.teamGrid}>{[["seniors", "Overseeing Senior Ecologist(s)", "senior ecologist"], ["ecologists", "Ecologists", "ecologist"]].map(([list, title, singular]) => <div key={list}><div className={styles.teamTitle}><h3>{title}</h3><span>{report[list].length} / {CAPS[list]}</span></div>{report[list].map((person, index) => <div key={index} className={styles.personRow}><Field label={`Name ${index + 1}`} value={person.name} placeholder="Name" readOnly={!editable || disabled} onChange={(value) => changeRow(list, index, "name", value)} /><Field label={list === "seniors" ? "Specialty" : "Role on project"} value={person.role} placeholder={list === "seniors" ? "Specialty" : "Role on project"} readOnly={!editable || disabled} onChange={(value) => changeRow(list, index, "role", value)} />{editable && <button type="button" className={styles.remove} disabled={disabled} aria-label={`Remove ${singular} ${index + 1}`} onClick={() => alterRow(list, index)}><Trash2 size={15} /></button>}</div>)}{editable && <button type="button" className={styles.add} disabled={disabled || report[list].length >= CAPS[list]} onClick={() => alterRow(list)}><Plus size={14} /> Add {singular}</button>}</div>)}</div></Section>
      <Section number="03" title="Project Hurdles" description="To be completed by the Senior Ecologist(s) and Ecologists">{staff && <p className={styles.source}>Your own response · {feedback?.status || "draft"}</p>}<ResponseRows list="hurdles" rows={responseRows.hurdles} editable={staff ? canRespond : editable} disabled={disabled} onChange={(index, key, value) => changeRow("hurdles", index, key, value)} onAdd={() => alterRow("hurdles")} onRemove={(index) => alterRow("hurdles", index)} />{staff && report.hurdles.some((row) => row.hurdle || row.impact || row.resolution) && <details className={styles.reference}><summary>Read the master report hurdles (read-only)</summary><ResponseRows list="hurdles" rows={report.hurdles} editable={false} /></details>}</Section>
      <Section number="04" title="Lessons Learnt & Actions" description="To be completed by the Senior Ecologist(s) and Ecologists">{staff && <p className={styles.source}>Your own response · {feedback?.status || "draft"}</p>}<ResponseRows list="lessons" rows={responseRows.lessons} editable={staff ? canRespond : editable} disabled={disabled} onChange={(index, key, value) => changeRow("lessons", index, key, value)} onAdd={() => alterRow("lessons")} onRemove={(index) => alterRow("lessons", index)} />{unfinished > 0 && master && <p className={styles.note}>{unfinished} unfinished lesson/action(s). These remain recorded when the report is submitted.</p>}{staff && report.lessons.some((row) => row.lesson || row.action) && <details className={styles.reference}><summary>Read the master report lessons (read-only)</summary><ResponseRows list="lessons" rows={report.lessons} editable={false} /></details>}</Section>
      <section className={styles.signoff} aria-label="Sign-off"><Field label="Closed out by" value={report.closedBy} placeholder="Name" readOnly={!editable || disabled} onChange={(value) => setField("closedBy", value)} /><Field label="Approved by" value={report.approvedBy} placeholder="Name" readOnly={!editable || disabled} onChange={(value) => setField("approvedBy", value)} /><Field label="Close-out date" type="date" value={report.closeDate} readOnly={!editable || disabled} onChange={(value) => setField("closeDate", value)} /></section>
      {master && <section className={styles.panel}><h2>Project team responses</h2><p>Original responses are attributed to each person and retained separately. They are not automatically copied into the master report. All responses are included in the offline report and PDF.</p>{!data.feedback?.length && <p className={styles.note}>No team responses have been received.</p>}{(data.feedback || []).map((entry) => <details key={entry.id || entry.staff_user_id} className={styles.reference}><summary>{entry.staff_name || data.team?.find((person) => person.id === entry.staff_user_id)?.name || entry.staff_user_id} — {entry.status || "draft"}{entry.review_round ? ` · Review round ${entry.review_round}` : ""}{entry.submitted_at ? ` · submitted ${stamp(entry.submitted_at)}` : ""}</summary><p className={styles.source}>Source: original team response · {entry.staff_user_id} · Last update: {stamp(entry.updated_at)}</p><h3>Project Hurdles</h3><ResponseRows list="hurdles" rows={entry.response?.hurdles || []} editable={false} /><h3>Lessons Learnt & Actions</h3><ResponseRows list="lessons" rows={entry.response?.lessons || []} editable={false} />{typeof entry.response === "string" && <p className={styles.legacyText}>{entry.response}</p>}</details>)}</section>}
      {master && legacyFields.some(([key]) => data.closeout?.[key] !== null && data.closeout?.[key] !== undefined && data.closeout?.[key] !== "") && <details className={styles.panel}><summary>Legacy close-out notes — preserved read-only</summary><dl className={styles.legacy}>{legacyFields.filter(([key]) => data.closeout?.[key] !== null && data.closeout?.[key] !== undefined && data.closeout?.[key] !== "").map(([key, title]) => <div key={key}><dt>{title}</dt><dd>{String(data.closeout[key])}</dd></div>)}</dl></details>}
      {master && <section className={styles.panel}><h2>Improvement actions</h2><p>Existing actions remain separate, project-scoped and auditable.</p>{editable && <div className={styles.actionForm}><Field label="Improvement action" value={actionForm.title} onChange={(value) => setActionForm((current) => ({ ...current, title: value }))} readOnly={disabled} /><Field label="Description" value={actionForm.description} onChange={(value) => setActionForm((current) => ({ ...current, description: value }))} readOnly={disabled} /><Field label="Due date" type="date" value={actionForm.dueDate} onChange={(value) => setActionForm((current) => ({ ...current, dueDate: value }))} readOnly={disabled} /><button type="button" className={styles.secondary} disabled={disabled || !actionForm.title.trim()} onClick={() => run("improvement", async () => { await api("POST", { action: "upsert_improvement", closeoutId: data.closeout?.id || null, ...actionForm, status: "draft" }); await refreshActions(); setActionForm({ title: "", description: "", dueDate: "" }); notify("Improvement action added. Report edits have not been saved."); })}><Plus size={14} /> Add action</button></div>}{(data.actions || []).map((action) => <div key={action.id} className={styles.actionRow}><div><strong>{action.title}</strong><p>{action.description || "No description"}{action.due_date ? ` · Due ${action.due_date}` : ""}</p></div><span>{action.status?.replaceAll("_", " ")}</span>{editable && <button type="button" className={styles.remove} disabled={disabled} aria-label={`Archive improvement action: ${action.title}`} onClick={() => run("improvement", async () => { await api("POST", { action: "archive_improvement", actionId: action.id }); await refreshActions(); notify("Improvement action archived. Report edits have not been saved."); })}><Trash2 size={15} /></button>}</div>)}{!data.actions?.length && <p className={styles.note}>No active improvement actions have been recorded.</p>}</section>}
      {master && data.closeout?.override_reason && <div className={styles.notice}><strong>Administrative override recorded</strong><p className={styles.legacyText}>{data.closeout.override_reason}</p><p>{stamp(data.closeout.override_at)} · Actor: {data.closeout.override_by || "Recorded in audit history"}</p></div>}
      {master && !archived && data.closeout?.status !== "closed" && <section className={styles.override}><h2>Administrative override — close without normal checks</h2><p>This explicitly bypasses required report fields and outstanding team reviews. The project will be marked complete and the saved server report locked. Existing drafts, responses and improvement actions are retained. Pending invitations will no longer be actionable. An audit reason is mandatory.</p>{dirty && <p><strong>Unsaved editor changes are not submitted by this override.</strong> They remain a separate device-only draft. Save or download them first if required; invalid template fields will not block this closure.</p>}<Field label="Reason for administrative override" value={reasonMode === "override_close" ? reason : ""} multiline readOnly={disabled} onChange={(value) => { setReasonMode("override_close"); setReason(value); }} /><button type="button" className={styles.danger} disabled={disabled || reasonMode !== "override_close" || !reason.trim()} onClick={() => { if (!window.confirm(`ADMINISTRATIVE OVERRIDE: bypass normal report and team-review checks, complete this project, and lock the saved server report? Your reason will be recorded.${dirty ? " Unsaved editor changes remain a separate device-only draft and are not submitted." : ""}`)) return; run("override_close", async () => { const retainedDraft = dirty ? report : null; if (retainedDraft && localKey) { try { window.localStorage.setItem(localKey, JSON.stringify({ userId, projectId, revision, serverIdentity: loadedIdentity.current, savedAt: new Date().toISOString(), report: retainedDraft })); } catch { /* The in-memory draft remains available after closure. */ } } const result = await api("POST", { action: "override_close", reason: reason.trim(), expectedRevision: revision }); await refreshAfter(result, !retainedDraft); if (retainedDraft) { setReport(retainedDraft); setDirty(true); setLocalStatus("Project closed. This editor retains your unsaved device-only draft; it is not the locked server report. Download a separate copy or reload the server version."); } setReasonMode(""); setReason(""); notify("Project completed by administrative override. The reason and saved work are retained." + (retainedDraft ? " Your unsaved editor draft is still shown separately." : "")); }); }}>{busy === "override_close" ? "Closing…" : "Override and close project"}</button></section>}
      {master && locked && !archived && data.closeout?.status === "closed" && <section className={styles.panel}><h2>Archive project</h2><p>The locked report and audit history remain available. All improvement actions must be completed or archived first.</p><button type="button" className={styles.secondary} disabled={disabled} onClick={() => { if (!window.confirm("Archive this project? Its locked report and audit history will be retained.")) return; run("archive_project", async () => { const result = await api("POST", { action: "archive_project", expectedRevision: revision }); await refreshAfter(result); notify("Project archived. The report remains available for history."); }); }}>Archive project</button></section>}
      <footer className={styles.footer}>Ecology Consulting — Project Close Report · Autosaves on this device · Use Save draft for a server copy · Use Export PDF for a PDF copy</footer>
    </div>
  </article>;
}
