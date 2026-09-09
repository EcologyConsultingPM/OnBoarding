import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, CheckCircle2, ChevronDown, CircleAlert, ClipboardCheck, ExternalLink,
  FileCheck2, FilePenLine, FileText, FolderCheck, FolderClock, Loader2,
  MessageSquare, Plus, RefreshCw, Send, ShieldCheck, Upload, Users,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import GovernanceBulkImport from "./GovernanceBulkImport";

const STATUS = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "review" },
  pending_approval: { label: "Pending approval", tone: "pending" },
  published: { label: "Approved", tone: "approved" },
  rejected: { label: "Amendment requested", tone: "declined" },
  archived: { label: "Archived", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

const DOC_TYPES = [
  { value: "policy", singular: "Policy", plural: "Policies", desc: "Approved standards and commitments", image: "wattle.png" },
  { value: "procedure", singular: "Procedure", plural: "Procedures & methods", desc: "SOPs, methods and decision tools", image: "kookaburra.png" },
  { value: "plan", singular: "Plan", plural: "Plans & controls", desc: "WHS, emergency and control plans", image: "bottlebrush.png" },
  { value: "form", singular: "Form", plural: "Forms & registers", desc: "Controlled forms, inspections and registers", image: "kangaroo.png" },
  { value: "project_control", singular: "Project control", plural: "Project controls", desc: "Scope, schedule, risk and closure", image: "palm-cockatoo.png" },
  { value: "people_capability", singular: "People & capability record", plural: "People & capability", desc: "Position and development records", image: "lorikeet.png" },
  { value: "contractor_control", singular: "Contractor control", plural: "Contractor controls", desc: "Contractor qualification controls", image: "everlastings.png" },
];

const EMPTY_DRAFT = {
  doc_type: "policy", title: "", category: "Internal Governance", version: "1.0",
  body: "", document_link: "", requires_ack: true, requires_training: false,
};

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function isoDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function Badge({ status }) {
  const metadata = STATUS[status] || { label: status, tone: "neutral" };
  return <span className={`governance-badge ${metadata.tone}`}>{metadata.label}</span>;
}

function Metric({ label, value, alert = false }) {
  return <div className="governance-metric"><strong className={alert ? "alert" : ""}>{value}</strong><span>{label}</span></div>;
}

// Internal Governance is a controlled library. Staff can only read approved
// documents (and any review document the admin expressly shares), while all
// drafting, publication, versioning and archive actions remain administrator-only.
export default function InternalGovernance({ isAdmin = false, onToast = () => {} }) {
  const { session } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("policy");
  const [folder, setFolder] = useState("approved");
  const [selectedId, setSelectedId] = useState(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [actionOpen, setActionOpen] = useState(null);
  const [actionForm, setActionForm] = useState({ consultation_scope: "all_staff", consultation_user_ids: [], consultation_ends_at: isoDateOffset(14), effective_date: isoDateOffset(0), next_review_date: isoDateOffset(730), change_note: "" });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const api = useCallback(async (method, body) => {
    const response = await fetch("/api/internal-governance", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The governance action could not be completed.");
    return data;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const data = await api("GET");
      setDocuments(data.documents || []);
      setStaff(data.staff || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load Internal Governance.");
    } finally {
      setLoading(false);
    }
  }, [api, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const selected = documents.find((document) => document.id === selectedId) || null;
  const selectedType = DOC_TYPES.find((item) => item.value === type) || DOC_TYPES[0];
  const selectedDocumentType = DOC_TYPES.find((item) => item.value === selected?.doc_type);
  const folders = useMemo(() => ({
    approved: documents.filter((document) => document.doc_type === type && document.status === "published"),
    review: documents.filter((document) => document.doc_type === type && document.status === "in_review"),
    management: documents.filter((document) => document.doc_type === type && !["published", "in_review"].includes(document.status)),
  }), [documents, type]);
  const visibleDocuments = isAdmin && folder === "management" ? folders.management : folders[folder] || [];
  const metrics = useMemo(() => ({
    approved: documents.filter((document) => document.status === "published").length,
    controls: documents.filter((document) => ["plan", "procedure", "project_control"].includes(document.doc_type) && document.status === "published").length,
    registers: documents.filter((document) => document.doc_type === "form" && document.status === "published").length,
    inReview: documents.filter((document) => document.status === "in_review").length,
    overdue: documents.filter((document) => document.status === "published" && document.next_review_date && new Date(document.next_review_date) < new Date()).length,
  }), [documents]);

  const run = async (method, body, success) => {
    setBusy(true);
    setError("");
    try {
      await api(method, body);
      onToast(success);
      setActionOpen(null);
      setComment("");
      await load();
    } catch (err) {
      setError(err.message || "The governance action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async () => {
    if (!draft.title.trim()) return setError("A document title is required.");
    await run("POST", { action: "create", ...draft }, "Governance draft created.");
    setDraft(EMPTY_DRAFT);
    setDraftOpen(false);
  };

  const uploadForDraft = async (createdDocument) => {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${createdDocument.doc_type}s/${createdDocument.id}/v${createdDocument.version}/${Date.now()}-${safeFileName}`;
    const { error: uploadError } = await supabase.storage.from("governance-documents").upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) throw uploadError;
    await api("PATCH", { id: createdDocument.id, action: "edit_draft", storage_path: path, change_note: "Approved file uploaded to draft." });
  };

  const createDraftWithUpload = async () => {
    if (!draft.title.trim()) return setError("A document title is required.");
    setBusy(true);
    setError("");
    try {
      const created = await api("POST", { action: "create", ...draft });
      await uploadForDraft(created.document);
      onToast("Governance draft created.");
      setDraft(EMPTY_DRAFT);
      setDraftOpen(false);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (err) {
      setError(err.message || "The governance draft could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (document) => {
    try {
      if (document.document_link) {
        window.open(document.document_link, "_blank", "noopener,noreferrer");
        return;
      }
      const response = await api("PUT", { id: document.id });
      window.open(response.signed_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message || "The document could not be opened.");
    }
  };

  const submitComment = () => {
    if (!selected || !comment.trim()) return setError("Please enter a consultation comment.");
    run("POST", { action: "comment", document_id: selected.id, comment }, "Consultation comment submitted.");
  };

  const acknowledge = () => {
    if (!selected) return;
    run("POST", { action: "acknowledge", document_id: selected.id }, "Document acknowledged.");
  };

  const action = (name, payload, success) => {
    if (!selected) return;
    run("PATCH", { id: selected.id, action: name, ...payload }, success);
  };

  return (
    <section className="governance" aria-label="Internal Governance">
      <header className="governance-hero">
        <div>
          <span><ShieldCheck size={14} /> WHS &amp; EC Forms · Internal Governance</span>
          <h1>Internal Governance</h1>
          <p>Controlled policies, procedures, plans, forms, registers and project controls. Approved documents are read-only; review documents are visible only during their consultation period.</p>
        </div>
        {isAdmin ? <button className="governance-new" onClick={() => setDraftOpen((value) => !value)}><Plus size={15} /> Create document</button> : null}
      </header>

      {isAdmin ? <div className="governance-metrics">
        <Metric label="Approved library" value={metrics.approved} />
        <Metric label="Plans & controls" value={metrics.controls} />
        <Metric label="Forms & registers" value={metrics.registers} />
        <Metric label="In review" value={metrics.inReview} />
        <Metric label="Overdue review" value={metrics.overdue} alert={metrics.overdue > 0} />
      </div> : null}

      {error ? <p className="governance-error"><CircleAlert size={15} /> {error}</p> : null}

      {isAdmin ? <GovernanceBulkImport onComplete={load} /> : null}

      {isAdmin && draftOpen ? <section className="governance-editor">
        <div className="governance-editor-head"><h2><FilePenLine size={17} /> New governance document</h2><button onClick={() => setDraftOpen(false)}>Close</button></div>
        <div className="governance-form-grid">
          <label><span>Document type</span><select value={draft.doc_type} onChange={(event) => setDraft({ ...draft, doc_type: event.target.value })}>{DOC_TYPES.map((item) => <option key={item.value} value={item.value}>{item.singular}</option>)}</select></label>
          <label><span>Version</span><input value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} placeholder="1.0" /></label>
          <label className="wide"><span>Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Environmental Field Safety Policy" /></label>
          <label><span>Category</span><input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
          <label><span>Document link (optional)</span><input type="url" value={draft.document_link} onChange={(event) => setDraft({ ...draft, document_link: event.target.value })} placeholder="https://…" /></label>
          <label className="wide"><span>Draft content / change summary</span><textarea rows={4} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="Enter the controlled text or a summary of the uploaded document." /></label>
          <label className="wide"><span>Controlled source file (PDF or Word, optional)</span><input ref={fileInput} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label>
        </div>
        <div className="governance-checks"><label><input type="checkbox" checked={draft.requires_ack} onChange={(event) => setDraft({ ...draft, requires_ack: event.target.checked })} /> Staff acknowledgement required when approved</label><label><input type="checkbox" checked={draft.requires_training} onChange={(event) => setDraft({ ...draft, requires_training: event.target.checked })} /> Training module required when approved</label></div>
        <button className="governance-primary" disabled={busy} onClick={createDraftWithUpload}>{busy ? <Loader2 className="spin" size={15} /> : <FilePenLine size={15} />} Save draft</button>
      </section> : null}

      <div className="governance-category-grid" role="tablist" aria-label="Internal Governance document categories">
        {DOC_TYPES.map((item) => {
          const count = documents.filter((document) => document.doc_type === item.value && (document.status === "published" || isAdmin)).length;
          return <button key={item.value} role="tab" aria-selected={type === item.value} className={`governance-category-card${type === item.value ? " selected" : ""}`} onClick={() => { setType(item.value); setSelectedId(null); }}>
            <img src={`/assets/${item.image}`} alt="" aria-hidden="true" />
            <span className="governance-category-scrim" />
            <span className="governance-category-content"><strong>{item.plural}</strong><small>{item.desc}</small><em>{count} available</em></span>
          </button>;
        })}
      </div>
      <div className="governance-folders" aria-label="Document folder"><button className={folder === "approved" ? "selected" : ""} onClick={() => setFolder("approved")}><FolderCheck size={14} /> Approved</button><button className={folder === "review" ? "selected" : ""} onClick={() => setFolder("review")}><FolderClock size={14} /> In review</button>{isAdmin ? <button className={folder === "management" ? "selected" : ""} onClick={() => setFolder("management")}><FileText size={14} /> Drafts &amp; approvals</button> : null}</div>

      <div className="governance-layout">
        <div className="governance-list">
          {loading ? <p className="governance-empty">Loading governance register…</p> : null}
          {!loading && visibleDocuments.length === 0 ? <p className="governance-empty">No {selectedType.plural.toLowerCase()} are in this folder.</p> : null}
          {!loading && visibleDocuments.map((document) => <button key={document.id} className={`governance-document${selectedId === document.id ? " selected" : ""}`} onClick={() => { setSelectedId(document.id); setActionOpen(null); setComment(""); }}>
              <div><Badge status={document.status} /><h3>{document.title}</h3><p>{DOC_TYPES.find((item) => item.value === document.doc_type)?.singular || document.doc_type} · v{document.version} · {document.category || "Internal Governance"}</p></div><ChevronDown size={16} />
          </button>)}
        </div>

        <aside className="governance-detail">
          {!selected ? <p className="governance-empty">Select a document to view its controlled details.</p> : <>
            <div className="governance-detail-title"><div><Badge status={selected.status} /><h2>{selected.title}</h2><p>{selectedDocumentType?.singular || selected.doc_type} · v{selected.version}</p></div>{(selected.document_link || selected.storage_path) ? <button className="governance-open" onClick={() => openDocument(selected)}><ExternalLink size={14} /> Open document</button> : null}</div>
            <dl className="governance-meta"><div><dt>Effective</dt><dd>{displayDate(selected.effective_date)}</dd></div><div><dt>Next review</dt><dd>{displayDate(selected.next_review_date)}</dd></div>{selected.status === "in_review" ? <div><dt>Consultation closes</dt><dd>{displayDate(selected.consultation_ends_at)}</dd></div> : null}{selected.status === "published" ? <div><dt>Approved</dt><dd>{displayDate(selected.approved_at)}</dd></div> : null}</dl>
            {selected.body ? <div className="governance-body">{selected.body}</div> : null}
            {selected.requires_training && selected.status === "published" ? <p className="governance-training"><ClipboardCheck size={14} /> A training module is required for this document.</p> : null}

            {!isAdmin && selected.status === "published" && selected.requires_ack ? <button className="governance-primary" disabled={busy || selected.acknowledged} onClick={acknowledge}>{selected.acknowledged ? <><CheckCircle2 size={15} /> Acknowledged</> : <><CheckCircle2 size={15} /> Confirm read and understood</>}</button> : null}
            {!isAdmin && selected.status === "in_review" ? <div className="governance-comment"><label><MessageSquare size={14} /> Consultation comment<textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Provide feedback or identify an issue for review." /></label><button className="governance-primary" disabled={busy} onClick={submitComment}><Send size={14} /> Submit comment</button></div> : null}

            {isAdmin ? <AdminActions document={selected} staff={staff} actionOpen={actionOpen} setActionOpen={setActionOpen} form={actionForm} setForm={setActionForm} busy={busy} action={action} openDocument={openDocument} /> : null}
          </>}
        </aside>
      </div>
    </section>
  );
}

function AdminActions({ document, staff, actionOpen, setActionOpen, form, setForm, busy, action }) {
  const setUsers = (event) => setForm({ ...form, consultation_user_ids: Array.from(event.target.selectedOptions).map((option) => option.value) });
  const simpleAction = (name, message) => action(name, { change_note: form.change_note }, message);

  return <div className="governance-admin-actions">
    <h3>Administrator controls</h3>
    {document.status === "draft" || document.status === "rejected" ? <button className="governance-action-btn" onClick={() => setActionOpen("consultation")}><Users size={14} /> Open consultation</button> : null}
    {document.status === "in_review" ? <button className="governance-action-btn" onClick={() => simpleAction("submit_for_approval", "Document submitted for approval.")} disabled={busy}><Send size={14} /> Submit for approval</button> : null}
    {document.status === "pending_approval" ? <><button className="governance-action-btn" onClick={() => setActionOpen("publish")}><CheckCircle2 size={14} /> Approve and publish</button><button className="governance-action-btn secondary" onClick={() => setActionOpen("reject")}><CircleAlert size={14} /> Request amendment</button></> : null}
    {document.status === "published" ? <><button className="governance-action-btn" onClick={() => action("new_revision", {}, "New revision created in Drafts.")} disabled={busy}><FilePenLine size={14} /> Create new revision</button><button className="governance-action-btn secondary" onClick={() => action("archive", {}, "Document archived.")} disabled={busy}><Archive size={14} /> Archive version</button></> : null}

    {actionOpen === "consultation" ? <div className="governance-action-panel"><label>Audience<select value={form.consultation_scope} onChange={(event) => setForm({ ...form, consultation_scope: event.target.value })}><option value="all_staff">All staff</option><option value="selected_staff">Selected staff</option></select></label>{form.consultation_scope === "selected_staff" ? <label>Staff members<select multiple value={form.consultation_user_ids} onChange={setUsers}>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label> : null}<label>Consultation closes<input type="date" value={form.consultation_ends_at} onChange={(event) => setForm({ ...form, consultation_ends_at: event.target.value })} /></label><button className="governance-primary" disabled={busy} onClick={() => action("open_consultation", form, "Document opened for consultation and published to the staff noticeboard.")}>Publish for consultation</button></div> : null}
    {actionOpen === "publish" ? <div className="governance-action-panel"><label>Effective date<input type="date" value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} /></label><label>Next review date<input type="date" value={form.next_review_date} onChange={(event) => setForm({ ...form, next_review_date: event.target.value })} /></label><button className="governance-primary" disabled={busy} onClick={() => action("approve_publish", form, "Document approved, locked and published to the staff noticeboard.")}>Approve and publish</button></div> : null}
    {actionOpen === "reject" ? <div className="governance-action-panel"><label>Amendment note<textarea rows={2} value={form.change_note} onChange={(event) => setForm({ ...form, change_note: event.target.value })} placeholder="Describe required amendments." /></label><button className="governance-action-btn secondary" disabled={busy} onClick={() => action("reject", form, "Amendment request recorded.")}>Return for amendment</button></div> : null}
  </div>;
}
