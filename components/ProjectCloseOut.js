import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Lock, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const EMPTY = {
  status: "not_started",
  successScore: "",
  clientOutcome: "",
  deliverySummary: "",
  lessonsLearned: "",
  stakeholderFeedback: "",
  financialReviewNotes: "",
  recommendations: "",
  approvalNote: "",
};
const STATUSES = [
  ["not_started", "Not started"],
  ["initiated", "Initiated"],
  ["awaiting_reviews", "Awaiting reviews"],
  ["awaiting_manager_approval", "Awaiting manager approval"],
  ["closed", "Closed and locked"],
  ["archived", "Archived"],
];

function fromRow(row) {
  return {
    status: row?.status || "not_started",
    successScore: row?.success_score ?? "",
    clientOutcome: row?.client_outcome || "",
    deliverySummary: row?.delivery_summary || "",
    lessonsLearned: row?.lessons_learned || "",
    stakeholderFeedback: row?.stakeholder_feedback || "",
    financialReviewNotes: row?.financial_review_notes || "",
    recommendations: row?.recommendations || "",
    approvalNote: row?.approval_note || "",
  };
}

export default function ProjectCloseOut({ projectId, projectName, onToast }) {
  const { session } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [closeout, setCloseout] = useState(null);
  const [actions, setActions] = useState([]);
  const [actionForm, setActionForm] = useState({ title: "", description: "", dueDate: "", status: "draft" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const api = useCallback(async (method, body) => {
    const response = await fetch(`/api/projects/${projectId}/closeout`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The close-out action could not be completed.");
    return data;
  }, [projectId, session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token || !projectId) return;
    setLoading(true);
    try {
      const data = await api("GET");
      setCloseout(data.closeout || null);
      setForm(fromRow(data.closeout));
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setError("");
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [api, projectId, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const data = await api("POST", form);
      setCloseout(data.closeout);
      setForm(fromRow(data.closeout));
      onToast?.(form.status === "closed" ? "Project close-out approved and locked." : "Project close-out saved.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const addAction = async () => {
    if (!actionForm.title.trim()) return;
    setBusy(true);
    try {
      await api("POST", { action: "upsert_improvement", closeoutId: closeout?.id || null, ...actionForm });
      setActionForm({ title: "", description: "", dueDate: "", status: "draft" });
      await load();
      onToast?.("Improvement action added.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const archiveAction = async (id) => {
    setBusy(true);
    try { await api("POST", { action: "archive_improvement", actionId: id }); await load(); onToast?.("Improvement action archived."); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const locked = Boolean(closeout?.locked_at) || form.status === "closed";

  if (loading) return <section className="pco-card"><p className="aps-note">Loading project close-out…</p></section>;
  return <section className="pco-card">
    <header className="pco-head"><div><span className="pco-kicker"><ClipboardCheck size={14} /> Project governance</span><h2>Project Close-Out</h2><p>Capture delivery outcomes, lessons, stakeholder feedback and improvements before the project is archived.</p></div><span className={`pco-status pco-status--${form.status}`}>{STATUSES.find(([value]) => value === form.status)?.[1] || "Not started"}</span></header>
    {error ? <p className="pco-error">{error}</p> : null}
    <div className="pco-project"><strong>{projectName || "Selected project"}</strong><span>Close-out remains scoped to this project and cannot link actions to another project.</span></div>
    <div className="pco-grid">
      <label>Status<select value={form.status} disabled={locked && form.status !== "archived"} onChange={(event) => set("status", event.target.value)}>{STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Success score<select value={form.successScore} disabled={locked && form.status !== "archived"} onChange={(event) => set("successScore", event.target.value)}><option value="">Not scored</option>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
      <label className="pco-wide">Client outcome<textarea rows={3} disabled={locked && form.status !== "archived"} value={form.clientOutcome} onChange={(event) => set("clientOutcome", event.target.value)} placeholder="What outcome was delivered for the client?" /></label>
      <label className="pco-wide">Delivery summary<textarea rows={3} disabled={locked && form.status !== "archived"} value={form.deliverySummary} onChange={(event) => set("deliverySummary", event.target.value)} placeholder="Summarise scope, dates, key deliverables and exceptions." /></label>
      <label>Lessons learned<textarea rows={4} disabled={locked && form.status !== "archived"} value={form.lessonsLearned} onChange={(event) => set("lessonsLearned", event.target.value)} placeholder="What should be repeated or changed?" /></label>
      <label>Stakeholder feedback<textarea rows={4} disabled={locked && form.status !== "archived"} value={form.stakeholderFeedback} onChange={(event) => set("stakeholderFeedback", event.target.value)} placeholder="Summarise client and team feedback." /></label>
      <label>Financial review notes<textarea rows={4} disabled={locked && form.status !== "archived"} value={form.financialReviewNotes} onChange={(event) => set("financialReviewNotes", event.target.value)} placeholder="Record approved budget-versus-actual observations only." /></label>
      <label>Recommendations<textarea rows={4} disabled={locked && form.status !== "archived"} value={form.recommendations} onChange={(event) => set("recommendations", event.target.value)} placeholder="Recommended process, training or template improvements." /></label>
      <label className="pco-wide">Approval note<textarea rows={2} disabled={locked && form.status !== "archived"} value={form.approvalNote} onChange={(event) => set("approvalNote", event.target.value)} placeholder="Administrator approval or amendment note." /></label>
    </div>
    <div className="pco-actions"><button type="button" className="aps-primary" disabled={busy || (locked && form.status !== "archived")} onClick={save}>{form.status === "closed" ? <Lock size={14} /> : <Save size={14} />} {form.status === "closed" ? "Approve and lock close-out" : "Save close-out"}</button>{locked ? <span className="pco-locked"><Lock size={13} /> Locked records require administrator reopening.</span> : null}</div>
    <section className="pco-improvements"><div className="pco-section-head"><div><h3>Improvement actions</h3><p>Actions generated from this project remain project-scoped and auditable.</p></div><span>{actions.length} active</span></div><div className="pco-action-form"><input value={actionForm.title} onChange={(event) => setActionForm({ ...actionForm, title: event.target.value })} placeholder="Improvement action" /><input value={actionForm.description} onChange={(event) => setActionForm({ ...actionForm, description: event.target.value })} placeholder="Description" /><input type="date" value={actionForm.dueDate} onChange={(event) => setActionForm({ ...actionForm, dueDate: event.target.value })} /><button type="button" className="aps-secondary" disabled={busy || locked} onClick={addAction}><Plus size={13} /> Add action</button></div>{actions.length ? <div className="pco-actions-list">{actions.map((action) => <div className="pco-action-row" key={action.id}><div><strong>{action.title}</strong><span>{action.description || "No description"}{action.due_date ? ` · due ${action.due_date}` : ""}</span></div><div><span className={`pco-action-status pco-action-status--${action.status}`}>{action.status.replaceAll("_", " ")}</span><button type="button" className="pco-icon-button" disabled={busy || locked} onClick={() => archiveAction(action.id)} title="Archive improvement action"><Trash2 size={14} /></button></div></div>)}</div> : <p className="pco-empty">No improvement actions have been recorded.</p>}</section>
    <p className="pco-footnote"><CheckCircle2 size={14} /> Close-out approval locks the record and keeps the project’s historical delivery record available for audit.</p>
  </section>;
}
