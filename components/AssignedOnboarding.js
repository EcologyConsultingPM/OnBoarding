"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, X, Pencil, Lock, Unlock, Check, Search, ArrowLeft } from "lucide-react";
import * as db from "../lib/data";
import { C, FONT, inputStyle } from "./TrainingLibrary";

const smallBtn = { borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const addSmallBtn = {
  display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
  color: C.green400, fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0, fontFamily: FONT,
};

/* ---------------------------------------------------------------
   One topic row: admin can rename/remove; the assigned staff member
   can tick/date/note but never touch the title.
----------------------------------------------------------------- */

function TopicRow({ topic, isAdmin, canEditProgress, onSaveProgress, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const saveTimer = useRef(null);
  const pending = useRef({});

  const flush = () => {
    if (Object.keys(pending.current).length === 0) return;
    onSaveProgress(pending.current);
    pending.current = {};
  };
  const patch = (p) => {
    pending.current = { ...pending.current, ...p };
    clearTimeout(saveTimer.current);
    if ("done" in p) { flush(); return; }
    saveTimer.current = setTimeout(flush, 700);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1.2fr) 90px minmax(0,1fr)", gap: 10, alignItems: "start", padding: "9px 0", borderBottom: `1px solid ${C.lineFaint || C.line}` }}>
      <button
        className="check-box" disabled={!canEditProgress}
        onClick={() => patch({ done: !topic.done, date: !topic.done ? (topic.date || new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })) : topic.date })}
        style={{
          width: 24, height: 24, borderRadius: 7, border: `2px solid ${topic.done ? C.green400 : "#c2cdb6"}`,
          background: topic.done ? C.green400 : "#fff", cursor: canEditProgress ? "pointer" : "default",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        {topic.done && <Check size={13} color="#fff" />}
      </button>

      {isAdmin && editing ? (
        <input autoFocus defaultValue={topic.title}
          onBlur={(e) => { onRename(e.target.value.trim() || topic.title); setEditing(false); }}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          style={{ ...inputStyle, fontWeight: 700 }} />
      ) : (
        <span onClick={() => isAdmin && setEditing(true)} style={{ fontSize: 13.5, fontWeight: 700, color: C.green600, paddingTop: 3, cursor: isAdmin ? "text" : "default", display: "flex", alignItems: "center", gap: 6 }}>
          {topic.title}
          {isAdmin && <Pencil size={10} style={{ opacity: 0.35 }} />}
          {isAdmin && <button onClick={onRemove} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer", marginLeft: "auto" }}><X size={12} /></button>}
        </span>
      )}

      <input defaultValue={topic.date} disabled={!canEditProgress} onChange={(e) => patch({ date: e.target.value })} placeholder="Date" style={{ ...inputStyle, opacity: canEditProgress ? 1 : 0.6 }} />
      <textarea defaultValue={topic.notes} disabled={!canEditProgress} onChange={(e) => patch({ notes: e.target.value })} placeholder="Notes" rows={1} style={{ ...inputStyle, resize: "vertical", fontWeight: 600, opacity: canEditProgress ? 1 : 0.6 }} />
    </div>
  );
}

/* ---------------------------------------------------------------
   One module: header (title/SME, lock toggle, delete — admin only),
   topic list, add-topic (admin only).
----------------------------------------------------------------- */

function AssignedModuleCard({ module, isAdmin, isOwner, onMutate, onToast }) {
  const [open, setOpen] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const done = module.topics.filter((t) => t.done).length;
  const total = module.topics.length;

  const saveTitle = async (title) => {
    onMutate((m) => { m.title = title; });
    setEditingTitle(false);
    try { await db.updateAssignedModule(module.id, { title }); } catch { onToast("Couldn't save heading"); }
  };
  const toggleLock = async () => {
    const next = !module.unlocked;
    onMutate((m) => { m.unlocked = next; });
    try { await db.updateAssignedModule(module.id, { unlocked: next }); } catch { onToast("Couldn't update lock"); }
  };
  const removeModule = async () => {
    if (!window.confirm(`Delete "${module.title}" and everything in it?`)) return;
    try { await db.deleteAssignedModule(module.id); onMutate(null); } catch { onToast("Couldn't delete module"); }
  };
  const addTopic = async () => {
    const title = window.prompt("Topic / row name");
    if (!title) return;
    try {
      const t = await db.addAssignedTopic(module.id, title, module.topics.length);
      onMutate((m) => { m.topics.push({ id: t.id, title, done: false, date: "", notes: "" }); });
    } catch { onToast("Couldn't add topic"); }
  };
  const renameTopic = async (topicId, title) => {
    onMutate((m) => { m.topics.find((t) => t.id === topicId).title = title; });
    try { await db.updateAssignedTopic(topicId, title); } catch { onToast("Couldn't rename topic"); }
  };
  const removeTopic = async (topicId) => {
    if (!window.confirm("Remove this row?")) return;
    try { await db.deleteAssignedTopic(topicId); onMutate((m) => { m.topics = m.topics.filter((t) => t.id !== topicId); }); } catch { onToast("Couldn't remove topic"); }
  };
  const saveProgress = async (topicId, patch) => {
    onMutate((m) => { Object.assign(m.topics.find((t) => t.id === topicId), patch); });
    try { await db.saveAssignedProgress(topicId, patch); } catch { onToast("Couldn't save — try again"); }
  };

  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: C.greenTintSoft, cursor: "pointer", borderBottom: open ? `1px solid ${C.line}` : "none" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isAdmin && editingTitle ? (
            <input autoFocus defaultValue={module.title} onClick={(e) => e.stopPropagation()}
              onBlur={(e) => saveTitle(e.target.value.trim() || module.title)}
              onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
              style={{ ...inputStyle, fontWeight: 900, fontSize: 15 }} />
          ) : (
            <div onClick={(e) => { if (isAdmin) { e.stopPropagation(); setEditingTitle(true); } }} style={{ fontSize: 15.5, fontWeight: 900, color: C.ink, display: "flex", alignItems: "center", gap: 6, cursor: isAdmin ? "text" : "default" }}>
              {module.title}
              {isAdmin && <Pencil size={11} style={{ opacity: 0.35 }} />}
            </div>
          )}
          {module.sme && <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginTop: 2 }}>SME: {module.sme}</div>}
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.green600, background: C.greenTint, borderRadius: 99, padding: "3px 10px", flexShrink: 0 }}>{done}/{total}</span>
        {isAdmin && (
          <button onClick={(e) => { e.stopPropagation(); toggleLock(); }} style={{
            display: "flex", alignItems: "center", gap: 5, border: "none", cursor: "pointer", fontFamily: FONT,
            fontSize: 11, fontWeight: 800, borderRadius: 20, padding: "4px 10px", flexShrink: 0,
            background: module.unlocked ? C.greenTint : "#f3e3d3", color: module.unlocked ? C.green600 : C.amberText,
          }}>
            {module.unlocked ? <><Unlock size={11} /> Visible to staff</> : <><Lock size={11} /> Draft — hidden</>}
          </button>
        )}
        {isAdmin && (
          <button onClick={(e) => { e.stopPropagation(); removeModule(); }} style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", flexShrink: 0 }}><X size={16} /></button>
        )}
        {open ? <ChevronDown size={16} color={C.inkSoft} /> : <ChevronRight size={16} color={C.inkSoft} />}
      </div>
      {open && (
        <div style={{ padding: "8px 18px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1.2fr) 90px minmax(0,1fr)", gap: 10, padding: "8px 0 6px", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.07em", textTransform: "uppercase", color: C.inkFaint, borderBottom: `1px solid ${C.line}` }}>
            <span>Done</span><span>Topic</span><span>Date</span><span>Notes</span>
          </div>
          {module.topics.map((t) => (
            <TopicRow
              key={t.id} topic={t} isAdmin={isAdmin} canEditProgress={isOwner}
              onSaveProgress={(patch) => saveProgress(t.id, patch)}
              onRename={(title) => renameTopic(t.id, title)}
              onRemove={() => removeTopic(t.id)}
            />
          ))}
          {module.topics.length === 0 && <p style={{ color: C.inkFaint, fontStyle: "italic", fontSize: 13 }}>No rows yet.</p>}
          {isAdmin && (
            <button onClick={addTopic} style={{ ...addSmallBtn, marginTop: 10 }}><Plus size={12} /> Add row</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Staff picker (admin only) — search the existing roster
----------------------------------------------------------------- */

function StaffPicker({ onPick, onToast }) {
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.fetchStaffProgress()
      .then((res) => setStaff(res.staff))
      .catch(() => onToast && onToast("Couldn't load the staff list"))
      .finally(() => setLoading(false));
  }, [onToast]);

  const filtered = (staff || []).filter((s) =>
    !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.email.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.green800, fontFamily: FONT }}>Draft Onboarding</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, fontWeight: 600, color: C.inkSoft }}>
          Pick a staff member to draft or manage their own onboarding modules. They won't see anything until you unlock each module.
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px" }}>
        <Search size={14} color={C.inkFaint} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email…" style={{ border: "none", outline: "none", flex: 1, fontSize: 13.5, fontFamily: FONT, background: "transparent" }} />
      </div>
      {loading && <div style={{ color: C.inkSoft, fontWeight: 700, padding: 20, textAlign: "center" }}>Loading staff…</div>}
      {!loading && filtered.length === 0 && <div style={{ color: C.inkFaint, fontStyle: "italic", padding: 20, textAlign: "center" }}>No one matches yet — staff need to have signed in at least once.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((s) => (
          <button key={s.id} onClick={() => onPick(s)} style={{
            display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer",
            background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT,
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 99, background: C.greenTint, color: C.green600, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, flexShrink: 0 }}>
              {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{s.name}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft }}>{s.email}</div>
            </div>
            <ChevronRight size={16} color={C.inkFaint} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Admin drafting view: pick someone, then build their modules
----------------------------------------------------------------- */

export function DraftOnboarding({ onToast, currentEmail }) {
  const [staffMember, setStaffMember] = useState(null);
  const [modules, setModules] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (person) => {
    setLoaded(false);
    try {
      const data = await db.fetchAssignedModules(person.id);
      setModules(data);
    } catch (e) {
      onToast && onToast("Couldn't load their onboarding");
      setModules([]);
    }
    setLoaded(true);
  }, [onToast]);

  const pick = (person) => { setStaffMember(person); load(person); };

  const mutate = (moduleId, fn) => setModules((prev) => {
    if (fn === null) return prev.filter((m) => m.id !== moduleId); // deletion
    const copy = prev.map((m) => (m.id === moduleId ? { ...m, topics: [...m.topics] } : m));
    const target = copy.find((m) => m.id === moduleId);
    fn(target);
    return copy;
  });

  const addModule = async () => {
    const title = window.prompt("Module name");
    if (!title) return;
    const sme = window.prompt("Subject matter expert (optional)") || "";
    try {
      const m = await db.addAssignedModule(staffMember.id, title, sme, modules.length, currentEmail);
      setModules((prev) => [...prev, { id: m.id, title, sme, unlocked: false, topics: [] }]);
    } catch { onToast && onToast("Couldn't add module"); }
  };

  if (!staffMember) return <StaffPicker onPick={pick} onToast={onToast} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <button onClick={() => setStaffMember(null)} style={{
        alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "#fff",
        border: `1px solid ${C.line}`, color: C.green600, borderRadius: 8, padding: "7px 12px",
        fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
      }}>
        <ArrowLeft size={13} /> All staff
      </button>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{staffMember.name}'s onboarding</h2>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>{staffMember.email}</div>
      </div>
      {!loaded && <div style={{ color: C.inkSoft, fontWeight: 700, padding: 20, textAlign: "center" }}>Loading…</div>}
      {loaded && modules.map((m) => (
        <AssignedModuleCard
          key={m.id} module={m} isAdmin isOwner={false}
          onMutate={(fn) => mutate(m.id, fn)} onToast={onToast}
        />
      ))}
      {loaded && (
        <button onClick={addModule} style={{
          alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.green400}`,
          background: "#fff", color: C.green600, borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
        }}>
          <Plus size={13} /> Add module
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Staff self-view: whatever's unlocked for the signed-in person
----------------------------------------------------------------- */

export function MyOnboarding({ onToast }) {
  const [modules, setModules] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    db.fetchMyAssignedModules()
      .then(setModules)
      .catch(() => { onToast && onToast("Couldn't load your onboarding"); setModules([]); })
      .finally(() => setLoaded(true));
  }, [onToast]);

  const mutate = (moduleId, fn) => setModules((prev) => {
    const copy = prev.map((m) => (m.id === moduleId ? { ...m, topics: [...m.topics] } : m));
    fn(copy.find((m) => m.id === moduleId));
    return copy;
  });

  if (!loaded) return <div style={{ textAlign: "center", padding: 40, color: C.inkSoft, fontWeight: 700, fontFamily: FONT }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.green800, fontFamily: FONT }}>My Onboarding</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, fontWeight: 600, color: C.inkSoft }}>Modules an admin has prepared for you specifically.</p>
      </div>
      {modules.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: C.inkFaint, fontStyle: "italic", background: C.cardBg, border: `1px dashed ${C.line}`, borderRadius: 12 }}>
          Nothing here yet — check back once an admin has assigned you something.
        </div>
      ) : (
        modules.map((m) => (
          <AssignedModuleCard key={m.id} module={m} isAdmin={false} isOwner onMutate={(fn) => mutate(m.id, fn)} onToast={onToast} />
        ))
      )}
    </div>
  );
}
