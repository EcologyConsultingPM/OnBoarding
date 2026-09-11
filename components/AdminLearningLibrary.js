"use client";

import { useEffect, useState, useCallback } from "react";
import { GraduationCap, Folder, FileText, ChevronRight, Home, Plus, Check, Clock, Eye, EyeOff, Trash2, X, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import LearningAssignmentsPanel from "./LearningAssignmentsPanel";

const TYPE_ICON = { section: GraduationCap, career_level: Folder, module: Folder, folder: Folder, item: FileText };
const APPROVAL = {
  draft: { bg: "#eef0e9", fg: "#6b755f", label: "Draft" },
  pending_review: { bg: "#fbf1dd", fg: "#a5772b", label: "Pending review" },
  approved: { bg: "#e5f1dd", fg: "#2c6a34", label: "Approved" },
  archived: { bg: "#f0e9e7", fg: "#8a6d5f", label: "Archived" },
};

export default function AdminLearningLibrary() {
  const { session } = useAuth();
  const [parent, setParent] = useState(null);      // current folder id (null = root)
  const [nodes, setNodes] = useState([]);
  const [trail, setTrail] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [newNode, setNewNode] = useState({ title: "", node_type: "folder", visibility: "staff" });

  const auth = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session?.access_token]);

  const load = useCallback(async (parentId) => {
    try {
      const qs = parentId ? `?parent=${parentId}` : "";
      const res = await auth("GET", `/api/ld${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNodes(data.nodes); setTrail(data.trail || []);
    } catch (e) { setError(e.message); }
  }, [auth]);

  useEffect(() => { if (session?.access_token) load(parent); }, [session, parent, load]);

  const notify = (m) => { setMessage(m); setError(""); setTimeout(() => setMessage(""), 2200); };

  const openNode = (n) => { if (n.node_type !== "item") setParent(n.id); };

  const create = async () => {
    if (!newNode.title.trim()) { setError("Enter a title."); return; }
    try {
      const res = await auth("POST", "/api/ld", { ...newNode, parent_id: parent, sort_order: nodes.length });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setAdding(false); setNewNode({ title: "", node_type: "folder", visibility: "staff" }); await load(parent); notify("Added.");
    } catch (e) { setError(e.message); }
  };

  const act = async (id, action) => {
    try { const res = await auth("PATCH", `/api/ld/${id}`, { action }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(parent); notify(action === "approve" ? "Approved." : action === "submit_review" ? "Submitted for review." : "Updated."); } catch (e) { setError(e.message); }
  };
  const toggleVis = async (n) => {
    try { const res = await auth("PATCH", `/api/ld/${n.id}`, { visibility: n.visibility === "admin" ? "staff" : "admin" }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(parent); } catch (e) { setError(e.message); }
  };
  const rename = async (n) => {
    const title = window.prompt("Rename:", n.title);
    if (!title || !title.trim()) return;
    try { const res = await auth("PATCH", `/api/ld/${n.id}`, { title: title.trim() }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(parent); } catch (e) { setError(e.message); }
  };
  const remove = async (n) => {
    if (!window.confirm(`Delete "${n.title}" and everything inside it? This cannot be undone.`)) return;
    try { const res = await auth("DELETE", `/api/ld/${n.id}`); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(parent); } catch (e) { setError(e.message); }
  };

  return (
    <div className="ld admin-learning-library">
      <header className="ld-hero">
        <span>Ecology Consulting · People &amp; learning</span>
        <h1>Learning &amp; Development library</h1>
        <p>The controlled training library. Edit structure and content, set staff visibility, and record review &amp; approval before anything is released to staff.</p>
      </header>

      {error ? <p className="ld-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="ld-success"><CheckCircle2 size={15} /> {message}</p> : null}

      <LearningAssignmentsPanel admin />

      {/* Breadcrumbs */}
      <div className="ld-crumbs">
        <button onClick={() => setParent(null)} className="ld-crumb"><Home size={14} /> Library</button>
        {trail.map((t) => (
          <span key={t.id} className="ld-crumb-wrap">
            <ChevronRight size={13} className="ld-crumb-sep" />
            <button onClick={() => setParent(t.id)} className="ld-crumb">{t.title}</button>
          </span>
        ))}
      </div>

      {/* Add + list */}
      <div className="ld-toolbar">
        {adding ? (
          <div className="ld-add">
            <input placeholder="Title" value={newNode.title} onChange={(e) => setNewNode({ ...newNode, title: e.target.value })} autoFocus />
            <select value={newNode.node_type} onChange={(e) => setNewNode({ ...newNode, node_type: e.target.value })}>
              <option value="folder">Folder</option>
              <option value="module">Module</option>
              <option value="career_level">Career level</option>
              <option value="item">Item / file</option>
            </select>
            <select value={newNode.visibility} onChange={(e) => setNewNode({ ...newNode, visibility: e.target.value })}>
              <option value="staff">Staff-visible</option>
              <option value="admin">Admin-only</option>
            </select>
            <button className="ld-add-save" onClick={create}>Add</button>
            <button className="ld-add-cancel" onClick={() => setAdding(false)}><X size={14} /></button>
          </div>
        ) : (
          <button className="ld-add-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add here</button>
        )}
      </div>

      <div className="ld-list">
        {nodes.length ? nodes.map((n) => {
          const Icon = TYPE_ICON[n.node_type] || Folder;
          const ap = APPROVAL[n.approval_status] || APPROVAL.draft;
          const isItem = n.node_type === "item";
          return (
            <div key={n.id} className="ld-node">
              <button className="ld-node-main" onClick={() => openNode(n)} disabled={isItem}>
                <div className="ld-node-icon" style={{ background: n.visibility === "admin" ? "#f0e7ef" : "#eef3e4", color: n.visibility === "admin" ? "#7d3b5c" : "#2c6a34" }}><Icon size={18} /></div>
                <div className="ld-node-text">
                  <div className="ld-node-title">{n.title}
                    {n.visibility === "admin" && <span className="ld-badge admin"><ShieldAlert size={11} /> Admin-only</span>}
                  </div>
                  <div className="ld-node-meta">
                    {isItem ? (n.file_kind || "item") : `${n.childCount} item${n.childCount === 1 ? "" : "s"}`}
                    <span className="ld-approval" style={{ background: ap.bg, color: ap.fg }}>{ap.label}</span>
                  </div>
                </div>
                {!isItem && <ChevronRight size={18} className="ld-node-chev" />}
              </button>
              <div className="ld-node-actions">
                {n.approval_status === "draft" && <button title="Submit for review" onClick={() => act(n.id, "submit_review")} className="ld-act"><Clock size={14} /></button>}
                {n.approval_status !== "approved" && <button title="Approve" onClick={() => act(n.id, "approve")} className="ld-act ok"><Check size={14} /></button>}
                <button title={n.visibility === "admin" ? "Make staff-visible" : "Make admin-only"} onClick={() => toggleVis(n)} className="ld-act">{n.visibility === "admin" ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button title="Rename" onClick={() => rename(n)} className="ld-act">✎</button>
                <button title="Delete" onClick={() => remove(n)} className="ld-act del"><Trash2 size={14} /></button>
              </div>
            </div>
          );
        }) : <p className="ld-empty">This folder is empty. Use “Add here” to create the first item.</p>}
      </div>
    </div>
  );
}
