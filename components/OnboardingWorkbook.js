"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus, X, Link as LinkIcon, Download, RotateCcw, Check, Pencil,
  ChevronDown, ChevronRight, FileText, LogOut, ShieldCheck, Users2, Lock, Unlock,
  Loader2, CheckCircle2, AlertCircle, BookOpen, Settings, Home as HomeIcon, ClipboardList,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import * as db from "../lib/data";
import ResourceLibrary from "./ResourceLibrary";
import { DraftOnboarding, MyOnboarding } from "./AssignedOnboarding";

/* ---------------------------------------------------------------
   Auto-save status tracker (module-level pub/sub)
   Any save wrapped in saveTracked() reports "saving" while in flight
   and "saved"/"error" when it settles, so the header can show a live
   auto-save indicator without threading props through every component.
----------------------------------------------------------------- */
const saveListeners = new Set();
let pendingSaves = 0;
function emitSaveStatus(status) { saveListeners.forEach((fn) => fn(status)); }
function onSaveStatus(fn) { saveListeners.add(fn); return () => saveListeners.delete(fn); }
async function saveTracked(fn) {
  pendingSaves += 1;
  emitSaveStatus("saving");
  try {
    await fn();
    pendingSaves = Math.max(0, pendingSaves - 1);
    if (pendingSaves === 0) emitSaveStatus("saved");
  } catch (e) {
    pendingSaves = Math.max(0, pendingSaves - 1);
    emitSaveStatus("error");
    throw e;
  }
}

const C = {
  bg: "#f4f4ee", ink: "#23301f", inkSoft: "#6b755f", inkFaint: "#8a927c",
  line: "#e3e6d8", lineSoft: "#edf0e3", lineFaint: "#f0f2e6",
  green900: "#16371f", green800: "#1e4d2b", green700: "#24522a", green600: "#2c4426",
  green500: "#35692f", green400: "#3d7a35", green300: "#5b8f45", green200: "#6ea24f",
  greenTint: "#e6efd8", greenTintSoft: "#eef3e4", cream: "#cfe3b8",
  amber: "#b08948", amberLight: "#c9a25e", amberBg: "#fbf6ea", amberText: "#7a6233",
  rust: "#c05a4a", cardBg: "#ffffff",
};
const FONT = "'Nunito Sans', 'Helvetica Neue', sans-serif";
const uid = () => Math.random().toString(36).slice(2, 10);

function pct(done, total) { return total ? Math.round((done / total) * 100) : 0; }
function sectionCounts(section) {
  const total = section.items.length;
  return { done: section.items.filter((i) => i.done).length, total };
}
function phaseCounts(phase) {
  let done = 0, total = 0;
  phase.sections.forEach((s) => { const c = sectionCounts(s); done += c.done; total += c.total; });
  return { done, total };
}
function moduleCounts(mod) {
  const total = mod.subheadings.length;
  return { done: mod.subheadings.filter((s) => s.done).length, total };
}
function monthCounts(month) {
  let done = 0, total = 0;
  month.modules.forEach((m) => { const c = moduleCounts(m); done += c.done; total += c.total; });
  return { done, total };
}
function ldCounts(ldMonths) {
  let done = 0, total = 0;
  ldMonths.forEach((m) => { const c = monthCounts(m); done += c.done; total += c.total; });
  return { done, total };
}

const inputStyle = (dashed) => ({
  border: `1px ${dashed ? "dashed" : "solid"} #e6e8da`, background: "#fafbf4", borderRadius: 8,
  padding: "7px 9px", fontSize: 13, fontWeight: 600, color: C.ink, width: "100%", outline: "none",
  fontFamily: FONT, boxSizing: "border-box",
});
const smallBtn = { borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const addSmallBtn = {
  display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
  color: C.green500, fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0, fontFamily: FONT,
};

function Toast({ text }) {
  if (!text) return null;
  return (
    <div data-print="hide" style={{ position: "fixed", bottom: 20, right: 20, background: C.green800, color: "#fdfdf8", padding: "9px 16px", borderRadius: 8, fontFamily: FONT, fontSize: 13, boxShadow: "0 4px 14px rgba(0,0,0,0.2)", zIndex: 100 }}>
      {text}
    </div>
  );
}
/* ---------------------------------------------------------------
   Links — staff read/click only; admin can add & remove
----------------------------------------------------------------- */

function LinksCell({ links, canEdit, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState(""); const [url, setUrl] = useState("");

  const submit = () => {
    if (!label.trim() || !url.trim()) return;
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    onAdd(label.trim(), u);
    setLabel(""); setUrl(""); setAdding(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {links.map((l) => (
        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <LinkIcon size={11} color={C.green500} style={{ flexShrink: 0 }} />
          <a href={l.url} target="_blank" rel="noreferrer"
            style={{ fontSize: 12.5, fontWeight: 700, color: C.green500, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {l.label}
          </a>
          {canEdit && (
            <button data-print="hide" onClick={() => onRemove(l.id)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer", padding: 0, flexShrink: 0 }}>
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {canEdit && (adding ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-print="hide">
          <input autoFocus placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle(true)} />
          <div style={{ display: "flex", gap: 4 }}>
            <input placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle(true), flex: 1 }} />
            <button onClick={submit} style={{ ...smallBtn, background: C.green400, color: "#fff", border: "none" }}>Add</button>
            <button onClick={() => setAdding(false)} style={{ ...smallBtn, background: "none", border: "none", color: C.inkFaint }}>✕</button>
          </div>
        </div>
      ) : (
        <button data-print="hide" onClick={() => setAdding(true)} style={addSmallBtn}><Plus size={11} /> Link</button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------
   Item row: Done / (Item) / Date / Notes / Links
   - done/date/notes: any signed-in user (staff + admin)
   - label + links add/remove: admin only
----------------------------------------------------------------- */

function ItemRow({ item, showDate, isAdmin, onProgress, onLinkAdd, onLinkRemove, onRename, onRemove }) {
  const [editingLabel, setEditingLabel] = useState(false);
  const cols = showDate
    ? "34px minmax(0,1.3fr) 100px minmax(0,1fr) minmax(0,0.85fr)"
    : "34px minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.85fr)";
  const hasComment = !!item.comment;
  return (
    <div style={{ borderBottom: `1px solid ${C.lineFaint}`, padding: "10px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "start" }}>
      <button
        className="check-box"
        onClick={() => onProgress({ done: !item.done, date: !item.done ? (item.date || new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })) : item.date })}
        style={{
          width: 26, height: 26, borderRadius: 8, border: `2px solid ${item.done ? C.green400 : "#c2cdb6"}`,
          background: item.done ? C.green400 : "#fff", color: "#fff", cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        {item.done && <Check size={14} />}
      </button>

      {isAdmin && editingLabel ? (
        <input autoFocus defaultValue={item.title}
          onBlur={(e) => { onRename(e.target.value || item.title); setEditingLabel(false); }}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          style={{ ...inputStyle(false), fontWeight: 700 }} />
      ) : (
        <span onClick={() => isAdmin && setEditingLabel(true)} style={{ fontSize: 14.5, fontWeight: 700, color: C.green600, lineHeight: 1.35, paddingTop: 4, cursor: isAdmin ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6 }}>
          {item.title}
          {isAdmin && <Pencil size={11} style={{ opacity: 0.35 }} data-print="hide" />}
          {isAdmin && (
            <button data-print="hide" onClick={onRemove} title="Remove row" style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer", padding: 0, marginLeft: "auto" }}>
              <X size={13} />
            </button>
          )}
        </span>
      )}

      {showDate && (
        <input value={item.date} onChange={(e) => onProgress({ date: e.target.value })} placeholder="Date" style={inputStyle(false)} />
      )}
      <textarea value={item.notes} onChange={(e) => onProgress({ notes: e.target.value })} placeholder="Notes" rows={1} style={{ ...inputStyle(false), resize: "vertical", fontWeight: 600 }} />
      <LinksCell links={item.links} canEdit={isAdmin} onAdd={onLinkAdd} onRemove={onLinkRemove} />
      </div>

      {(isAdmin || hasComment) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, marginLeft: 46, background: C.amberBg, border: `1px solid ${C.amberLight}`, borderRadius: 8, padding: "7px 10px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.amberText, paddingTop: 3, flexShrink: 0 }}>Admin note</span>
          {isAdmin ? (
            <textarea
              defaultValue={item.comment}
              onBlur={(e) => onProgress({ comment: e.target.value })}
              placeholder="Feedback visible to the staff member…"
              rows={1}
              style={{ ...inputStyle(false), flex: 1, background: "#fff", resize: "vertical", fontSize: 12.5 }}
            />
          ) : (
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.amberText }}>{item.comment}</span>
          )}
        </div>
      )}
    </div>
  );
}
/* ---------------------------------------------------------------
   Mentor chip — confirmed mentor for a section
----------------------------------------------------------------- */

function MentorChip({ mentor, isAdmin, onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus defaultValue={mentor}
        onBlur={(e) => { onSave(e.target.value); setEditing(false); }}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        placeholder="Mentor name"
        style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 12px", width: 140 }}
      />
    );
  }
  if (!mentor && !isAdmin) return null;
  return (
    <span
      onClick={() => isAdmin && setEditing(true)}
      title="Confirmed mentor for this section"
      style={{
        fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.green500, background: "#EAF3E0",
        padding: "5px 12px", borderRadius: 20, flexShrink: 0, cursor: isAdmin ? "pointer" : "default",
        display: "flex", alignItems: "center", gap: 5,
      }}
    >
      <Users2 size={11} /> {mentor || "Add mentor"}
    </span>
  );
}

/* ---------------------------------------------------------------
   Section card
----------------------------------------------------------------- */

function SectionCard({ section, isAdmin, showDate = true, onMutate, onToast }) {
  const { done, total } = sectionCounts(section);
  const complete = total > 0 && done === total;
  const cols = showDate
    ? "34px minmax(0,1.3fr) 100px minmax(0,1fr) minmax(0,0.85fr)"
    : "34px minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.85fr)";

  // Per-item debounce so typing into Date/Notes/Admin note doesn't fire a
  // network write on every keystroke. Checkbox toggles save immediately.
  const saveTimers = React.useRef({});
  const pendingPatch = React.useRef({});
  const flush = (itemId) => {
    const patch = pendingPatch.current[itemId];
    if (!patch) return;
    pendingPatch.current[itemId] = null;
    // Admin comment is a shared per-item field; done/date/notes are the
    // signed-in user's own onboarding progress (staff_progress).
    const { comment, ...prog } = patch;
    if (comment !== undefined) {
      saveTracked(() => db.updateAdminComment(itemId, comment)).catch(() => onToast("Couldn't save comment"));
    }
    if (Object.keys(prog).length) {
      saveTracked(() => db.saveMyProgress(itemId, prog)).catch(() => onToast("Couldn't save — try again"));
    }
  };
  const progress = (itemId, patch) => {
    onMutate((d) => {
      const it = section.items.find((i) => i.id === itemId);
      Object.assign(it, patch);
    });
    pendingPatch.current[itemId] = { ...(pendingPatch.current[itemId] || {}), ...patch };
    clearTimeout(saveTimers.current[itemId]);
    if ("done" in patch) { flush(itemId); return; }
    saveTimers.current[itemId] = setTimeout(() => flush(itemId), 700);
  };
  const addRow = async () => {
    const label = window.prompt("Item name");
    if (!label) return;
    try {
      const item = await db.addItem({ section_id: section.id }, label, section.items.length);
      onMutate((d) => { section.items.push({ id: item.id, title: label, showDate: true, done: false, date: "", notes: "", comment: "", links: [] }); });
    } catch { onToast("Couldn't add row"); }
  };
  const saveMentor = async (mentor) => {
    onMutate((d) => { section.mentor = mentor; });
    saveTracked(() => db.updateSectionMentor(section.id, mentor)).catch(() => onToast("Couldn't save mentor"));
  };

  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 10px rgba(35,48,31,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", background: `linear-gradient(100deg, ${C.greenTintSoft}, #f8f9f1 70%)`, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ width: 8, height: 28, borderRadius: 99, background: `linear-gradient(180deg, ${C.green400}, ${C.green200})`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{section.title}</h3>
          {section.note && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, marginTop: 2 }}>{section.note}</div>}
        </div>
        <MentorChip mentor={section.mentor} isAdmin={isAdmin} onSave={saveMentor} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: complete ? "#fff" : C.green500, background: complete ? C.green400 : C.greenTint, borderRadius: 99, padding: "4px 12px", flexShrink: 0 }}>
          {done} / {total}
        </span>
      </div>
      <div style={{ padding: "8px 22px 18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 0 6px", fontSize: 11, fontWeight: 900, letterSpacing: "0.09em", textTransform: "uppercase", color: C.inkFaint, borderBottom: `1px solid ${C.lineSoft}` }}>
          <span>Done</span><span>Item</span>{showDate && <span>Date</span>}<span>Notes</span><span>Links</span>
        </div>
        {section.items.map((item) => (
          <ItemRow key={item.id} item={item} showDate={showDate} isAdmin={isAdmin}
            onProgress={(patch) => progress(item.id, patch)}
            onLinkAdd={async (label, url) => {
              try {
                const link = await db.addLink(item.id, label, url, item.links.length);
                onMutate((d) => { item.links.push({ id: link.id, label, url }); });
              } catch { onToast("Couldn't add link"); }
            }}
            onLinkRemove={async (linkId) => {
              try { await db.removeLink(linkId); onMutate((d) => { item.links = item.links.filter((l) => l.id !== linkId); }); }
              catch { onToast("Couldn't remove link"); }
            }}
            onRename={async (label) => {
              try { await db.renameItem(item.id, label); onMutate((d) => { item.title = label; }); }
              catch { onToast("Couldn't rename row"); }
            }}
            onRemove={async () => {
              if (!window.confirm(`Remove "${item.title}"?`)) return;
              try { await db.deleteItem(item.id); onMutate((d) => { section.items = section.items.filter((i) => i.id !== item.id); }); }
              catch { onToast("Couldn't remove row"); }
            }}
          />
        ))}
        {isAdmin && (
          <button onClick={addRow} data-print="hide" style={{
            marginTop: 12, display: "flex", alignItems: "center", gap: 8, border: `1px dashed #b7c4a8`,
            background: "#f8faf2", color: C.green500, borderRadius: 10, padding: "8px 16px", fontSize: 13,
            fontWeight: 800, cursor: "pointer", fontFamily: FONT,
          }}>
            <Plus size={13} /> Add row
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Phase block
----------------------------------------------------------------- */

function PhaseBlock({ phase, num, isAdmin, onMutate, onToast }) {
  const { done, total } = phaseCounts(phase);
  const p = pct(done, total);

  return (
    <section id={`phase-${phase.id}`} style={{ display: "flex", flexDirection: "column", gap: 20, scrollMarginTop: 74 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, borderRadius: 16, padding: "18px 24px", background: `linear-gradient(120deg, ${C.green800} 0%, ${C.green500} 55%, ${C.green300} 100%)`, color: "#fdfdf8", boxShadow: "0 6px 18px rgba(30,77,43,0.22)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#e8f0d8", flexShrink: 0 }}>{num}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: "-0.01em", fontFamily: FONT }}>{phase.label}</h2>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.cream, marginTop: 2 }}>{phase.subtitle}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 110, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, background: "#d5e4b5", width: `${p}%`, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#e8f0d8" }}>{p}%</span>
        </div>
      </div>
      {phase.sections.map((s) => (
        <SectionCard key={s.id} section={s} isAdmin={isAdmin} onMutate={onMutate} onToast={onToast} />
      ))}
    </section>
  );
}
function BulletListView({ items, editable, onChange, placeholder }) {
  if (!editable) {
    return (
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.length === 0 && <li style={{ color: C.inkFaint, listStyle: "none", marginLeft: -18 }}>—</li>}
        {items.map((v, i) => <li key={i} style={{ fontSize: 13.5, color: C.ink, fontWeight: 600 }}>{v}</li>)}
      </ul>
    );
  }
  const update = (i, val) => { const next = [...items]; next[i] = val; onChange(next); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((v, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.green400, fontWeight: 900 }}>•</span>
          <input value={v} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} style={{ ...inputStyle(false), flex: 1 }} />
          <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={13} /></button>
        </div>
      ))}
      <button onClick={add} style={addSmallBtn}><Plus size={12} /> Add</button>
    </div>
  );
}

function MiniChecklistView({ items, editable, onChange }) {
  if (!editable) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.length === 0 && <span style={{ color: C.inkFaint, fontSize: 13 }}>—</span>}
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${it.done ? C.green400 : "#c2cdb6"}`, background: it.done ? C.green400 : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {it.done && <Check size={11} color="#fff" />}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: it.done ? C.inkSoft : C.ink, textDecoration: it.done ? "line-through" : "none" }}>{it.label || "—"}</span>
          </div>
        ))}
      </div>
    );
  }
  const toggle = (i) => onChange(items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  const setLabel = (i, label) => onChange(items.map((it, idx) => (idx === i ? { ...it, label } : it)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { label: "", done: false }]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => toggle(i)} className="check-box" style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${it.done ? C.green400 : "#c2cdb6"}`, background: it.done ? C.green400 : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            {it.done && <Check size={12} color="#fff" />}
          </button>
          <input value={it.label} onChange={(e) => setLabel(i, e.target.value)} placeholder="Describe this item" style={{ ...inputStyle(false), flex: 1 }} />
          <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={13} /></button>
        </div>
      ))}
      <button onClick={add} style={addSmallBtn}><Plus size={12} /> Add</button>
    </div>
  );
}

function MaterialsListView({ materials, editable, onChange }) {
  const [label, setLabel] = useState(""); const [url, setUrl] = useState(""); const [type, setType] = useState("doc");
  const submit = () => {
    if (!label.trim()) return;
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
    onChange([...materials, { type, label: label.trim(), url: u }]);
    setLabel(""); setUrl("");
  };
  const remove = (i) => onChange(materials.filter((_, idx) => idx !== i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {materials.length === 0 && !editable && <span style={{ color: C.inkFaint, fontSize: 13 }}>—</span>}
      {materials.map((m, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{m.type === "video" ? "🎥" : "📄"}</span>
          {m.url ? (
            <a href={m.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 700, color: C.green500, flex: 1 }}>{m.label}</a>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, flex: 1 }}>{m.label}</span>
          )}
          {editable && <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={13} /></button>}
        </div>
      ))}
      {editable && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
          <button onClick={() => setType(type === "doc" ? "video" : "doc")} title="Toggle document / video" style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: "#fff", cursor: "pointer", padding: "6px 9px", fontSize: 14 }}>{type === "video" ? "🎥" : "📄"}</button>
          <input placeholder="Material name" value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle(false), flex: 1.2 }} />
          <input placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...inputStyle(false), flex: 1.2 }} />
          <button onClick={submit} style={{ ...smallBtn, background: C.green400, color: "#fff", border: "none" }}>Add</button>
        </div>
      )}
    </div>
  );
}

const fieldLabel = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 800, color: C.amberText, fontFamily: FONT };
const fieldTitle = { fontSize: 12.5, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.amberText, marginBottom: 8, fontFamily: FONT };

function SignOffCard({ signoff, editable, onSave }) {
  const [local, setLocal] = useState(signoff);
  useEffect(() => setLocal(signoff), [signoff]);
  const set = (patch) => { const next = { ...local, ...patch }; setLocal(next); onSave(next); };

  const Field = ({ label, value, field, textarea }) => editable ? (
    <label style={fieldLabel}>{label}
      {textarea
        ? <textarea value={local[field]} onChange={(e) => set({ [field]: e.target.value })} rows={2} style={{ ...inputStyle(false), resize: "vertical" }} />
        : <input value={local[field]} onChange={(e) => set({ [field]: e.target.value })} style={inputStyle(false)} />}
    </label>
  ) : (
    <div>
      <div style={fieldTitle}>{label}</div>
      <div style={{ fontSize: 13.5, color: C.ink, fontWeight: 600 }}>{value || "—"}</div>
    </div>
  );

  return (
    <div style={{ background: C.amberBg, border: `2px dashed ${C.amberLight}`, borderRadius: 16, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.09em", textTransform: "uppercase", color: "#fff", background: C.amber, borderRadius: 6, padding: "4px 10px" }}>Sign-Off</span>
        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: C.amberText, fontFamily: FONT }}>Assessment &amp; sign-off record</h4>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Target Completion" value={local.targetCompletion} field="targetCompletion" />
        <Field label="Subject Matter Expert" value={local.sme} field="sme" />
      </div>

      <Field label="Overview" value={local.overview} field="overview" textarea />

      <div>
        <div style={fieldTitle}>Learning Outcomes</div>
        <BulletListView items={local.learningOutcomes} editable={editable} onChange={(v) => set({ learningOutcomes: v })} placeholder="Understand…" />
      </div>

      <div>
        <div style={fieldTitle}>Training Materials</div>
        <MaterialsListView materials={local.materials} editable={editable} onChange={(v) => set({ materials: v })} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={fieldTitle}>Assessment</div>
          <MiniChecklistView items={local.assessment} editable={editable} onChange={(v) => set({ assessment: v })} />
        </div>
        <div>
          <div style={fieldTitle}>Evidence</div>
          <MiniChecklistView items={local.evidence} editable={editable} onChange={(v) => set({ evidence: v })} />
        </div>
      </div>

      <div>
        <div style={fieldTitle}>Assessment Outcome</div>
        {editable ? (
          <div style={{ display: "flex", gap: 10 }}>
            {["Still Developing", "Competent"].map((label) => {
              const active = local.outcome === label;
              return (
                <button key={label} className="check-box" onClick={() => set({ outcome: active ? null : label })} style={{
                  border: `1.5px solid ${active ? C.green400 : C.line}`, background: active ? C.green400 : "#fff",
                  color: active ? "#fff" : C.ink, borderRadius: 99, padding: "8px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                }}>{label}</button>
              );
            })}
          </div>
        ) : (
          <span style={{ fontSize: 13.5, fontWeight: 700, color: local.outcome === "Competent" ? C.green500 : C.inkSoft }}>{local.outcome || "Not yet assessed"}</span>
        )}
      </div>

      <Field label="Assessed By" value={local.assessedBy} field="assessedBy" />

      <div style={{ borderTop: `1px solid ${C.amberLight}`, paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="SME Sign-Off — Name" value={local.signName} field="signName" />
        <Field label="Date" value={local.signDate} field="signDate" />
      </div>
    </div>
  );
}
function ModuleBlock({ month, module, idx, isAdmin, onMutate, onToast }) {
  const [open, setOpen] = useState(idx === 0);
  const [editingTitle, setEditingTitle] = useState(false);
  const { done, total } = moduleCounts(module);
  const p = pct(done, total);
  const saveTimer = React.useRef(null);

  const saveTimers = React.useRef({});
  const pendingPatch = React.useRef({});
  const flush = (itemId) => {
    const patch = pendingPatch.current[itemId];
    if (!patch) return;
    pendingPatch.current[itemId] = null;
    saveTracked(() => db.saveItemProgress(itemId, patch, undefined)).catch(() => onToast("Couldn't save — try again"));
  };
  const progress = (itemId, patch) => {
    onMutate((d) => { Object.assign(module.subheadings.find((s) => s.id === itemId), patch); });
    pendingPatch.current[itemId] = { ...(pendingPatch.current[itemId] || {}), ...patch };
    clearTimeout(saveTimers.current[itemId]);
    if ("done" in patch) { flush(itemId); return; }
    saveTimers.current[itemId] = setTimeout(() => flush(itemId), 700);
  };

  const saveSignoff = (next) => {
    onMutate((d) => { module.signoff = next; });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTracked(() => db.updateSignoff(module.id, next)).catch(() => onToast("Couldn't save sign-off"));
    }, 500);
  };

  const saveTitle = (title) => {
    const clean = title.trim() || module.title;
    onMutate((d) => { module.title = clean; });
    setEditingTitle(false);
    saveTracked(() => db.updateModule(module.id, { title: clean })).catch(() => onToast("Couldn't save module heading"));
  };

  const deleteModule = async () => {
    if (!window.confirm(`Delete "${module.title}" and all its content?`)) return;
    try {
      await db.deleteModule(module.id);
      onMutate((d) => { month.modules = month.modules.filter((m) => m.id !== module.id); });
    } catch { onToast("Couldn't delete module"); }
  };

  const addTopic = async () => {
    const label = window.prompt("Topic name");
    if (!label) return;
    try {
      const item = await db.addItem({ module_id: module.id }, label, module.subheadings.length);
      onMutate((d) => { module.subheadings.push({ id: item.id, title: label, showDate: false, done: false, date: "", notes: "", comment: "", links: [] }); });
    } catch { onToast("Couldn't add topic"); }
  };

  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 10px rgba(35,48,31,0.05)" }}>
      <div onClick={() => !editingTitle && setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", background: `linear-gradient(100deg, ${C.greenTintSoft}, #f8f9f1 70%)`, cursor: editingTitle ? "default" : "pointer", borderBottom: open ? `1px solid ${C.line}` : "none" }}>
        <div style={{ width: 8, height: 28, borderRadius: 99, background: `linear-gradient(180deg, ${C.green400}, ${C.green200})`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isAdmin && editingTitle ? (
            <input
              autoFocus defaultValue={module.title} onClick={(e) => e.stopPropagation()}
              onBlur={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
              style={{ ...inputStyle(false), fontWeight: 900, fontSize: 15 }}
            />
          ) : (
            <h3
              onClick={(e) => { if (isAdmin) { e.stopPropagation(); setEditingTitle(true); } }}
              style={{ margin: 0, fontSize: 16.5, fontWeight: 900, color: C.ink, fontFamily: FONT, cursor: isAdmin ? "text" : "default", display: "flex", alignItems: "center", gap: 6 }}
            >
              {idx + 1}. {module.title}
              {isAdmin && <Pencil size={11} style={{ opacity: 0.35, flexShrink: 0 }} data-print="hide" />}
            </h3>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginTop: 2 }}>SME: {module.sme}</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: p === 100 ? "#fff" : C.green500, background: p === 100 ? C.green400 : C.greenTint, borderRadius: 99, padding: "4px 12px", flexShrink: 0 }}>{done} / {total}</span>
        {isAdmin && (
          <button data-print="hide" onClick={(e) => { e.stopPropagation(); deleteModule(); }} title="Delete module" style={{ background: "none", border: "none", color: C.rust, cursor: "pointer" }}>
            <X size={16} />
          </button>
        )}
        <span data-print="hide">{open ? <ChevronDown size={18} color={C.inkSoft} /> : <ChevronRight size={18} color={C.inkSoft} />}</span>
      </div>

      <div className="module-body" style={{ padding: "8px 22px 22px", display: open ? "flex" : "none", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.85fr)", gap: 12, padding: "10px 0 6px", fontSize: 11, fontWeight: 900, letterSpacing: "0.09em", textTransform: "uppercase", color: C.inkFaint, borderBottom: `1px solid ${C.lineSoft}` }}>
            <span>Done</span><span>Topic</span><span>Notes</span><span>Links</span>
          </div>
          {module.subheadings.map((s) => (
            <ItemRow key={s.id} item={s} showDate={false} isAdmin={isAdmin}
              onProgress={(patch) => progress(s.id, patch)}
              onLinkAdd={async (label, url) => {
                try { const link = await db.addLink(s.id, label, url, s.links.length); onMutate((d) => { s.links.push({ id: link.id, label, url }); }); }
                catch { onToast("Couldn't add link"); }
              }}
              onLinkRemove={async (linkId) => {
                try { await db.removeLink(linkId); onMutate((d) => { s.links = s.links.filter((l) => l.id !== linkId); }); }
                catch { onToast("Couldn't remove link"); }
              }}
              onRename={async (label) => {
                try { await db.renameItem(s.id, label); onMutate((d) => { s.title = label; }); }
                catch { onToast("Couldn't rename topic"); }
              }}
              onRemove={async () => {
                if (!window.confirm(`Remove "${s.title}"?`)) return;
                try { await db.deleteItem(s.id); onMutate((d) => { module.subheadings = module.subheadings.filter((x) => x.id !== s.id); }); }
                catch { onToast("Couldn't remove topic"); }
              }}
            />
          ))}
          {isAdmin && (
            <button data-print="hide" onClick={addTopic} style={{ ...addSmallBtn, marginTop: 10 }}>
              <Plus size={12} /> Add topic
            </button>
          )}
        </div>
        <SignOffCard signoff={module.signoff} editable={isAdmin} onSave={saveSignoff} />
      </div>
    </div>
  );
}

function MonthNameEditable({ month, isAdmin, onSave }) {
  const [editing, setEditing] = useState(false);
  if (isAdmin && editing) {
    return (
      <input
        autoFocus defaultValue={month.name}
        onBlur={(e) => { onSave(e.target.value.trim() || month.name); setEditing(false); }}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        style={{ ...inputStyle(false), width: 160, fontWeight: 900, fontSize: 14, letterSpacing: "0.02em", textTransform: "uppercase" }}
      />
    );
  }
  return (
    <h3
      onClick={() => isAdmin && setEditing(true)}
      style={{ margin: 0, fontSize: 15, fontWeight: 900, color: C.green600, fontFamily: FONT, letterSpacing: "0.02em", textTransform: "uppercase", cursor: isAdmin ? "text" : "default", display: "flex", alignItems: "center", gap: 5 }}
    >
      {month.name}
      {isAdmin && <Pencil size={10} style={{ opacity: 0.35 }} data-print="hide" />}
    </h3>
  );
}

function LDPhase({ ldMonths, num, isAdmin, onMutate, onToast }) {
  const { done, total } = ldCounts(ldMonths);
  const p = pct(done, total);

  const addMonth = async () => {
    const name = window.prompt("Name the new month (e.g. Month 2)", `Month ${ldMonths.length + 1}`);
    if (!name) return;
    try {
      const m = await db.addMonth(name, ldMonths.length);
      onMutate((d) => { d.ldMonths.push({ id: m.id, name, modules: [] }); });
    } catch { onToast("Couldn't add month"); }
  };
  const addModule = async (month) => {
    const title = window.prompt("Module title");
    if (!title) return;
    const sme = window.prompt("Subject matter expert(s)") || "";
    try {
      const mod = await db.addModule(month.id, title, sme, month.modules.length);
      onMutate((d) => {
        month.modules.push({
          id: mod.id, title, sme, subheadings: [],
          signoff: { targetCompletion: "", sme, overview: "", learningOutcomes: [], materials: [], assessment: [], evidence: [], outcome: null, assessedBy: sme, signName: "", signDate: "" },
        });
      });
    } catch { onToast("Couldn't add module"); }
  };

  const toggleLock = async (month) => {
    const next = !month.unlocked;
    onMutate((d) => { month.unlocked = next; });
    try { await db.updateMonthLock(month.id, next); } catch { onToast("Couldn't update lock"); }
  };

  const saveMonthName = (month, name) => {
    onMutate((d) => { month.name = name; });
    saveTracked(() => db.updateMonthName(month.id, name)).catch(() => onToast("Couldn't save month heading"));
  };

  return (
    <section id="phase-ld" style={{ display: "flex", flexDirection: "column", gap: 20, scrollMarginTop: 74 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, borderRadius: 16, padding: "18px 24px", background: `linear-gradient(120deg, ${C.green800} 0%, ${C.green500} 55%, ${C.green300} 100%)`, color: "#fdfdf8", boxShadow: "0 6px 18px rgba(30,77,43,0.22)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#e8f0d8", flexShrink: 0 }}>{num}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: "-0.01em", fontFamily: FONT }}>Learning &amp; Development Modules</h2>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.cream, marginTop: 2 }}>Training curriculum, by month — each module carries its own sign-off record</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 110, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, background: "#d5e4b5", width: `${p}%`, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#e8f0d8" }}>{p}%</span>
        </div>
      </div>

      {ldMonths.map((month) => {
        // Locked months are invisible to staff entirely — admins still see
        // them (with the toggle) so they can draft ahead before unlocking.
        if (!isAdmin && !month.unlocked) return null;
        return (
        <div key={month.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MonthNameEditable month={month} isAdmin={isAdmin} onSave={(name) => saveMonthName(month, name)} />
            {isAdmin && (
              <button data-print="hide" onClick={() => toggleLock(month)} style={{
                display: "flex", alignItems: "center", gap: 5, border: "none", cursor: "pointer",
                fontFamily: FONT, fontSize: 11, fontWeight: 800, borderRadius: 20, padding: "4px 10px",
                background: month.unlocked ? C.greenTint : "#f3e3d3", color: month.unlocked ? C.green500 : C.amberText,
              }}>
                {month.unlocked ? <><Unlock size={11} /> Unlocked — visible to staff</> : <><Lock size={11} /> Locked — admin only</>}
              </button>
            )}
          </div>
          {month.modules.map((mod, idx) => (
            <ModuleBlock key={mod.id} month={month} module={mod} idx={idx} isAdmin={isAdmin} onMutate={onMutate} onToast={onToast} />
          ))}
          {isAdmin && (
            <button data-print="hide" onClick={() => addModule(month)} style={{
              display: "flex", alignItems: "center", gap: 8, border: `1px dashed #b7c4a8`, background: "#f8faf2",
              color: C.green500, borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
            }}>
              <Plus size={13} /> Add module to {month.name}
            </button>
          )}
        </div>
        );
      })}
      {isAdmin && (
        <button data-print="hide" onClick={addMonth} style={{
          alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.green400}`,
          background: "#fff", color: C.green500, borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
        }}>
          <Plus size={13} /> Add month
        </button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------
   Admin: manage who else can administer the workbook
----------------------------------------------------------------- */

function StaffLoginsPanel({ onToast }) {
  const [open, setOpen] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [customPassword, setCustomPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null); // { email, tempPassword }

  const create = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) { onToast("Must be an @ecologyconsulting.au email"); return; }
    if (customPassword && customPassword.length < 8) { onToast("Custom password must be at least 8 characters"); return; }
    setBusy(true);
    setIssued(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/invite-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ email, password: customPassword || undefined, forceChange }),
      });
      const body = await res.json();
      if (!res.ok) { onToast(body.error || "Couldn't create login"); return; }
      setIssued({ email: body.email, tempPassword: body.tempPassword });
      setNewEmail(""); setCustomPassword(""); setForceChange(true); setShowAdvanced(false);
    } catch {
      onToast("Couldn't reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-print="hide" style={{ background: "#fff", border: `2px solid ${C.green400}`, borderRadius: 16, padding: "16px 22px" }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <span style={{
          fontSize: 10.5, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "#fff", background: C.green400, borderRadius: 20, padding: "3px 10px", flexShrink: 0,
        }}>
          Step 1 — Admin only
        </span>
        <Lock size={16} color={C.green500} />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: C.ink, fontFamily: FONT, flex: 1 }}>Set up a new staff member</h3>
        {open ? <ChevronDown size={16} color={C.inkSoft} /> : <ChevronRight size={16} color={C.inkSoft} />}
      </div>
      {open && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: C.inkSoft, fontWeight: 600, lineHeight: 1.6 }}>
            This is where onboarding a new person actually starts — an admin action, done from here, not from the staff sign-in screen itself:
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: C.inkSoft, fontWeight: 600, lineHeight: 1.6 }}>
            1. You create their login here (below) — they get a one-time temporary password<br />
            2. You relay it to them directly (Slack, in person, phone)<br />
            3. They sign in, set their own password, and fill in their own Employee Details as their first onboarding step<br />
            4. From there they work through the rest of the onboarding worksheet themselves — you can follow their progress any time from the roster below
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@ecologyconsulting.au"
              onKeyDown={(e) => e.key === "Enter" && create()} style={{ ...inputStyle(false), flex: 1 }} />
            <button onClick={create} disabled={busy} style={{ ...smallBtn, background: C.green400, color: "#fff", border: "none", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Creating…" : "Create login"}
            </button>
          </div>

          <button onClick={() => setShowAdvanced((s) => !s)} style={{ ...addSmallBtn, alignSelf: "flex-start" }}>
            {showAdvanced ? "Hide" : "Show"} advanced options (choose your own password — for a specific test account, not for everyone)
          </button>
          {showAdvanced && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: C.greenTintSoft, borderRadius: 8, padding: "10px 12px" }}>
              <input
                type="text" value={customPassword} onChange={(e) => setCustomPassword(e.target.value)}
                placeholder="Custom password (optional, min. 8 characters)"
                style={inputStyle(false)}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: C.inkSoft, cursor: "pointer" }}>
                <input type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} />
                Require this account to set its own password on first login (recommended — leave checked for anyone but a personal test account)
              </label>
            </div>
          )}

          {issued && (
            <div style={{ background: C.amberBg, border: `1px solid ${C.amberLight}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.amberText, marginBottom: 4 }}>
                Shown once, copy it now, it's not saved anywhere:
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{issued.email}</div>
              <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 2, userSelect: "all" }}>{issued.tempPassword}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminPanel({ adminEmails, currentEmail, onMutate, onToast }) {
  const [open, setOpen] = useState(true);
  const [newEmail, setNewEmail] = useState("");

  const add = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) { onToast("Admin emails must end in @ecologyconsulting.au"); return; }
    try { await db.addAdminEmail(email, currentEmail); onMutate((d) => { d.adminEmails.push(email); }); setNewEmail(""); }
    catch { onToast("Couldn't add admin — they may already have access"); }
  };
  const remove = async (email) => {
    if (!window.confirm(`Remove admin access for ${email}?`)) return;
    try { await db.removeAdminEmail(email); onMutate((d) => { d.adminEmails = d.adminEmails.filter((e) => e !== email); }); }
    catch { onToast("Couldn't remove admin"); }
  };

  return (
    <div data-print="hide" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 22px" }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <Users2 size={16} color={C.green500} />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: C.ink, fontFamily: FONT, flex: 1 }}>Admin access ({adminEmails.length})</h3>
        {open ? <ChevronDown size={16} color={C.inkSoft} /> : <ChevronRight size={16} color={C.inkSoft} />}
      </div>
      {open && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {adminEmails.map((email) => (
            <div key={email} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: C.ink }}>
              <ShieldCheck size={13} color={C.green400} />
              <span style={{ flex: 1 }}>{email}</span>
              <button onClick={() => remove(email)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={13} /></button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@ecologyconsulting.au"
              onKeyDown={(e) => e.key === "Enter" && add()} style={{ ...inputStyle(false), flex: 1 }} />
            <button onClick={add} style={{ ...smallBtn, background: C.green400, color: "#fff", border: "none" }}>Add admin</button>
          </div>
        </div>
      )}
    </div>
  );
}
/* ---------------------------------------------------------------
   Admin: staff onboarding progress (list + read-only detail report)
----------------------------------------------------------------- */

function relativeTime(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? "1 month ago" : `${mo} months ago`;
}

function StaffReport({ staff, onBack, onToast }) {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    db.fetchWorkbook(staff.id)
      .then((wb) => { if (alive) setBoard(wb); })
      .catch(() => { if (alive) onToast("Couldn't load this staff member's progress"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [staff.id, onToast]);

  const done = staff.done, total = staff.total, p = pct(done, total);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <button onClick={onBack} data-print="hide" style={{
        alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "#fff",
        border: `1px solid ${C.lineSoft}`, color: C.green600, borderRadius: 8, padding: "7px 12px",
        fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
      }}>
        <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> All staff
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 16, borderRadius: 16, padding: "18px 24px", background: `linear-gradient(120deg, ${C.green800} 0%, ${C.green500} 55%, ${C.green300} 100%)`, color: "#fdfdf8" }}>
        <div style={{ width: 48, height: 48, borderRadius: 99, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, flexShrink: 0 }}>
          {staff.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{staff.name}</h2>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.cream }}>{staff.email}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 120, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, background: "#d5e4b5", width: `${p}%` }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 900 }}>{p}%</span>
        </div>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: C.inkSoft, fontWeight: 700 }}>Loading progress…</div>}

      {board && board.phases.map((phase) => {
        const pc = phaseCounts(phase);
        return (
          <div key={phase.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: C.green700 }}>{phase.label}</h3>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.inkFaint }}>{pc.done}/{pc.total}</span>
            </div>
            {phase.sections.map((s) => (
              <div key={s.id} style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", background: C.greenTintSoft, borderBottom: `1px solid ${C.line}` }}>
                  <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: C.ink, flex: 1 }}>{s.title}</h4>
                  {s.mentor && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.green500, background: "#EAF3E0", padding: "3px 10px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}><Users2 size={10} /> {s.mentor}</span>}
                </div>
                <div style={{ padding: "4px 18px 12px" }}>
                  {s.items.map((item) => (
                    <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0", borderBottom: `1px solid ${C.lineFaint}` }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                        border: `2px solid ${item.done ? C.green400 : "#c2cdb6"}`, background: item.done ? C.green400 : "#fff",
                        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{item.done && <Check size={12} />}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.green600 }}>{item.title}</div>
                        <div style={{ display: "flex", gap: 18, marginTop: 3, flexWrap: "wrap" }}>
                          {item.showDate && <span style={{ fontSize: 12, fontWeight: 600, color: item.date ? C.inkSoft : C.inkFaint }}>Date: {item.date || "—"}</span>}
                          <span style={{ fontSize: 12, fontWeight: 600, color: item.notes ? C.inkSoft : C.inkFaint }}>Notes: {item.notes || "—"}</span>
                        </div>
                        {item.comment && (
                          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: C.amberText, background: C.amberBg, border: `1px solid ${C.amberLight}`, borderRadius: 6, padding: "5px 9px" }}>
                            <strong>Admin note:</strong> {item.comment}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function StaffProgress({ onToast }) {
  const [state, setState] = useState({ loading: true, staff: [], error: "" });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    db.fetchStaffProgress()
      .then((res) => { if (alive) setState({ loading: false, staff: res.staff, error: "" }); })
      .catch((e) => { if (alive) setState({ loading: false, staff: [], error: e.message || "Failed to load" }); });
    return () => { alive = false; };
  }, []);

  if (selected) return <StaffReport staff={selected} onBack={() => setSelected(null)} onToast={onToast} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.green700 }}>Staff Onboarding Progress</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, fontWeight: 600, color: C.inkSoft }}>
          Everyone who has signed in. Click a name to view their completed items, dates, and notes.
        </p>
      </div>

      {state.loading && <div style={{ padding: 30, textAlign: "center", color: C.inkSoft, fontWeight: 700 }}>Loading staff…</div>}
      {state.error && <div style={{ padding: 16, background: C.amberBg, border: `1px solid ${C.amberLight}`, borderRadius: 12, color: C.amberText, fontWeight: 700 }}>{state.error}</div>}
      {!state.loading && !state.error && state.staff.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: C.inkSoft, fontWeight: 600, background: C.cardBg, border: `1px dashed ${C.line}`, borderRadius: 12 }}>
          No staff have signed in yet.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {state.staff.map((s) => (
          <button key={s.id} onClick={() => setSelected(s)} style={{
            display: "flex", alignItems: "center", gap: 16, textAlign: "left", cursor: "pointer",
            background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 18px", fontFamily: FONT,
          }}>
            <div style={{ width: 42, height: 42, borderRadius: 99, background: C.greenTint, color: C.green600, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, flexShrink: 0 }}>
              {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{s.name}</span>
                {s.isAdmin && <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "#8a6d1a", background: "#f6ebca", borderRadius: 20, padding: "2px 8px", display: "flex", alignItems: "center", gap: 3 }}><ShieldCheck size={10} /> Admin</span>}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>{s.email} · last active {relativeTime(s.lastSignIn)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ width: 130, height: 8, borderRadius: 99, background: C.lineSoft, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, background: s.percent === 100 ? C.green400 : C.green300, width: `${s.percent}%` }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 900, color: C.green600, width: 68, textAlign: "right" }}>{s.done}/{s.total} · {s.percent}%</span>
              <ChevronRight size={18} color={C.inkFaint} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Live auto-save indicator (subscribes to saveTracked events)
----------------------------------------------------------------- */

/* ---------------------------------------------------------------
   Settings — self-service password change, for anyone signed in
   (this is what fixes an admin with no password: sign in via
   email link, then set one here yourself, no other admin needed)
----------------------------------------------------------------- */

function SettingsModal({ onClose, onToast }) {
  const { setNewPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (password.length < 10) { setStatus("error"); setMessage("Use at least 10 characters."); return; }
    if (password !== confirm) { setStatus("error"); setMessage("Passwords don't match."); return; }
    setStatus("sending");
    const { error } = await setNewPassword(password);
    if (error) { setStatus("error"); setMessage(error); return; }
    setStatus("done");
    onToast("Password updated");
    setTimeout(onClose, 900);
  };

  return (
    <div data-print="hide" style={{ position: "fixed", inset: 0, background: "rgba(22,55,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "28px 26px", width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: C.ink, fontFamily: FONT }}>Change your password</h3>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, marginTop: 6, lineHeight: 1.5 }}>
          Sets the password for your own account. If you've been signing in with a temporary password or an email link, this makes password sign-in yours going forward.
        </p>
        {status === "done" ? (
          <div style={{ marginTop: 16, background: C.greenTintSoft, border: `1px solid ${C.greenTint}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, fontWeight: 700, color: C.green700 }}>
            Password updated.
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (at least 10 characters)" autoComplete="new-password" style={inputStyle(false)} />
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password" autoComplete="new-password" style={inputStyle(false)} />
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button type="submit" disabled={status === "sending"} style={{
                flex: 1, background: C.green400, color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px",
                fontSize: 13.5, fontWeight: 800, cursor: status === "sending" ? "default" : "pointer", opacity: status === "sending" ? 0.7 : 1, fontFamily: FONT,
              }}>
                {status === "sending" ? "Saving…" : "Save password"}
              </button>
              <button type="button" onClick={onClose} style={{
                background: "#fff", border: `1px solid ${C.line}`, color: C.inkSoft, borderRadius: 8, padding: "10px 14px",
                fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
              }}>
                Cancel
              </button>
            </div>
            {status === "error" && <div style={{ color: C.rust, fontSize: 12.5, fontWeight: 700 }}>{message}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

function SaveStatus() {
  const [status, setStatus] = useState("idle");
  const revert = React.useRef(null);
  useEffect(() => {
    return onSaveStatus((s) => {
      setStatus(s);
      clearTimeout(revert.current);
      if (s === "saved") revert.current = setTimeout(() => setStatus("synced"), 1800);
    });
  }, []);
  if (status === "idle") return null;
  const map = {
    saving: { icon: <Loader2 size={13} className="wb-spin" />, text: "Saving…" },
    saved: { icon: <CheckCircle2 size={13} />, text: "Saved" },
    synced: { icon: <CheckCircle2 size={13} />, text: "All changes saved" },
    error: { icon: <AlertCircle size={13} />, text: "Save failed — retrying on next change" },
  };
  const s = map[status] || map.synced;
  const danger = status === "error";
  return (
    <div data-print="hide" aria-live="polite" style={{
      display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800,
      color: danger ? "#ffd9d1" : C.cream, background: "rgba(255,255,255,0.12)",
      border: `1px solid ${danger ? "rgba(255,150,130,0.5)" : "rgba(255,255,255,0.25)"}`,
      borderRadius: 8, padding: "6px 10px", whiteSpace: "nowrap",
    }}>
      {s.icon} {s.text}
    </div>
  );
}

/* ---------------------------------------------------------------
   App
----------------------------------------------------------------- */

/* ---------------------------------------------------------------
   Workbook sidebar — a real table of contents. Click any heading,
   jump straight to it. Same list either side of the login (admin
   or staff), pure navigation, no permissions involved.
----------------------------------------------------------------- */

function WorkbookSidebar({ navItems }) {
  return (
    <aside data-print="hide" style={{
      width: 220, flexShrink: 0, position: "sticky", top: 84, alignSelf: "flex-start",
      display: "flex", flexDirection: "column", gap: 4,
      maxHeight: "calc(100vh - 110px)", overflowY: "auto",
    }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: C.inkFaint, padding: "0 10px 6px" }}>
        On this page
      </div>
      {navItems.map((n) => {
        const complete = n.total > 0 && n.done === n.total;
        return (
          <a
            key={n.id} href={`#phase-${n.id}`}
            style={{
              textDecoration: "none", display: "flex", alignItems: "center", gap: 8,
              padding: "9px 10px", borderRadius: 8, color: C.green600, fontSize: 13, fontWeight: 700,
              border: `1px solid transparent`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = C.lineSoft; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{n.label}</span>
            <span style={{ fontSize: 10.5, fontWeight: 900, color: complete ? C.green400 : C.inkFaint, flexShrink: 0 }}>{n.done}/{n.total}</span>
          </a>
        );
      })}
    </aside>
  );
}

/* ---------------------------------------------------------------
   Admin landing page — welcome + the three big starting actions
----------------------------------------------------------------- */

function displayNameFromEmail(email) {
  const local = (email || "").split("@")[0] || "";
  return local.split(/[._-]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || email;
}

function ActionTile({ icon, label, desc, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, textAlign: "left",
        cursor: "pointer", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16,
        padding: "22px 22px", fontFamily: FONT, flex: 1, minWidth: 220,
        boxShadow: "0 2px 10px rgba(35,48,31,0.05)",
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 12, background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, color: C.ink }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}

function AdminHome({ user, onNavigate }) {
  const name = displayNameFromEmail(user?.email);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{
        background: `linear-gradient(120deg, ${C.green800} 0%, ${C.green500} 55%, ${C.green300} 100%)`,
        borderRadius: 18, padding: "30px 32px", color: "#fdfdf8", boxShadow: "0 6px 18px rgba(30,77,43,0.22)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.cream, letterSpacing: "0.02em" }}>{greeting.toUpperCase()}</div>
        <h1 style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 900, fontFamily: FONT }}>Welcome back, {name}</h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, fontWeight: 600, color: C.cream, maxWidth: 520, lineHeight: 1.5 }}>
          Pick where you want to start below, or use the tabs above to jump straight to the workbook, staff progress, or the resource library.
        </p>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkFaint, marginBottom: 12 }}>
          Get started
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <ActionTile
            icon={<BookOpen size={22} />} label="Start a New Training Module"
            desc="Add a new module to the shared Learning & Development curriculum."
            color={C.green400} onClick={() => { onNavigate("workbook"); setTimeout(() => document.getElementById("phase-ld")?.scrollIntoView({ behavior: "smooth" }), 50); }}
          />
          <ActionTile
            icon={<Users2 size={22} />} label="Assess a Staff Member"
            desc="Open a staff member's progress, review their completed items and sign-offs."
            color={C.amber} onClick={() => onNavigate("staff")}
          />
          <ActionTile
            icon={<Pencil size={22} />} label="Draft a New Onboarding"
            desc="Build a personal onboarding path for one staff member, then assign it when ready."
            color={C.rust} onClick={() => onNavigate("draft")}
          />
        </div>
      </div>
    </div>
  );
}

export default function OnboardingWorkbook() {
  const { user, isAdmin, signOut } = useAuth();
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [mode, setMode] = useState(() => (isAdmin ? "home" : "workbook")); // "home" (admin) | "workbook" | "staff" | "draft" (admin only) | "mine" | "library"
  const [settingsOpen, setSettingsOpen] = useState(false);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); }, []);

  const load = useCallback(async () => {
    try {
      const wb = await db.fetchWorkbook();
      setData(wb);
    } catch (e) {
      console.error(e);
      showToast("Couldn't load the workbook — check your connection");
    }
    setLoaded(true);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const mutate = (fn) => setData((prev) => {
    // structuredClone-free shallow-safe mutation: operate on the same
    // object graph the callback closures already captured, then
    // shallow-copy to trigger a re-render.
    fn(prev);
    return { ...prev, phases: [...prev.phases], ldMonths: [...prev.ldMonths] };
  });

  if (!loaded || !data) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: FONT, color: C.green800 }}>Loading the onboarding workbook…</div>;
  }

  const navItems = [...data.phases.map((p) => ({ id: p.id, label: p.label, ...phaseCounts(p) })),
    { id: "ld", label: "Learning & Development", ...ldCounts(data.ldMonths) }];

  return (
    <div style={{ minHeight: "100%", background: C.bg, fontFamily: FONT, color: C.ink, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}` }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800;900&display=swap" />
      <style>{`
        @keyframes wb-spin { to { transform: rotate(360deg); } }
        .wb-spin { animation: wb-spin 0.8s linear infinite; }
        @media print {
          nav, [data-print="hide"] { display: none !important; }
          button:not(.check-box) { display: none !important; }
          .module-body { display: flex !important; }
          a { color: ${C.green500} !important; text-decoration: underline !important; }
          input, textarea { border-color: #ccc !important; background: #fff !important; }
          body { background: #fff !important; }
        }
      `}</style>

      {/* Hero */}
      <header style={{ background: `linear-gradient(140deg, ${C.green900} 0%, ${C.green700} 38%, ${C.green400} 72%, ${C.green200} 100%)`, color: "#fdfdf8", padding: "40px 32px 36px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 900px 500px at 85% -10%, rgba(213,228,181,0.28), transparent 60%)" }} />
        <div style={{ maxWidth: 1080, margin: "0 auto", position: "relative", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", display: "inline-block" }}>
                <img src="/logo.png" alt="Ecology Consulting" style={{ height: 28, width: "auto", display: "block" }} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.01em" }}>New Employee Onboarding Workbook</h1>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.cream, marginTop: 2, letterSpacing: "0.02em" }}>BUILDING CAPABILITY · SUPPORTING PEOPLE · GROWING TOGETHER</div>
              </div>
            </div>
            <div data-print="hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800 }}>{user?.email}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: isAdmin ? "#e8d9a8" : C.cream, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                  {isAdmin && <ShieldCheck size={11} />} {isAdmin ? "Admin" : "Staff"}
                </div>
              </div>
              <SaveStatus />
              <button onClick={() => setSettingsOpen(true)} style={heroBtn}><Settings size={13} /> Settings</button>
              <button onClick={() => window.print()} style={heroBtn}><FileText size={13} /> Save as PDF</button>
              <button
                onClick={() => { if (window.confirm("Log out of the onboarding workbook?")) signOut(); }}
                style={heroBtn}
              >
                <LogOut size={13} /> Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Sticky phase nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(244,244,238,0.92)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.lineSoft}`, padding: "12px 32px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          {[
            { key: "home", label: "Home", desc: "Your starting point", Icon: HomeIcon, color: C.green800, adminOnly: true },
            { key: "staff", label: "Staff Progress", desc: "Review and assess staff members", Icon: Users2, color: C.amberText || "#7a6233", adminOnly: true },
            { key: "draft", label: "Draft Onboarding", desc: "Build a path for a new hire", Icon: Pencil, color: C.rust, adminOnly: true },
            { key: "mine", label: "My Onboarding", desc: "Your personally assigned modules", Icon: ClipboardList, color: "#4197D0", adminOnly: false },
            { key: "library", label: "Resource Library", desc: "Career levels, materials & quizzes", Icon: BookOpen, color: C.green400, adminOnly: false },
          ].filter((item) => isAdmin || !item.adminOnly).map(({ key, label, desc, Icon, color }) => {
            const active = mode === key;
            return (
              <button key={key} onClick={() => setMode(key)} style={{
                cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start",
                padding: "9px 14px", borderRadius: 12, fontFamily: FONT, textAlign: "left", minWidth: 148,
                border: `1.5px solid ${active ? color : C.lineSoft}`,
                background: active ? `${color}14` : "#fff",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color }}>
                  <Icon size={13} /> {label}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.3 }}>{desc}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px 80px", display: "flex", gap: 32, alignItems: "flex-start" }}>
        {mode === "workbook" && <WorkbookSidebar navItems={navItems} />}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 56 }}>
          {mode === "library" ? (
            <ResourceLibrary isAdmin={isAdmin} onToast={showToast} />
          ) : mode === "mine" ? (
            <MyOnboarding onToast={showToast} />
          ) : isAdmin && mode === "draft" ? (
            <DraftOnboarding onToast={showToast} currentEmail={user?.email} />
          ) : isAdmin && mode === "staff" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <StaffLoginsPanel onToast={showToast} />
              <AdminPanel adminEmails={data.adminEmails} currentEmail={user?.email} onMutate={mutate} onToast={showToast} />
              <StaffProgress onToast={showToast} />
            </div>
          ) : isAdmin && mode === "home" ? (
            <AdminHome user={user} onNavigate={setMode} />
          ) : (
            <>
              {data.phases.map((phase, i) => (
                <PhaseBlock key={phase.id} phase={phase} num={String(i + 1).padStart(2, "0")} isAdmin={isAdmin} onMutate={mutate} onToast={showToast} />
              ))}
              <LDPhase ldMonths={data.ldMonths} num={String(data.phases.length + 1).padStart(2, "0")} isAdmin={isAdmin} onMutate={mutate} onToast={showToast} />
            </>
          )}
        </main>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onToast={showToast} />}
      <Toast text={toast} />
    </div>
  );
}

const heroBtn = {
  display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.3)",
  color: "#fdfdf8", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
};
