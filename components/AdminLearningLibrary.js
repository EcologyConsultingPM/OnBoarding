"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Folder,
  GraduationCap,
  Home,
  Plus,
  ShieldAlert,
  Trash2,
  X,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import LearningAssignmentsPanel from "./LearningAssignmentsPanel";
import LearningModuleDetail from "./LearningModuleDetail";

const TYPE_ICON = { section: GraduationCap, career_level: Folder, module: Folder, folder: Folder, item: FileText };
const APPROVAL = {
  draft: { label: "Draft" },
  pending_review: { label: "Pending review" },
  approved: { label: "Approved" },
  archived: { label: "Archived" },
};

export default function AdminLearningLibrary() {
  const { session } = useAuth();
  const [parent, setParent] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [trail, setTrail] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedModule, setSelectedModule] = useState(null);
  const [newNode, setNewNode] = useState({ title: "", kind: "learning_module", node_type: "folder", visibility: "staff" });

  const auth = useCallback((method, url, body) => fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session?.access_token]);

  const load = useCallback(async (parentId = parent) => {
    if (!session?.access_token) return;
    try {
      const query = parentId ? `?parent=${parentId}` : "";
      const response = await auth("GET", `/api/ld${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load the learning library.");
      setNodes(data.nodes || []);
      setTrail(data.trail || []);
    } catch (requestError) {
      setError(requestError.message || "Could not load the learning library.");
    }
  }, [auth, parent, session?.access_token]);

  useEffect(() => { load(parent); }, [load, parent]);
  const notify = (text) => { setMessage(text); setError(""); window.setTimeout(() => setMessage(""), 2600); };

  const create = async () => {
    if (!newNode.title.trim()) { setError("Enter a title."); return; }
    try {
      const learningModule = newNode.kind === "learning_module";
      const response = await auth("POST", "/api/ld", {
        parent_id: parent,
        title: newNode.title.trim(),
        node_type: learningModule ? "item" : newNode.node_type,
        content_type: learningModule ? "learning_module" : null,
        visibility: newNode.visibility,
        sort_order: nodes.length,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not add this library item.");
      setAdding(false);
      setNewNode({ title: "", kind: "learning_module", node_type: "folder", visibility: "staff" });
      await load(parent);
      if (learningModule) setSelectedModule(data.node);
      notify(learningModule ? "Structured learning module created. Complete its required sections before review." : "Library structure added.");
    } catch (requestError) {
      setError(requestError.message || "Could not add this library item.");
    }
  };

  const act = async (node, action) => {
    try {
      const response = await auth("PATCH", `/api/ld/${node.id}`, { action });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update this learning item.");
      await load(parent);
      notify(action === "approve" ? "Learning content approved and released to staff." : action === "submit_review" ? "Submitted for controlled review." : "Learning item archived.");
    } catch (requestError) {
      setError(requestError.message || "Could not update this learning item.");
    }
  };

  const toggleVisibility = async (node) => {
    try {
      const response = await auth("PATCH", `/api/ld/${node.id}`, { visibility: node.visibility === "admin" ? "staff" : "admin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update visibility.");
      await load(parent);
      notify(data.node.visibility === "staff" ? "Made staff-visible." : "Restricted to administrators.");
    } catch (requestError) {
      setError(requestError.message || "Could not update visibility.");
    }
  };

  const rename = async (node) => {
    const title = window.prompt("Rename learning item:", node.title);
    if (!title?.trim()) return;
    try {
      const response = await auth("PATCH", `/api/ld/${node.id}`, { title: title.trim() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not rename this learning item.");
      await load(parent);
      notify("Title updated.");
    } catch (requestError) {
      setError(requestError.message || "Could not rename this learning item.");
    }
  };

  const remove = async (node) => {
    if (!window.confirm(`Delete “${node.title}” and anything inside it? This cannot be undone.`)) return;
    try {
      const response = await auth("DELETE", `/api/ld/${node.id}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete this learning item.");
      await load(parent);
      notify("Learning item deleted.");
    } catch (requestError) {
      setError(requestError.message || "Could not delete this learning item.");
    }
  };

  const overview = useMemo(() => ({
    draft: nodes.filter((node) => node.approval_status === "draft").length,
    review: nodes.filter((node) => node.approval_status === "pending_review").length,
    approved: nodes.filter((node) => node.approval_status === "approved").length,
  }), [nodes]);

  if (selectedModule) {
    return <LearningModuleDetail node={selectedModule} audience="admin" onBack={() => { setSelectedModule(null); load(parent); }} onSaved={(node) => setSelectedModule(node)} />;
  }

  return (
    <div className="ld admin-learning-library">
      <header className="ld-admin-hero">
        <div>
          <span>Ecology Consulting · Controlled learning</span>
          <h1>Learning modules &amp; competency</h1>
          <p>Create clear, evidence-based learning modules, control their release to staff, and keep assessment and competency decisions in one traceable workflow.</p>
        </div>
        <ol className="ld-cycle" aria-label="Learning cycle">
          {[["Learn", "Understand"], ["Practise", "With supervision"], ["Demonstrate", "Apply"], ["Review", "Assess evidence"], ["Authorise", "Record scope"]].map(([title, caption], index) => <li key={title}><span>{index + 1}</span><strong>{title}</strong><small>{caption}</small></li>)}
        </ol>
      </header>

      <section className="ld-admin-summary" aria-label="Library status">
        <div><span>{overview.draft}</span><small>Drafts in this folder</small></div>
        <div><span>{overview.review}</span><small>Awaiting review</small></div>
        <div><span>{overview.approved}</span><small>Approved &amp; available</small></div>
        <p><ShieldAlert size={16} /> Completion of content does not authorise independent work. Use the assignment workflow to assess and verify competency.</p>
      </section>

      {error ? <p className="ld-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="ld-success"><CheckCircle2 size={15} /> {message}</p> : null}

      <LearningAssignmentsPanel admin />

      <section className="ld-library-panel">
        <div className="ld-library-panel__head">
          <div>
            <span>Library structure</span>
            <h2>Build and release learning content</h2>
          </div>
          <button className="ld-add-btn" type="button" onClick={() => setAdding((open) => !open)}>{adding ? <X size={15} /> : <Plus size={15} />}{adding ? "Cancel" : "Add content"}</button>
        </div>

        <div className="ld-crumbs">
          <button type="button" onClick={() => setParent(null)} className="ld-crumb"><Home size={14} /> Library</button>
          {trail.map((item) => <span key={item.id} className="ld-crumb-wrap"><ChevronRight size={13} className="ld-crumb-sep" /><button type="button" onClick={() => setParent(item.id)} className="ld-crumb">{item.title}</button></span>)}
        </div>

        {adding ? <div className="ld-create-card">
          <div className="ld-create-kinds">
            <button type="button" className={newNode.kind === "learning_module" ? "selected" : ""} onClick={() => setNewNode({ ...newNode, kind: "learning_module" })}><BookOpen size={18} /><strong>Learning module</strong><small>Structured content with assessment, evidence, authority and escalation.</small></button>
            <button type="button" className={newNode.kind === "structure" ? "selected" : ""} onClick={() => setNewNode({ ...newNode, kind: "structure" })}><Folder size={18} /><strong>Library structure</strong><small>Section, level or folder used to organise learning resources.</small></button>
          </div>
          <div className="ld-create-fields">
            <input placeholder={newNode.kind === "learning_module" ? "e.g. Field Data Capture" : "e.g. 02 Ecological Practice"} value={newNode.title} onChange={(event) => setNewNode({ ...newNode, title: event.target.value })} autoFocus />
            {newNode.kind === "structure" ? <select value={newNode.node_type} onChange={(event) => setNewNode({ ...newNode, node_type: event.target.value })}><option value="section">Section</option><option value="career_level">Career level</option><option value="folder">Folder</option></select> : null}
            <select value={newNode.visibility} onChange={(event) => setNewNode({ ...newNode, visibility: event.target.value })}><option value="staff">Staff-visible after approval</option><option value="admin">Admin-only</option></select>
            <button type="button" className="ld-add-save" onClick={create}>Create</button>
          </div>
        </div> : null}

        <div className="ld-list">
          {nodes.length ? nodes.map((node) => {
            const Icon = TYPE_ICON[node.node_type] || Folder;
            const approval = APPROVAL[node.approval_status] || APPROVAL.draft;
            const module = node.content_type === "learning_module";
            const openable = module || node.node_type !== "item";
            return <article key={node.id} className={`ld-node ${module ? "ld-node--module" : ""}`}>
              <button type="button" className="ld-node-main" onClick={() => module ? setSelectedModule(node) : openable ? setParent(node.id) : undefined} disabled={!openable}>
                <div className="ld-node-icon"><Icon size={18} /></div>
                <div className="ld-node-text"><div className="ld-node-title">{node.title}{module ? <span className="ld-badge module"><BookOpen size={11} /> Module</span> : null}{node.visibility === "admin" ? <span className="ld-badge admin"><ShieldAlert size={11} /> Admin-only</span> : null}</div><div className="ld-node-meta">{module ? "Structured module" : node.node_type === "item" ? node.file_kind || "Library item" : `${node.childCount} item${node.childCount === 1 ? "" : "s"}`}<span className={`ld-approval ${node.approval_status}`}>{approval.label}</span></div></div>
                {openable ? <ChevronRight size={18} className="ld-node-chev" /> : null}
              </button>
              <div className="ld-node-actions">
                {node.approval_status === "draft" ? <button type="button" title="Submit for review" onClick={() => act(node, "submit_review")} className="ld-act"><Clock size={14} /></button> : null}
                {node.approval_status === "pending_review" ? <button type="button" title="Approve and release" onClick={() => act(node, "approve")} className="ld-act ok"><Check size={14} /></button> : null}
                {node.approval_status === "approved" ? <button type="button" title="Archive" onClick={() => act(node, "archive")} className="ld-act"><Archive size={14} /></button> : null}
                <button type="button" title={node.visibility === "admin" ? "Make staff-visible" : "Make admin-only"} onClick={() => toggleVisibility(node)} className="ld-act">{node.visibility === "admin" ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button type="button" title="Rename" onClick={() => rename(node)} className="ld-act">✎</button>
                <button type="button" title="Delete" onClick={() => remove(node)} className="ld-act del"><Trash2 size={14} /></button>
              </div>
            </article>;
          }) : <p className="ld-empty">This folder is empty. Add a structured learning module or organisational folder to get started.</p>}
        </div>
      </section>
    </div>
  );
}
