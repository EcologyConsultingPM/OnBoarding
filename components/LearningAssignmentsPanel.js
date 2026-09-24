import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, ClipboardCheck, Clock3, GraduationCap, RotateCcw, Send, ShieldCheck, AlertCircle, CheckCircle2, FileCheck2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const label = (status) => String(status || "assigned").replaceAll("_", " ");
const WORKFLOW = [
  ["assigned", "Assigned"],
  ["started", "Started"],
  ["submitted", "Submitted"],
  ["assessed", "Assessed"],
  ["competency_verified", "Authorised"],
];

function WorkflowRail({ status }) {
  const activeIndex = status === "returned" ? 1 : status === "archived" ? -1 : Math.max(0, WORKFLOW.findIndex(([key]) => key === status));
  return <ol className="learning-assignments__flow" aria-label="Assignment workflow">{WORKFLOW.map(([key, title], index) => <li key={key} className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""}><span>{index < activeIndex ? "✓" : index + 1}</span><small>{title}</small></li>)}</ol>;
}

export default function LearningAssignmentsPanel({ admin = false }) {
  const { session } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [items, setItems] = useState([]);
  const [nodeId, setNodeId] = useState("");
  const [userId, setUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [submissionNotes, setSubmissionNotes] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const call = useCallback(async (method, url, body) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not update learning assignment.");
    return data;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      setError("");
      const data = await call("GET", `/api/learning-assignments${admin ? "" : "?audience=staff"}`);
      setAssignments(data.assignments || []);
      setStaff(data.staff || []);
      setItems(data.items || []);
    } catch (requestError) { setError(requestError.message); }
  }, [admin, call, session?.access_token]);
  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => ({
    action: assignments.filter((assignment) => ["assigned", "started", "returned", "submitted", "assessed"].includes(assignment.status)).length,
    verified: assignments.filter((assignment) => assignment.status === "competency_verified").length,
  }), [assignments]);

  const assign = async () => {
    if (!nodeId || !userId) { setError("Choose an approved learning module and staff member."); return; }
    setBusy("create"); setError("");
    try {
      await call("POST", "/api/learning-assignments", { nodeId, userId, dueDate, note: assignmentNote });
      setNodeId(""); setUserId(""); setDueDate(""); setAssignmentNote("");
      setNotice("Learning assigned and notification sent.");
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(""); }
  };

  const act = async (assignment, action) => {
    const assignmentId = assignment.id;
    const payload = { action };
    if (action === "submit") payload.submissionNote = submissionNotes[assignmentId] || "";
    if (["assess", "verify", "return", "unlock"].includes(action)) payload.note = reviewNotes[assignmentId] || "";
    if (action === "submit" && !payload.submissionNote.trim()) { setError("Record the evidence you are submitting before sending this module for review."); return; }
    if (["assess", "verify", "return"].includes(action) && !payload.note.trim()) { setError("Record a reviewer decision note before continuing."); return; }
    setBusy(`${assignmentId}:${action}`); setError("");
    try {
      await call("PATCH", `/api/learning-assignments/${assignmentId}`, payload);
      setSubmissionNotes((current) => ({ ...current, [assignmentId]: "" }));
      setReviewNotes((current) => ({ ...current, [assignmentId]: "" }));
      setNotice(action === "verify" ? "Competency verified and authorisation scope recorded." : action === "submit" ? "Learning evidence submitted for review." : "Learning workflow updated.");
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(""); }
  };

  const reviewing = (assignment) => ["submitted", "assessed"].includes(assignment.status);
  return <section className={`learning-assignments ${admin ? "learning-assignments--admin" : ""}`}>
    <header><div><span>{admin ? "Learning governance · Admin" : "Your learning plan"}</span><h2><GraduationCap size={18} /> {admin ? "Assignments & competency" : "Assigned learning"}</h2><p>{admin ? "Assign approved structured modules, assess practical evidence and record authorisation scope through a complete, auditable workflow." : "Learn, practise and submit evidence here. Completion does not independently authorise work; your reviewer confirms competency and any limitations."}</p></div><button type="button" onClick={load}><RotateCcw size={14} /> Refresh</button></header>
    <div className="learning-assignments__summary"><span><strong>{summary.action}</strong> active workflow{summary.action === 1 ? "" : "s"}</span><span><strong>{summary.verified}</strong> competency verified</span></div>
    {error ? <p className="learning-assignments__error"><AlertCircle size={14} /> {error}</p> : null}{notice ? <p className="learning-assignments__notice"><CheckCircle2 size={14} /> {notice}</p> : null}
    {admin ? <div className="learning-assignments__create"><select value={nodeId} onChange={(event) => setNodeId(event.target.value)}><option value="">Approved learning module…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Staff member…</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" /><input placeholder="Assignment context or project (optional)" value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} /><button type="button" disabled={busy === "create"} onClick={assign}><Send size={14} /> {busy === "create" ? "Assigning…" : "Assign"}</button></div> : null}
    <div className="learning-assignments__list">{assignments.map((assignment) => {
      const isBusy = busy.startsWith(`${assignment.id}:`);
      return <article key={assignment.id} className={`learning-assignment-card ${assignment.status}`}><div className="learning-assignment-card__main"><div className="learning-assignment-card__title"><FileCheck2 size={16} /><strong>{assignment.ld_nodes?.title || "Learning module"}</strong></div><small>Due {assignment.due_date || "not set"} · <b className={`learning-assignments__status ${assignment.status}`}>{label(assignment.status)}</b></small><WorkflowRail status={assignment.status} />{assignment.assignment_note ? <p className="learning-assignment-card__note"><b>Assignment context:</b> {assignment.assignment_note}</p> : null}{assignment.submission_note ? <p className="learning-assignment-card__note"><b>Submitted evidence:</b> {assignment.submission_note}</p> : null}{assignment.assessment_note ? <p className="learning-assignment-card__note"><b>Assessment:</b> {assignment.assessment_note}</p> : null}{assignment.competency_scope ? <p className="learning-assignment-card__scope"><ShieldCheck size={14} /><span><b>Authorised scope / limitation:</b> {assignment.competency_scope}</span></p> : null}{assignment.remediation_note ? <p className="learning-assignment-card__return"><AlertCircle size={14} /><span><b>Further work required:</b> {assignment.remediation_note}</span></p> : null}</div><aside>{!admin && assignment.status === "assigned" ? <button type="button" disabled={isBusy} onClick={() => act(assignment, "start")}><Clock3 size={14} /> Start</button> : null}{!admin && ["assigned", "started", "returned"].includes(assignment.status) ? <><textarea value={submissionNotes[assignment.id] || ""} onChange={(event) => setSubmissionNotes((current) => ({ ...current, [assignment.id]: event.target.value }))} rows={2} placeholder="Evidence submitted: records, observed practice, assessment response or project example" /><button type="button" disabled={isBusy} onClick={() => act(assignment, "submit")}><Send size={14} /> {isBusy ? "Submitting…" : "Submit for review"}</button></> : null}{admin && reviewing(assignment) ? <><textarea value={reviewNotes[assignment.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [assignment.id]: event.target.value }))} rows={3} placeholder={assignment.status === "submitted" ? "Assessment decision and feedback (required)" : "Authorised scope, limitations and review conditions (required)"} /><div className="learning-assignment-card__actions">{assignment.status === "submitted" ? <button type="button" disabled={isBusy} onClick={() => act(assignment, "assess")}><ClipboardCheck size={14} /> Assess</button> : <button type="button" disabled={isBusy} onClick={() => act(assignment, "verify")}><BadgeCheck size={14} /> Verify competency</button>}<button type="button" className="secondary" disabled={isBusy} onClick={() => act(assignment, "return")}><RotateCcw size={14} /> Return</button></div></> : null}</aside></article>;
    })}{!assignments.length ? <p className="learning-assignments__empty">{admin ? "No learning assignments have been created yet." : "No learning modules are currently assigned to you."}</p> : null}</div>
  </section>;
}
