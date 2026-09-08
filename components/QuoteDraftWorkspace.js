"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, ChevronDown, Clock3, ContactRound,
  ExternalLink, FilePlus2, FileText, Loader2, Mail, MapPin, Paperclip, Plus,
  Send, ShieldCheck, Trash2, Upload, UserRoundCheck,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS = {
  awaiting_review: { label: "Awaiting review", tone: "slate", help: "New enquiry awaiting Senior Ecologist allocation." },
  awaiting_contact: { label: "Awaiting client contact", tone: "amber", help: "Allocated; direct client contact is required before quote preparation." },
  ready_to_generate: { label: "Ready to generate", tone: "gold", help: "Client contact, notes and confirmed scope are recorded." },
  quote_drafting: { label: "Quote drafting", tone: "forest", help: "Project and quote numbers are generated; prepare and review the quote." },
  transferred: { label: "Transferred to Pipeline", tone: "moss", help: "Issued quote is recorded in the formal Quote Pipeline as Pending." },
  withdrawn: { label: "Withdrawn", tone: "rose", help: "Enquiry will not proceed to a quote." },
};

const URGENCY = ["low", "medium", "high", "critical"];
const EMPTY = {
  clientName: "", company: "", clientEmail: "", clientPhone: "", preferredContactMethod: "",
  projectName: "", projectLocation: "", localGovernmentArea: "", state: "NSW",
  enquiryDescription: "", requiredServices: "", additionalAgencyRequirements: "", enquiryReceivedOn: new Date().toISOString().slice(0, 10),
  clientRequiredBy: "", approvalTimeframes: "", urgency: "medium", assignedTo: "", clientContacted: false,
  quoteDraftLink: "", quoteSent: false, projectNumber: "", quoteNumber: "", deliverables: "", quoteSentBy: "",
  quoteSentOn: "", quoteRecipientEmail: "", status: "awaiting_review",
};

function fromDraft(draft) {
  return {
    ...EMPTY,
    clientName: draft.client_name || "", company: draft.company || "", clientEmail: draft.client_email || "",
    clientPhone: draft.client_phone || "", preferredContactMethod: draft.preferred_contact_method || "",
    projectName: draft.project_name || "", projectLocation: draft.project_location || "",
    localGovernmentArea: draft.local_government_area || "", state: draft.state || "",
    enquiryDescription: draft.enquiry_description || "", requiredServices: draft.required_services || "",
    additionalAgencyRequirements: draft.additional_agency_requirements || "", enquiryReceivedOn: draft.enquiry_received_on || "",
    clientRequiredBy: draft.client_required_by || "", approvalTimeframes: draft.approval_timeframes || "",
    urgency: draft.urgency || "medium", assignedTo: draft.assigned_to || "", clientContacted: draft.client_contacted === true,
    quoteDraftLink: draft.quote_draft_link || "", quoteSent: draft.quote_sent === true,
    projectNumber: draft.project_number || "", quoteNumber: draft.quote_number || "",
    deliverables: draft.deliverables || "", quoteSentBy: draft.quote_sent_by || "",
    quoteSentOn: draft.quote_sent_on || "", quoteRecipientEmail: draft.quote_recipient_email || "", status: draft.status || "awaiting_review",
  };
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function StatusPill({ status }) {
  const detail = STATUS[status] || STATUS.awaiting_review;
  return <span className={`qdw-status qdw-status--${detail.tone}`} title={detail.help}>{detail.label}</span>;
}

function FormInput({ label, children, wide = false }) {
  return <label className={`qdw-field${wide ? " qdw-field--wide" : ""}`}><span>{label}</span>{children}</label>;
}

function DraftEditor({ value, setValue, staff, draft, onSave, onCancel, busy, onTransfer, onUpload, onOpenAttachment }) {
  const supportInput = useRef(null);
  const quotePdfInput = useRef(null);
  const status = draft?.status || (value.assignedTo ? "awaiting_contact" : "awaiting_review");
  const canTransfer = value.clientContacted && value.projectNumber.trim() && value.quoteNumber.trim() && value.quoteSent && value.quoteSentOn && value.quoteRecipientEmail && draft?.quote_pdf_path;
  const set = (key, next) => setValue({ ...value, [key]: next });
  const uploadFiles = async (event, quotePdf) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    for (const file of files) await onUpload(file, quotePdf);
  };

  return (
    <section className="qdw-editor">
      <div className="qdw-editor__title">
        <div><span className="qdw-kicker">{draft ? "Enquiry workspace" : "New enquiry"}</span><h2>{draft ? (draft.project_name || draft.client_name) : "Capture new quote enquiry"}</h2></div>
        {draft ? <StatusPill status={status} /> : null}
      </div>
      <div className="qdw-form-grid">
        <FormInput label="Client name"><input value={value.clientName} onChange={(event) => set("clientName", event.target.value)} placeholder="Client contact name" /></FormInput>
        <FormInput label="Company"><input value={value.company} onChange={(event) => set("company", event.target.value)} placeholder="Company / organisation" /></FormInput>
        <FormInput label="Client email"><input type="email" value={value.clientEmail} onChange={(event) => set("clientEmail", event.target.value)} placeholder="client@example.com" /></FormInput>
        <FormInput label="Client phone"><input value={value.clientPhone} onChange={(event) => set("clientPhone", event.target.value)} placeholder="04xx xxx xxx" /></FormInput>
        <FormInput label="Preferred contact method"><select value={value.preferredContactMethod} onChange={(event) => set("preferredContactMethod", event.target.value)}><option value="">Select</option><option>Phone</option><option>Email</option><option>Either</option></select></FormInput>
        <FormInput label="Assigned Senior Ecologist"><select value={value.assignedTo} onChange={(event) => set("assignedTo", event.target.value)}><option value="">Assign later</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.email}</option>)}</select></FormInput>
        <FormInput label="Project name (if known)"><input value={value.projectName} onChange={(event) => set("projectName", event.target.value)} /></FormInput>
        <FormInput label="Project location"><input value={value.projectLocation} onChange={(event) => set("projectLocation", event.target.value)} /></FormInput>
        <FormInput label="Local Government Area"><input value={value.localGovernmentArea} onChange={(event) => set("localGovernmentArea", event.target.value)} /></FormInput>
        <FormInput label="State"><input value={value.state} onChange={(event) => set("state", event.target.value)} /></FormInput>
        <FormInput label="Enquiry received"><input type="date" value={value.enquiryReceivedOn} onChange={(event) => set("enquiryReceivedOn", event.target.value)} /></FormInput>
        <FormInput label="Client required completion"><input type="date" value={value.clientRequiredBy} onChange={(event) => set("clientRequiredBy", event.target.value)} /></FormInput>
        <FormInput label="Urgency"><select value={value.urgency} onChange={(event) => set("urgency", event.target.value)}>{URGENCY.map((urgency) => <option value={urgency} key={urgency}>{urgency[0].toUpperCase()}{urgency.slice(1)}</option>)}</select></FormInput>
        <FormInput label="Approval timeframes"><input value={value.approvalTimeframes} onChange={(event) => set("approvalTimeframes", event.target.value)} placeholder="Known authority or programme constraints" /></FormInput>
        <FormInput label="Detailed request description" wide><textarea value={value.enquiryDescription} onChange={(event) => set("enquiryDescription", event.target.value)} /></FormInput>
        <FormInput label="Required ecology services" wide><textarea value={value.requiredServices} onChange={(event) => set("requiredServices", event.target.value)} /></FormInput>
        <FormInput label="Additional Council / agency requirements" wide><textarea value={value.additionalAgencyRequirements} onChange={(event) => set("additionalAgencyRequirements", event.target.value)} /></FormInput>
      </div>

      {draft ? <>
        <section className="qdw-gate">
          <div className="qdw-gate__heading"><ContactRound size={18} /><div><strong>Client-contact gate</strong><small>Confirm a direct client conversation has taken place before preparing the quote.</small></div></div>
          <label className="qdw-check"><input type="checkbox" checked={value.clientContacted} onChange={(event) => set("clientContacted", event.target.checked)} /> Client contacted prior to quote preparation</label>
        </section>

        <section className="qdw-files">
          <div className="qdw-gate__heading"><Paperclip size={18} /><div><strong>Supporting files and issued quote</strong><small>Plans, maps, DA/REF documents, authority correspondence, species studies and photos are stored as restricted attachments.</small></div></div>
          <div className="qdw-files__actions">
            <input ref={supportInput} type="file" multiple hidden onChange={(event) => uploadFiles(event, false)} />
            <button type="button" className="qdw-action qdw-action--secondary" disabled={busy || status === "transferred"} onClick={() => supportInput.current?.click()}><Upload size={16} /> Upload supporting file</button>
            <input ref={quotePdfInput} type="file" accept="application/pdf" hidden onChange={(event) => uploadFiles(event, true)} />
            <button type="button" className="qdw-action qdw-action--secondary" disabled={busy || status !== "quote_drafting" || status === "transferred"} onClick={() => quotePdfInput.current?.click()}><FilePlus2 size={16} /> Attach issued quote PDF</button>
          </div>
          <div className="qdw-attachments">{(draft.attachments || []).length ? draft.attachments.map((attachment) => <button type="button" onClick={() => onOpenAttachment(attachment.path)} key={attachment.path}><FileText size={14} />{attachment.name}</button>) : <span>No supporting files uploaded yet.</span>}</div>
          <div className="qdw-form-grid qdw-issue-grid">
            <FormInput label="Quote-draft workspace link" wide><input type="url" value={value.quoteDraftLink} onChange={(event) => set("quoteDraftLink", event.target.value)} placeholder="https://…" /></FormInput>
            <FormInput label="Project number"><input value={value.projectNumber} onChange={(event) => set("projectNumber", event.target.value)} placeholder="e.g. 2026-1001" /></FormInput>
            <FormInput label="Quote number"><input value={value.quoteNumber} onChange={(event) => set("quoteNumber", event.target.value)} placeholder="e.g. Q-2026-401" /></FormInput>
            <FormInput label="Deliverable(s)"><input value={value.deliverables} onChange={(event) => set("deliverables", event.target.value)} placeholder="e.g. 1, 2, 3 or a short description" /></FormInput>
            <FormInput label="Quote sent by"><select value={value.quoteSentBy} onChange={(event) => set("quoteSentBy", event.target.value)}><option value="">Select staff member</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></FormInput>
            <FormInput label="Quote sent date"><input type="date" value={value.quoteSentOn} onChange={(event) => set("quoteSentOn", event.target.value)} /></FormInput>
            <FormInput label="Quote recipient email"><input type="email" value={value.quoteRecipientEmail} onChange={(event) => set("quoteRecipientEmail", event.target.value)} /></FormInput>
          </div>
          <label className="qdw-check"><input type="checkbox" checked={value.quoteSent} onChange={(event) => set("quoteSent", event.target.checked)} /> Quote sent to client</label>
          <button type="button" className="qdw-action qdw-action--forest" disabled={busy || !canTransfer} onClick={onTransfer}><Send size={16} /> Transfer issued quote to Pipeline</button>
          {!canTransfer ? <small className="qdw-hint">Record the client-contact tick, project number, quote number, attached quote PDF, sent date and recipient email, then tick Quote sent to transfer it into the issued Quote Pipeline as Pending.</small> : null}
        </section>
      </> : null}

      <div className="qdw-editor__actions">
        <button type="button" className="qdw-action qdw-action--forest" onClick={onSave} disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}{draft ? "Save enquiry" : "Create draft enquiry"}</button>
        <button type="button" className="qdw-action qdw-action--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </section>
  );
}

export default function QuoteDraftWorkspace({ onPipelineChanged }) {
  const { session } = useAuth();
  const [drafts, setDrafts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [filters, setFilters] = useState({ status: "active", urgency: "", assigned: "", sort: "updated" });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const api = useCallback(async (method, path, body) => {
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${session?.access_token}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The quote-draft action could not be completed.");
    return data;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      setError("");
      const data = await api("GET", "/api/quote-drafts");
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setStaff(Array.isArray(data.staff) ? data.staff : []);
    } catch (err) { setError(err.message || "Could not load the draft enquiry register."); }
  }, [api, session?.access_token]);

  useEffect(() => { load(); }, [load]);
  const notify = (text) => { setMessage(text); setError(""); window.setTimeout(() => setMessage(""), 2800); };

  const saveNew = async () => {
    setBusy(true);
    try { await api("POST", "/api/quote-drafts", form); setForm(EMPTY); setAdding(false); await load(); notify("Draft enquiry created and workflow status assigned."); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try { const data = await api("PATCH", `/api/quote-drafts/${editing.id}`, { action: "save", ...editForm }); setEditing(data.draft); setEditForm(fromDraft(data.draft)); await load(); notify("Draft enquiry saved."); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const transfer = async () => {
    if (!editing || !window.confirm("Transfer this issued quote to the formal Quote Pipeline as Pending? The enquiry will remain as a read-only audit record.")) return;
    setBusy(true);
    try { await api("PATCH", `/api/quote-drafts/${editing.id}`, { action: "save", ...editForm }); const data = await api("PATCH", `/api/quote-drafts/${editing.id}`, { action: "transfer" }); setEditing(data.draft); setEditForm(fromDraft(data.draft)); await load(); onPipelineChanged?.(); notify("Issued quote transferred to the formal Quote Pipeline as Pending."); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const upload = async (file, quotePdf) => {
    if (!editing) return;
    setBusy(true);
    try { const body = new FormData(); body.append("file", file); body.append("quotePdf", String(quotePdf)); const data = await api("POST", `/api/quote-drafts/${editing.id}/attachments`, body); const next = { ...editing, ...data.draft }; setEditing(next); setEditForm(fromDraft(next)); await load(); notify(quotePdf ? "Issued quote PDF attached." : "Supporting file uploaded."); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const openAttachment = async (path) => {
    if (!editing) return;
    try { const data = await api("GET", `/api/quote-drafts/${editing.id}/attachments?path=${encodeURIComponent(path)}`); if (data.url) window.open(data.url, "_blank", "noopener,noreferrer"); }
    catch (err) { setError(err.message); }
  };
  const remove = async (draft) => {
    if (!window.confirm(`Delete the draft enquiry for ${draft.client_name || draft.company}? This cannot be undone.`)) return;
    setBusy(true);
    try { await api("DELETE", `/api/quote-drafts/${draft.id}`); if (editing?.id === draft.id) setEditing(null); await load(); notify("Draft enquiry deleted."); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const visible = drafts.filter((draft) => {
    if (filters.status === "active" && ["transferred", "withdrawn"].includes(draft.status)) return false;
    if (filters.status !== "active" && filters.status && draft.status !== filters.status) return false;
    if (filters.urgency && draft.urgency !== filters.urgency) return false;
    if (filters.assigned && draft.assigned_to !== filters.assigned) return false;
    return true;
  }).sort((left, right) => {
    if (filters.sort === "urgency") return URGENCY.indexOf(right.urgency) - URGENCY.indexOf(left.urgency);
    if (filters.sort === "due") return String(left.client_required_by || "9999-12-31").localeCompare(String(right.client_required_by || "9999-12-31"));
    if (filters.sort === "client") return String(left.client_name || left.company || "").localeCompare(String(right.client_name || right.company || ""));
    return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
  });

  return <div className="qdw">
    <header className="qdw-hero"><span><FilePlus2 size={17} /> Delivery & commercial · Quote Pipeline</span><h1>Quotes to be Drafted</h1><p>Capture, qualify and allocate enquiries before they become issued quotes. Direct client contact is recorded before quote numbers can be generated or a record can enter the formal Pipeline.</p></header>
    {error ? <p className="qdw-message qdw-message--error"><AlertCircle size={16} />{error}</p> : null}
    {message ? <p className="qdw-message qdw-message--success"><CheckCircle2 size={16} />{message}</p> : null}
    {adding ? <DraftEditor value={form} setValue={setForm} staff={staff} onSave={saveNew} onCancel={() => { setAdding(false); setForm(EMPTY); }} busy={busy} /> : null}
    {editing ? <DraftEditor value={editForm} setValue={setEditForm} staff={staff} draft={editing} onSave={saveEdit} onCancel={() => setEditing(null)} busy={busy} onTransfer={transfer} onUpload={upload} onOpenAttachment={openAttachment} /> : null}
    {!adding && !editing ? <button className="qdw-new" type="button" onClick={() => setAdding(true)}><Plus size={16} /> New enquiry</button> : null}

    <section className="qdw-controls"><div><ListIcon /><strong>Draft enquiry register</strong><small>{visible.length} of {drafts.length} records</small></div><label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="active">Active work</option>{Object.entries(STATUS).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}</select></label><label>Urgency<select value={filters.urgency} onChange={(event) => setFilters({ ...filters, urgency: event.target.value })}><option value="">All urgency</option>{URGENCY.map((value) => <option value={value} key={value}>{value[0].toUpperCase()}{value.slice(1)}</option>)}</select></label><label>Assignee<select value={filters.assigned} onChange={(event) => setFilters({ ...filters, assigned: event.target.value })}><option value="">All staff</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>Sort<select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}><option value="updated">Recently updated</option><option value="urgency">Urgency</option><option value="due">Client due date</option><option value="client">Client A–Z</option></select></label></section>
    <div className="qdw-list">{visible.map((draft) => <article className={`qdw-card qdw-card--${draft.urgency || "medium"}`} key={draft.id}><div className="qdw-card__top"><div><span className="qdw-card__urgency">{draft.urgency || "medium"}</span><h2>{draft.project_name || draft.client_name || draft.company}</h2><p>{draft.client_name}{draft.company ? ` · ${draft.company}` : ""}</p></div><StatusPill status={draft.status} /></div><dl><div><dt>Assigned</dt><dd>{draft.assigned_name || "Unassigned"}</dd></div><div><dt>Received</dt><dd>{formatDate(draft.enquiry_received_on)}</dd></div><div><dt>Client due</dt><dd>{formatDate(draft.client_required_by)}</dd></div><div><dt>Numbers</dt><dd>{draft.project_number && draft.quote_number ? `${draft.project_number} · ${draft.quote_number}` : "Not generated"}</dd></div></dl><p className="qdw-card__description">{draft.enquiry_description || draft.required_services || "No detailed scope recorded yet."}</p><div className="qdw-card__actions"><button type="button" onClick={() => { setEditing(draft); setEditForm(fromDraft(draft)); }}>Open workspace <ChevronDown size={15} /></button><button type="button" onClick={() => remove(draft)} disabled={busy || draft.status === "transferred"} title={draft.status === "transferred" ? "Transferred audit records are retained" : "Delete draft enquiry"}><Trash2 size={15} /></button></div></article>)}{!drafts.length ? <div className="qdw-empty"><Clock3 size={24} /><strong>No quote enquiries yet</strong><p>Record a new enquiry to start the controlled review and client-contact workflow.</p></div> : null}{drafts.length && !visible.length ? <div className="qdw-empty"><strong>No enquiries match the selected filters.</strong></div> : null}</div>
  </div>;
}

function ListIcon() { return <FileText size={16} aria-hidden="true" />; }
