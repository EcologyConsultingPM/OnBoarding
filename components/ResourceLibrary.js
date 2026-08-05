"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Folder, ChevronRight, ArrowLeft, FileText } from "lucide-react";
import * as db from "../lib/data";
import TrainingLibrary, { C, FONT, LEVEL_COLORS, LEVEL_INFORMAL, inputStyle, ResourceList } from "./TrainingLibrary";

const TOPICS = ["Pathways & Legislation", "Flora", "Fauna", "Reporting", "Business Operations", "Projects", "GIS"];
const LEVEL_ORDER = ["Early career", "Experienced", "Senior", "Director"];

const CAREER_FOLDER = "Career Levels & Assessments";

function FolderCard({ label, sublabel, color, onClick, count }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14, textAlign: "left", cursor: "pointer",
        background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px",
        fontFamily: FONT, width: "100%",
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10, background: `${color}1a`, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Folder size={22} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft, marginTop: 2 }}>{sublabel}</div>}
      </div>
      {typeof count === "number" && (
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.inkFaint, flexShrink: 0 }}>{count} file{count === 1 ? "" : "s"}</span>
      )}
      <ChevronRight size={18} color={C.inkFaint} style={{ flexShrink: 0 }} />
    </button>
  );
}

function Breadcrumb({ crumbs, onNavigate }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={13} color={C.inkFaint} />}
          {i === crumbs.length - 1 ? (
            <span style={{ fontSize: 13, fontWeight: 900, color: C.green700, fontFamily: FONT }}>{c.label}</span>
          ) : (
            <button
              onClick={() => onNavigate(i)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.inkSoft, fontFamily: FONT }}
            >
              {c.label}
            </button>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------
   Level 3: the actual Resources folder for one topic + level
----------------------------------------------------------------- */

const SUBFOLDERS = [
  { key: "resources", label: "Resources", desc: "Reference documents, field guides, links" },
  { key: "modules", label: "Modules", desc: "Training module notes and content" },
  { key: "quizzes", label: "Quizzes / Assessments", desc: "Knowledge checks for this topic and level" },
];

function ItemsFolder({ items, isAdmin, onSave, onToast, emptyLabel, addLabel }) {
  const [local, setLocal] = useState(items);
  useEffect(() => setLocal(items), [items]);

  const save = (next) => {
    setLocal(next);
    onSave(next).catch(() => onToast && onToast("Couldn't save — try again"));
  };

  if (!isAdmin && local.length === 0) {
    return <div style={{ color: C.inkFaint, fontSize: 13, fontWeight: 600, fontStyle: "italic" }}>{emptyLabel}</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {local.map((item, i) => {
          const isFile = typeof item === "object" && item?.url;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px" }}>
              <FileText size={14} color={C.green600} style={{ flexShrink: 0 }} />
              {isFile ? (
                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.green600, fontWeight: 700, fontSize: 13.5 }}>{item.label}</a>
              ) : (
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{item}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return <ResourceList items={local} onChange={save} addLabel={addLabel} />;
}

/* ---------------------------------------------------------------
   Level 2: the four career-level sub-folders inside a topic
   Level 3: Resources / Modules / Quizzes within a level
----------------------------------------------------------------- */

function TopicFolder({ topic, folders, isAdmin, onSaveFolder, onToast, onBack }) {
  const [openLevel, setOpenLevel] = useState(null);
  const [openSub, setOpenSub] = useState(null);

  if (openLevel && openSub) {
    const folder = folders.find((f) => f.level === openLevel);
    const sub = SUBFOLDERS.find((s) => s.key === openSub);
    const color = LEVEL_COLORS[openLevel];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Breadcrumb
          crumbs={[{ label: "Resource Library" }, { label: topic }, { label: openLevel }, { label: sub.label }]}
          onNavigate={(i) => { if (i === 0) onBack(); if (i === 1) { setOpenLevel(null); setOpenSub(null); } if (i === 2) setOpenSub(null); }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 30, borderRadius: 99, background: color, flexShrink: 0 }} />
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{sub.label}</h2>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft }}>{topic} · {openLevel}</div>
          </div>
        </div>
        <ItemsFolder
          items={folder?.[openSub] || []} isAdmin={isAdmin}
          onSave={(next) => onSaveFolder(topic, openLevel, openSub, next)} onToast={onToast}
          emptyLabel={`No ${sub.label.toLowerCase()} here yet.`}
          addLabel={openSub === "quizzes" ? "Add quiz" : undefined}
        />
      </div>
    );
  }

  if (openLevel) {
    const folder = folders.find((f) => f.level === openLevel);
    const color = LEVEL_COLORS[openLevel];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Breadcrumb
          crumbs={[{ label: "Resource Library" }, { label: topic }, { label: openLevel }]}
          onNavigate={(i) => { if (i === 0) onBack(); if (i === 1) setOpenLevel(null); }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 30, borderRadius: 99, background: color, flexShrink: 0 }} />
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{openLevel}</h2>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft }}>{LEVEL_INFORMAL[openLevel]}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SUBFOLDERS.map((s) => (
            <FolderCard
              key={s.key} label={s.label} sublabel={s.desc} color={color}
              count={(folder?.[s.key] || []).length}
              onClick={() => setOpenSub(s.key)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Breadcrumb crumbs={[{ label: "Resource Library" }, { label: topic }]} onNavigate={() => onBack()} />
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.green800, fontFamily: FONT }}>{topic}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {LEVEL_ORDER.map((lvl) => {
          const folder = folders.find((f) => f.level === lvl);
          const count = (folder?.resources?.length || 0) + (folder?.modules?.length || 0) + (folder?.quizzes?.length || 0);
          return (
            <FolderCard
              key={lvl} label={lvl} sublabel={LEVEL_INFORMAL[lvl]} color={LEVEL_COLORS[lvl]}
              count={count}
              onClick={() => setOpenLevel(lvl)}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Top level: the root folder list
----------------------------------------------------------------- */

export default function ResourceLibrary({ isAdmin, onToast }) {
  const [folders, setFolders] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState({ type: "root" }); // root | careerLevels | topic

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await db.fetchResourceFolders();
      setFolders(data);
    } catch (e) {
      console.error("ResourceLibrary load failed:", e);
      const msg = e?.message || "Couldn't load the Resource Library";
      setError(msg);
      onToast && onToast(msg);
    }
    setLoaded(true);
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const saveFolder = async (topic, level, field, items) => {
    setFolders((prev) => prev.map((f) => (f.topic === topic && f.level === level ? { ...f, [field]: items } : f)));
    await db.updateResourceFolder(topic, level, field, items);
  };

  if (!loaded) {
    return <div style={{ textAlign: "center", padding: 40, color: C.inkSoft, fontFamily: FONT, fontWeight: 700 }}>Loading the Resource Library…</div>;
  }

  if (error || !folders) {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 14, padding: "28px 24px" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.rust, marginBottom: 8, fontFamily: FONT }}>Couldn't load the Resource Library</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, marginBottom: 18, lineHeight: 1.5 }}>{error || "No content came back from the database."}</div>
        <button onClick={load} style={{ background: C.green400, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
          Try again
        </button>
      </div>
    );
  }

  if (view.type === "careerLevels") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Breadcrumb crumbs={[{ label: "Resource Library" }, { label: CAREER_FOLDER }]} onNavigate={() => setView({ type: "root" })} />
        <button
          onClick={() => setView({ type: "root" })}
          style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.line}`, color: C.green600, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
        >
          <ArrowLeft size={13} /> All folders
        </button>
        <TrainingLibrary isAdmin={isAdmin} onToast={onToast} />
      </div>
    );
  }

  if (view.type === "topic") {
    const topicFolders = folders.filter((f) => f.topic === view.topic);
    return (
      <TopicFolder
        topic={view.topic} folders={topicFolders} isAdmin={isAdmin} onSaveFolder={saveFolder}
        onToast={onToast} onBack={() => setView({ type: "root" })}
      />
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: C.green800, fontFamily: FONT }}>Resource Library</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600, color: C.inkSoft, lineHeight: 1.5 }}>
          Career levels and assessment standards, plus reference materials organised by topic and career level.
        </p>
      </div>

      <FolderCard
        label={CAREER_FOLDER} sublabel="Capability framework, values, assessment ratings, module guides"
        color={C.green600} onClick={() => setView({ type: "careerLevels" })}
      />

      <div style={{ height: 1, background: C.line, margin: "4px 0" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TOPICS.map((topic) => {
          const topicFolders = folders.filter((f) => f.topic === topic);
          const total = topicFolders.reduce((sum, f) => sum + (f.resources?.length || 0), 0);
          return (
            <FolderCard
              key={topic} label={topic} sublabel={`${LEVEL_ORDER.length} career-level folders`}
              color={C.amberText} count={total} onClick={() => setView({ type: "topic", topic })}
            />
          );
        })}
      </div>
    </div>
  );
}
