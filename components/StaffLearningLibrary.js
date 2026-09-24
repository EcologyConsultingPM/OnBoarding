"use client";

import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Folder, FileText, ChevronRight, Home, AlertCircle, BookOpen } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import WorkspaceNav from "./WorkspaceNav";
import CoreTrainingQuizzes from "./CoreTrainingQuizzes";
import LearningAssignmentsPanel from "./LearningAssignmentsPanel";
import LearningModuleDetail from "./LearningModuleDetail";

const TYPE_ICON = { section: GraduationCap, career_level: Folder, module: Folder, folder: Folder, item: FileText };

export default function StaffLearningLibrary() {
  const { session } = useAuth();
  const [parent, setParent] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [trail, setTrail] = useState([]);
  const [error, setError] = useState("");
  const [showCoreTrainingQuizzes, setShowCoreTrainingQuizzes] = useState(false);
  const [selectedModule, setSelectedModule] = useState(null);

  const load = useCallback(async (parentId = parent) => {
    if (!session?.access_token) return;
    try {
      const params = new URLSearchParams({ audience: "staff" });
      if (parentId) params.set("parent", parentId);
      const response = await fetch(`/api/ld?${params.toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load learning content.");
      setNodes(data.nodes || []);
      setTrail(data.trail || []);
    } catch (requestError) {
      setError(requestError.message || "Could not load learning content.");
    }
  }, [parent, session?.access_token]);

  useEffect(() => { load(parent); }, [load, parent]);
  const openNode = (node) => {
    if (node.content_type === "learning_module") { setSelectedModule(node); return; }
    if (node.title === "01 Core Training Modules") { setShowCoreTrainingQuizzes(true); return; }
    if (node.node_type !== "item") setParent(node.id);
  };

  if (showCoreTrainingQuizzes) return <CoreTrainingQuizzes onBack={() => setShowCoreTrainingQuizzes(false)} />;
  if (selectedModule) return <LearningModuleDetail node={selectedModule} audience="staff" onBack={() => { setSelectedModule(null); load(parent); }} />;

  return (
    <div className="ld staff-learning">
      <header className="ld-hero"><WorkspaceNav audience="staff" /><span>Ecology Consulting · People &amp; learning</span><h1>Learning &amp; Development</h1><p>Your approved learning modules, field and desktop resources, and competency assignments. Completion is one step in the process; independent work requires verified competency within an agreed scope.</p></header>
      {error ? <p className="ld-error"><AlertCircle size={15} /> {error}</p> : null}
      <LearningAssignmentsPanel />
      <div className="ld-crumbs"><button type="button" onClick={() => setParent(null)} className="ld-crumb"><Home size={14} /> My Learning</button>{trail.map((item) => <span key={item.id} className="ld-crumb-wrap"><ChevronRight size={13} className="ld-crumb-sep" /><button type="button" onClick={() => setParent(item.id)} className="ld-crumb">{item.title}</button></span>)}</div>
      <div className="ld-list">{nodes.length ? nodes.map((node) => {
        const Icon = TYPE_ICON[node.node_type] || Folder;
        const module = node.content_type === "learning_module";
        const openable = module || node.node_type !== "item";
        return <button key={node.id} type="button" className="ld-node-view" onClick={() => openNode(node)} disabled={!openable}><div className="ld-node-icon"><Icon size={18} /></div><div className="ld-node-text"><div className="ld-node-title">{node.title}</div><div className="ld-node-meta">{module ? "Open learning module" : node.node_type === "item" ? node.file_kind || "Reference item" : `${node.childCount} item${node.childCount === 1 ? "" : "s"}`}</div></div>{openable ? <ChevronRight size={18} className="ld-node-chev" /> : null}</button>;
      }) : <p className="ld-empty"><BookOpen size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />Nothing here yet. Content appears after it has been approved and released.</p>}</div>
    </div>
  );
}
