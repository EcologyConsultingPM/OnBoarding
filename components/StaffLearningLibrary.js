"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GraduationCap,
  Folder,
  FileText,
  ChevronRight,
  Home,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import WorkspaceNav from "./WorkspaceNav";
import CoreTrainingQuizzes from "./CoreTrainingQuizzes";

const TYPE_ICON = {
  section: GraduationCap,
  career_level: Folder,
  module: Folder,
  folder: Folder,
  item: FileText,
};

export default function StaffLearningLibrary() {
  const { session } = useAuth();
  const [parent, setParent] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [trail, setTrail] = useState([]);
  const [error, setError] = useState("");
  const [showCoreTrainingQuizzes, setShowCoreTrainingQuizzes] = useState(false);

  const load = useCallback(
    async (parentId) => {
      try {
        const params = new URLSearchParams({ audience: "staff" });
        if (parentId) params.set("parent", parentId);
        const res = await fetch(`/api/ld?${params.toString()}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setNodes(data.nodes);
        setTrail(data.trail || []);
      } catch (e) {
        setError(e.message);
      }
    },
    [session],
  );

  useEffect(() => {
    if (session?.access_token) load(parent);
  }, [session, parent, load]);

  const openNode = (n) => {
    if (n.title === "01 Core Training Modules") {
      setShowCoreTrainingQuizzes(true);
      return;
    }
    if (n.node_type !== "item") setParent(n.id);
  };

  if (showCoreTrainingQuizzes) {
    return <CoreTrainingQuizzes onBack={() => setShowCoreTrainingQuizzes(false)} />;
  }

  return (
    <div className="ld staff-learning">
      <header className="ld-hero">
        <WorkspaceNav audience="staff" />
        <span>Ecology Consulting · People &amp; learning</span>
        <h1>Learning &amp; Development</h1>
        <p>
          Your approved training modules, field and desktop resources, and
          quizzes. Library management material is available only in the Admin
          Portal.
        </p>
      </header>

      {error ? (
        <p className="ld-error">
          <AlertCircle size={15} /> {error}
        </p>
      ) : null}

      <div className="ld-crumbs">
        <button onClick={() => setParent(null)} className="ld-crumb">
          <Home size={14} /> My Learning
        </button>
        {trail.map((t) => (
          <span key={t.id} className="ld-crumb-wrap">
            <ChevronRight size={13} className="ld-crumb-sep" />
            <button onClick={() => setParent(t.id)} className="ld-crumb">
              {t.title}
            </button>
          </span>
        ))}
      </div>

      <div className="ld-list">
        {nodes.length ? (
          nodes.map((n) => {
            const Icon = TYPE_ICON[n.node_type] || Folder;
            const isItem = n.node_type === "item";
            return (
              <button
                key={n.id}
                className="ld-node-view"
                onClick={() => openNode(n)}
                disabled={isItem}
              >
                <div
                  className="ld-node-icon"
                  style={{ background: "#eef3e4", color: "#2c6a34" }}
                >
                  <Icon size={18} />
                </div>
                <div className="ld-node-text">
                  <div className="ld-node-title">{n.title}</div>
                  <div className="ld-node-meta">
                    {isItem
                      ? n.file_kind || "Open"
                      : `${n.childCount} item${n.childCount === 1 ? "" : "s"}`}
                  </div>
                </div>
                {!isItem && <ChevronRight size={18} className="ld-node-chev" />}
              </button>
            );
          })
        ) : (
          <p className="ld-empty">
            <BookOpen
              size={16}
              style={{ verticalAlign: "-3px", marginRight: 6 }}
            />
            Nothing here yet. Content appears once it's been approved and
            released.
          </p>
        )}
      </div>
    </div>
  );
}
