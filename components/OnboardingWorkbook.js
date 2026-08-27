"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus, X, Link as LinkIcon, Download, RotateCcw, Check, Pencil,
  ChevronDown, ChevronRight, FileText, LogOut, ShieldCheck, Users2, Lock, Unlock,
  Loader2, CheckCircle2, AlertCircle, BookOpen, Settings, Home as HomeIcon, ClipboardList,
  Building2, Leaf, TrendingUp, Send, ArrowUpRight,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import * as db from "../lib/data";
import ResourceLibrary from "./ResourceLibrary";
import AdminProjectSetup from "./AdminProjectSetup";
import AdminRemoteOps from "./AdminRemoteOps";
import AdminQuotePipeline from "./AdminQuotePipeline";
import ProjectHealthReport from "./ProjectHealthReport";
import AdminWhsMonitor from "./AdminWhsMonitor";
import StaffForms from "./StaffForms";
import AdminServiceRequests from "./AdminServiceRequests";
import AdminLearningLibrary from "./AdminLearningLibrary";
import StaffLearningLibrary from "./StaffLearningLibrary";
import PortalManagement from "./PortalManagement";
import { DraftOnboarding, MyOnboarding } from "./AssignedOnboarding";
import SpeciesProfiles from "./SpeciesProfiles";
import AdminSpeciesProfiles from "./AdminSpeciesProfiles";

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
  // ── Editorial redesign tokens (from the design mockup) ──
  paper: "#f5f2ea", paperCard: "#fffdf8", paperAlt: "#efece2",
  forest: "#0e2a1c", forestDeep: "#0b2317", eucalypt: "#1f5a34", eucalyptDark: "#164426",
  inkDeep: "#12211a", sage: "#7a877d", sageText: "#3a4740", sageSoft: "#5b6a5f",
  gold: "#e7c979", goldDeep: "#c9962a", teal: "#1d6b6b", tealBright: "#238383",
  rustAccent: "#b5352a", plum: "#7d3b5c", ochre: "#a34a32",
  hair: "rgba(18,33,26,.1)", hairSoft: "rgba(18,33,26,.07)",
};
const SERIF = "'Newsreader', Georgia, serif";
const MONO = "'IBM Plex Mono', monospace";
const FONT = "'Archivo', 'Helvetica Neue', sans-serif";
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
// Rough match from a Month 1 module's title to its Resource Library topic
// folder — good enough for a "related resources" link, not meant to be
// exhaustive or exact for every possible module title an admin might add.
function matchLibraryTopic(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("legislation") || t.includes("pathway") || t.includes("approval")) return "Pathways & Legislation";
  if (t.includes("flora") || t.includes("habitat")) return "Flora";
  if (t.includes("fauna")) return "Fauna";
  if (t.includes("report")) return "Reporting";
  if (t.includes("gis") || t.includes("mapping") || t.includes("spatial")) return "GIS";
  if (t.includes("business") || t.includes("operations")) return "Business Operations";
  if (t.includes("project") || t.includes("delivery")) return "Projects";
  return null;
}

function ModuleBlock({ month, module, idx, isAdmin, onMutate, onToast, onGoToLibraryTopic }) {
  const [open, setOpen] = useState(idx === 0);
  const [editingTitle, setEditingTitle] = useState(false);
  const { done, total } = moduleCounts(module);
  const p = pct(done, total);
  const saveTimer = React.useRef(null);
  const libraryTopic = matchLibraryTopic(module.title);

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
        {libraryTopic && onGoToLibraryTopic && (
          <button data-print="hide" onClick={() => onGoToLibraryTopic(libraryTopic)} style={{
            alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: C.greenTintSoft,
            border: `1px solid ${C.greenTint}`, borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 800,
            color: C.green700, cursor: "pointer", fontFamily: FONT,
          }}>
            <BookOpen size={13} /> Related resources &amp; quizzes ({libraryTopic}) →
          </button>
        )}
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

function LDPhase({ ldMonths, num, isAdmin, onMutate, onToast, onGoToLibraryTopic }) {
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
            <ModuleBlock key={mod.id} month={month} module={mod} idx={idx} isAdmin={isAdmin} onMutate={onMutate} onToast={onToast} onGoToLibraryTopic={onGoToLibraryTopic} />
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
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Auto-hide the temp password 2 minutes after it's shown, so it doesn't
  // linger on a shared screen. A live countdown tells the admin how long is left.
  useEffect(() => {
    if (!issued) return;
    setSecondsLeft(120);
    const tick = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(tick); setIssued(null); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [issued]);

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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.amberText }}>
                  Copy it now — hides in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                </div>
                <button onClick={() => setIssued(null)} style={{ background: "none", border: `1px solid ${C.amberLight}`, color: C.amberText, borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>
                  Hide now
                </button>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{issued.email}</div>
              <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 2, userSelect: "all" }}>{issued.tempPassword}</div>
              <div style={{ height: 3, borderRadius: 99, background: "#eaddc0", marginTop: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(secondsLeft / 120) * 100}%`, background: C.amber, transition: "width 1s linear" }} />
              </div>
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
    <aside className="wb-sidebar" data-print="hide" style={{
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
  const { session } = useAuth();
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/admin-counts", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json()).then((d) => setCounts(d.counts || {})).catch(() => {});
  }, [session]);

  // Six domains. Reporting & analytics is no longer a standalone domain —
  // the project health report now lives inside Projects & operations as a
  // sub-tab (see the "adminprojects" render branch below).
  const domains = [
    { eyebrow: "Delivery & commercial", title: "Projects & operations", desc: "Setup, allocations, schedules, client records, quotes, remote delivery — plus the portfolio health report: completion, spend and at-risk projects.", accent: "#2f8f8f", accent2: "#1a4a4a", Icon: Building2, mode: "adminprojects" },
    { eyebrow: "Safety & governance", title: "WHS & compliance", desc: "WHS monitoring, drafts awaiting review, toolbox talks and incident oversight.", accent: "#4fb583", accent2: "#12291b", Icon: ShieldCheck, mode: "whsmonitor" },
    { eyebrow: "Learning library", title: "Learning & Development", desc: "Core training modules, decision aids, manager tools and governance — with review & approval.", accent: "#9cbf5a", accent2: "#2a3510", Icon: BookOpen, mode: "ldlibrary" },
    { eyebrow: "Species reference", title: "Species Profiles & Survey Requirements", desc: "Threatened flora and fauna reference library, staff field-photo submissions, expert verification, and targeted survey timing standards.", accent: "#5fc9c9", accent2: "#0b3838", Icon: Leaf, mode: "speciesprofiles" },
    { eyebrow: "Portal stewardship", title: "Portal management", desc: "Staff logins & roles, staff development & progress, draft onboarding, resources and platform oversight.", accent: "#e7c979", accent2: "#3a2c0c", Icon: Users2, mode: "portalmgmt" },
    { eyebrow: "Service desk", title: "Service requests", desc: "Approve staff leave, training and equipment requests. Review and action submissions.", accent: "#8fbfdd", accent2: "#16232c", Icon: Send, mode: "servicerequests" },
  ];

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 26, fontFamily: FONT }}>
      {/* Wide hero band */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, minHeight: 196, display: "flex", alignItems: "center", padding: "34px 38px", background: "#0b2016" }}>
        <div style={{ position: "absolute", inset: 0, background: "url('/assets/koala.png') 62% 42%/cover", filter: "grayscale(0.35)", opacity: 0.82 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, #08170f 10%, #1d6b6b 130%)", mixBlendMode: "multiply" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(4,14,9,.9), rgba(4,14,9,.1))" }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, width: "100%", flexWrap: "wrap" }}>
          <div style={{ color: "#f2f6ef", maxWidth: 560 }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: C.gold, marginBottom: 12 }}>Ecology Consulting · Control Centre</div>
            <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 38, lineHeight: 1.08, letterSpacing: "-0.015em", margin: "0 0 10px" }}>Good day, {name}.</h1>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "rgba(242,246,239,0.82)" }}>Choose a management domain to work in. Each opens a focused control centre for that operational area.</p>
          </div>
          <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
            {[["Domains", "6"], ["Portal", "Admin"], ["Status", "Live"]].map(([l, v]) => (
              <div key={l} style={{ color: "#f2f6ef" }}>
                <div style={{ fontFamily: SERIF, fontSize: 28, lineHeight: 1 }}>{v}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(242,246,239,0.6)", marginTop: 5 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section label */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: C.sage }}>Management domains</div>
        <div style={{ height: 1, flex: 1, background: C.hair }} />
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.sage }}>6 areas</div>
      </div>

      {/* 2-column tall tiles — icon badge + accent glow + diagonal pattern,
          so each domain reads distinctly even without a background photo. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 16 }} className="admin-tile-grid">
        {domains.map(({ eyebrow, title, desc, accent, accent2, Icon, soon, mode, href }) => (
          <a
            key={title}
            href="#"
            onClick={(e) => { e.preventDefault(); if (soon) return; if (href) window.location.href = href; else onNavigate(mode); }}
            className="ec-row domain-tile"
            style={{
              position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 210, padding: 24,
              borderRadius: 18, overflow: "hidden", color: "#fff", textDecoration: "none",
              background: `linear-gradient(150deg, #101a17 0%, #0a1210 60%, #060b0a 100%)`,
              border: `1px solid ${accent}33`,
              boxShadow: `0 1px 2px rgba(18,33,26,.07), 0 24px 46px -28px rgba(18,33,26,.65), inset 0 1px 0 rgba(255,255,255,.04)`,
              opacity: soon ? 0.9 : 1, cursor: soon ? "default" : "pointer",
            }}
          >
            {/* diagonal accent stripe pattern — always visible, no image asset needed */}
            <div style={{ position: "absolute", inset: 0, backgroundImage: `repeating-linear-gradient(115deg, ${accent}14 0px, ${accent}14 2px, transparent 2px, transparent 34px)`, pointerEvents: "none" }} />
            {/* radial accent glow, bottom-right */}
            <div style={{ position: "absolute", right: -60, bottom: -60, width: 220, height: 220, borderRadius: "50%", background: `radial-gradient(circle, ${accent}3d 0%, transparent 70%)`, pointerEvents: "none" }} />
            {/* top accent bar */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${accent}, transparent 85%)` }} />

            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: `linear-gradient(135deg, ${accent}, ${accent2})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 8px 18px -6px ${accent}88`,
              }}>
                {Icon && <Icon size={21} color="#08110d" strokeWidth={2.2} />}
              </div>
              <ArrowUpRight size={18} color={`${accent}` } style={{ opacity: 0.55, flexShrink: 0 }} />
            </div>

            <div style={{ position: "relative" }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: accent, marginBottom: 9, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {eyebrow}
                {soon && <span style={{ background: "rgba(255,255,255,0.15)", borderRadius: 5, padding: "1px 7px", letterSpacing: "0.05em", color: "#fff" }}>Soon</span>}
                {counts[mode] > 0 && (
                  <span style={{ background: accent, color: "#0a120f", borderRadius: 999, padding: "2px 10px", fontWeight: 800, letterSpacing: "0.02em" }}>
                    {counts[mode]} pending
                  </span>
                )}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 25, lineHeight: 1.12, marginBottom: 8, color: "#f6faf8" }}>{title}</div>
              <p style={{ margin: 0, fontSize: 12.8, lineHeight: 1.55, color: "rgba(242,248,246,0.72)", maxWidth: "46ch" }}>{desc}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// Staff-portal landing: a domain control centre matching the admin design —
// a welcome hero plus large colour-coded domain cards. The calendar preview
// shows an honest empty state until the Requests/calendar data feature exists;
// per the governing WHS rules we do not fabricate operational records.
function StaffHome({ user, onNavigate, priorityCount = 0 }) {
  const { session } = useAuth();
  const [feedback, setFeedback] = useState({ outcomes: [], unseen: 0 });
  const [showOutcomes, setShowOutcomes] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/staff-feedback", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json()).then((d) => setFeedback({ outcomes: d.outcomes || [], unseen: d.unseen || 0 })).catch(() => {});
  }, [session]);

  const markSeen = async () => {
    setShowOutcomes(true);
    if (feedback.unseen > 0 && session?.access_token) {
      try {
        await fetch("/api/staff-feedback", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: "{}" });
        setFeedback((f) => ({ ...f, unseen: 0 }));
      } catch {}
    }
  };

  const totalPriority = priorityCount + feedback.unseen;
  const firstName = (user?.email || "").split("@")[0].split(".")[0];
  const greetName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : "there";

  // Each domain: its own wildlife photo (duotone), accent base + multiply gradient.
  const domains = [
    { key: "workbook", n: "01", eyebrow: "Getting started", title: "My Onboarding", desc: "Your onboarding checklist, phases and assigned modules.", Icon: ClipboardList, photo: "wattle", base: "#2f5c2f", g1: "#3b7a3d", g2: "#123320" },
    { key: "staffforms", n: "02", eyebrow: "Safety, requests & forms", title: "WHS & EC Forms", desc: "Toolbox talks, incident reports, and leave, training & equipment requests — submitted for approval.", Icon: ShieldCheck, photo: "kookaburra", base: "#8a5b2e", g1: "#c9962a", g2: "#2a1c08" },
    { key: "ldlibrary", n: "03", eyebrow: "People & learning", title: "Learning & Development", desc: "Core training modules, resources, decision aids and quizzes.", Icon: BookOpen, photo: "lorikeet", base: "#7d3b5c", g1: "#9c4a72", g2: "#2a1420" },
    { key: "species", n: "04", eyebrow: "Species reference", title: "Species Profiles & Survey Requirements", desc: "Search the threatened flora and fauna library, compare licensed reference photos, attach a field photo for expert verification, and check targeted survey timing standards.", Icon: BookOpen, photo: "wattle", base: "#1e5b36", g1: "#2f8f8f", g2: "#0b2317" },
    { key: "projects", n: "05", eyebrow: "Delivery & commercial", title: "Projects & Timesheets", desc: "Your allocations, schedule, work status and budget.", Icon: FileText, photo: "kangaroo", base: "#1d6b6b", g1: "#238383", g2: "#0c2b2b", href: "/staff/projects" },
    { key: "remote", n: "06", eyebrow: "International delivery", title: "Remote Operations", desc: "Remote-work profiles, client records, quotes and issues.", Icon: Users2, photo: "bottlebrush", base: "#a34a32", g1: "#c05a3e", g2: "#2a1109", href: "/staff/remote-operations" },
  ];

  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const now = new Date();
  const monthLabel = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22, fontFamily: FONT }}>
      {/* Photographic hero band */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, minHeight: 186, display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 36px", background: C.forest }}>
        <div style={{ position: "absolute", inset: 0, background: "url('/assets/everlastings.png') center 55%/cover", filter: "grayscale(0.35)", opacity: 0.82 }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(105deg, ${C.forestDeep} 12%, #1e5b36 92%)`, mixBlendMode: "multiply" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(6,18,12,.86), rgba(6,18,12,.12))" }} />
        <div style={{ position: "relative", color: "#f2f6ef", maxWidth: 560 }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: C.gold, marginBottom: 12 }}>Ecology Consulting · Staff portal</div>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, lineHeight: 1.08, letterSpacing: "-0.012em", margin: "0 0 10px" }}>Good day, {greetName}.</h1>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "rgba(242,246,239,0.82)" }}>Choose an area to work in. Your notices and calendar are on the right.</p>
          {totalPriority > 0 && (
            <button onClick={markSeen} style={{ marginTop: 15, display: "inline-flex", alignItems: "center", gap: 8, background: C.gold, color: C.forestDeep, borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, fontFamily: MONO, letterSpacing: "0.04em", border: "none", cursor: "pointer" }}>
              {feedback.unseen > 0 ? `${feedback.unseen} new outcome${feedback.unseen === 1 ? "" : "s"}` : `${totalPriority} item${totalPriority === 1 ? "" : "s"}`} — view
            </button>
          )}
        </div>
      </div>

      {showOutcomes && feedback.outcomes.length > 0 && (
        <div style={{ background: C.paperCard, border: `1px solid ${C.hair}`, borderRadius: 15, padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 18, fontWeight: 400, color: C.inkDeep }}>Recent outcomes</h2>
            <button onClick={() => setShowOutcomes(false)} style={{ background: "none", border: "none", color: C.sage, cursor: "pointer", fontFamily: MONO, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>Hide</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {feedback.outcomes.slice(0, 8).map((o) => {
              const good = o.status === "approved" || o.status === "reviewed";
              const actioned = o.status === "actioned";
              const col = actioned ? C.gold : good ? C.eucalypt : C.rustAccent;
              const label = { approved: "Approved", declined: "Declined", reviewed: "Reviewed", actioned: "Action required" }[o.status] || o.status;
              return (
                <div key={o.kind + o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: `1px solid ${C.hairSoft}`, borderRadius: 10, borderLeft: `3px solid ${col}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{o.title}</div>
                    {o.note && <div style={{ fontSize: 12, color: C.sageText, marginTop: 3 }}>Note: {o.note}</div>}
                    <div style={{ fontSize: 11, color: C.sage, marginTop: 3 }}>{o.at ? new Date(o.at).toLocaleDateString("en-AU") : ""}</div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: col, background: `${col}14`, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{label}</span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: C.sage, fontStyle: "italic" }}>Full detail is in your submission history within the WHS &amp; EC Forms area.</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 330px", gap: 26, alignItems: "start" }} className="staff-home-grid">
        {/* Domains — left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: C.sage }}>Your work areas</div>
            <div style={{ height: 1, flex: 1, background: C.hair }} />
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.sage }}>{domains.length} areas</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 16 }} className="staff-domain-grid">
            {domains.map(({ key, n, eyebrow, title, desc, Icon, photo, base, g1, g2, href }) => (
              <a
                key={key}
                href="#"
                onClick={(e) => { e.preventDefault(); if (href) window.location.href = href; else onNavigate(key); }}
                className="ec-row"
                style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: 214, padding: 22, borderRadius: 16, overflow: "hidden", color: "#fff", background: base, textDecoration: "none", boxShadow: "0 1px 2px rgba(18,33,26,.07), 0 22px 44px -30px rgba(18,33,26,.55)" }}
              >
                <div style={{ position: "absolute", inset: 0, background: `url('/assets/${photo}.png') center/cover`, filter: "grayscale(0.35)", opacity: 0.82 }} />
                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(150deg, ${g1}, ${g2} 82%)`, mixBlendMode: "multiply" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(6,18,12,.88), rgba(6,18,12,.05) 68%)" }} />
                <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.24)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={17} /></div>
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(233,201,121,0.95)", marginBottom: 8 }}>{eyebrow}</div>
                    <div style={{ fontFamily: SERIF, fontSize: 25, lineHeight: 1.12, marginBottom: 7 }}>{title}</div>
                    <p style={{ margin: 0, fontSize: 12.8, lineHeight: 1.5, color: "rgba(255,255,255,0.8)" }}>{desc}</p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Noticeboard + calendar — right */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: C.paperCard, border: `1px solid ${C.hair}`, borderRadius: 15, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 18, fontWeight: 400, color: C.inkDeep }}>Staff noticeboard</h2>
              <a href="/staff/noticeboard" style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, color: C.teal, textDecoration: "none" }}>Open →</a>
            </div>
            <div style={{ padding: "18px 14px", textAlign: "center", color: C.sage, fontSize: 12.5, lineHeight: 1.5, background: C.paper, borderRadius: 10 }}>
              Draft a notice, get it approved, and publish it to the team. Open the noticeboard to post or read notices.
            </div>
          </div>

          <div style={{ background: C.paperCard, border: `1px solid ${C.hair}`, borderRadius: 15, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 18, fontWeight: 400, color: C.inkDeep }}>{monthLabel}</h2>
              <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 500, color: C.sage, textTransform: "uppercase", letterSpacing: "0.08em" }}>Read-only</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, fontSize: 11 }}>
              {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontFamily: MONO, fontWeight: 500, color: C.sage, padding: "2px 0" }}>{d}</div>)}
              {cells.map((d, i) => (
                <div key={i} style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontWeight: 600, color: d ? C.sageText : "transparent", background: d === now.getDate() ? C.gold : "transparent" }}>
                  {d || ""}
                </div>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: C.sage, fontStyle: "italic", lineHeight: 1.4 }}>
              Approved leave, training and review assignments will show here once the Requests area is enabled.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Staff-portal hub linking the WHS field forms. Each opens its own dedicated
// page (they are full standalone workspaces, not embeddable panels).
function WhsFormsHub() {
  const forms = [
    { href: "/staff/toolbox-talks", title: "Toolbox Talk Record", desc: "Record a field toolbox talk, attendance and any corrective actions.", color: "#3d7a35" },
    { href: "/staff/incident-reports", title: "Incident Report", desc: "Report an incident or near miss. Notifiable incidents must be reported to SafeWork NSW immediately.", color: "#c0392b" },
    { href: "/staff/whs-drafts", title: "WHS Draft Studio", desc: "Draft a numbered SWMS or psychosocial risk assessment. Each draft requires competent review before use.", color: "#4197D0" },
  ];
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 900, color: C.green800, fontFamily: FONT }}>WHS Forms</h1>
      <p style={{ margin: "0 0 22px", fontSize: 14, fontWeight: 600, color: C.inkSoft, lineHeight: 1.55 }}>
        Field WHS records and controlled working drafts. All AI-assisted or drafted WHS content is a draft requiring competent human review before approved use.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {forms.map((form) => (
          <a key={form.href} href={form.href} style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none", background: C.cardBg, border: `1px solid ${C.line}`, borderLeft: `4px solid ${form.color}`, borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink }}>{form.title}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, marginTop: 3, lineHeight: 1.45 }}>{form.desc}</div>
            </div>
            <ChevronRight size={18} color={C.inkFaint} style={{ flexShrink: 0 }} />
          </a>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingWorkbook() {
  const { user, isAdmin: hasAdminRights, portal, setPortal, signOut } = useAuth();
  // The whole workbook keys off "isAdmin" for what to show/allow. Being in the
  // staff portal means seeing the staff experience even if you hold admin
  // rights, so the effective admin flag is role AND portal — not role alone.
  const inAdminPortal = hasAdminRights && portal === "admin";
  const isAdmin = inAdminPortal;
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [mode, setMode] = useState(() => (inAdminPortal ? "home" : "staffhome")); // admin: "home" | staff: "staffhome" | "workbook" | "mine" | "library" | "whs" | ...
  // Admin status and portal both resolve asynchronously after first render, so
  // the initial mode above can be wrong (it defaults to "staffhome" before we
  // know the person is an admin in the admin portal). Whenever that resolution
  // changes, if the person is sitting on EITHER default landing, put them on the
  // correct one. This is robust to multi-step async (portal null->admin, admin
  // false->true in any order) because it re-checks on every change rather than
  // relying on a one-shot ref guard.
  useEffect(() => {
    setMode((current) => {
      if (current !== "home" && current !== "staffhome") return current; // they navigated somewhere — leave them
      return inAdminPortal ? "home" : "staffhome";
    });
  }, [inAdminPortal]);
  const [libraryTopic, setLibraryTopic] = useState(null);
  const goToLibraryTopic = useCallback((topic) => { setLibraryTopic(topic); setMode("library"); }, []);
  useEffect(() => {
    const handler = () => setMode("remoteops");
    const quoteHandler = () => setMode("quotepipeline");
    if (typeof window !== "undefined") {
      window.addEventListener("ec-goto-remoteops", handler);
      window.addEventListener("ec-goto-quotepipeline", quoteHandler);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("ec-goto-remoteops", handler);
        window.removeEventListener("ec-goto-quotepipeline", quoteHandler);
      }
    };
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Projects & operations now hosts the health report as a sub-tab rather
  // than "Reporting & analytics" being its own top-level admin domain.
  const [projectsSubview, setProjectsSubview] = useState("setup"); // "setup" | "health"

  // Backward compatibility for any pre-update link/state. Project health remains
  // a subview of Projects & Operations rather than a standalone admin domain.
  useEffect(() => {
    if (inAdminPortal && mode === "healthreport") {
      setProjectsSubview("health");
      setMode("adminprojects");
    }
  }, [inAdminPortal, mode]);

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
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..500&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
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

      {/* Header */}
      <header style={{ position: "relative", overflow: "hidden", background: C.forest, color: "#f2f6ef" }}>
        <div style={{ position: "absolute", inset: 0, background: "url('/assets/rosella.png') center 38%/cover", filter: "grayscale(0.4)", opacity: 0.34 }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, ${C.forestDeep} 0%, #1c5231 55%, #3d7a45 100%)`, mixBlendMode: "multiply" }} />
        <div style={{ position: "relative", maxWidth: 1240, margin: "0 auto", padding: "24px 32px 22px", display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <div style={{ background: "#fff", borderRadius: 9, padding: "8px 11px", display: "flex", alignItems: "center" }}>
            <img src="/logo.png" alt="Ecology Consulting" style={{ height: 28, width: "auto", display: "block" }} />
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 400, lineHeight: 1.15 }}>Welcome, {displayNameFromEmail(user?.email)}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(242,246,239,0.62)", marginTop: 5 }}>
              {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {inAdminPortal ? "Admin portal" : "Staff portal"}
            </div>
          </div>
          <div data-print="hide" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {hasAdminRights && (
              <button
                onClick={() => setPortal(inAdminPortal ? "staff" : "admin")}
                className="ec-hdr-btn"
                style={inAdminPortal ? ecHdrBtn : ecHdrBtnGold}
                title={inAdminPortal ? "Switch to your staff portal" : "Switch to the admin portal"}
              >
                {inAdminPortal ? <><Users2 size={13} /> Staff portal</> : <><ShieldCheck size={13} /> Admin portal</>}
              </button>
            )}
            <SaveStatus />
            <button onClick={() => setSettingsOpen(true)} className="ec-hdr-btn" style={ecHdrBtn}><Settings size={13} /> Settings</button>
            <button onClick={() => window.print()} className="ec-hdr-btn" style={ecHdrBtn}><FileText size={13} /> Save as PDF</button>
            <button onClick={() => { if (window.confirm("Log out of the portal?")) signOut(); }} className="ec-hdr-btn" style={ecHdrBtnGhost}>
              <LogOut size={13} /> Log out
            </button>
          </div>
        </div>
      </header>

      {/* Sticky phase nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: `${C.paperAlt}f2`, backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.hair}`, padding: "13px 32px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
          {[
            { key: "staffhome", label: "Home", desc: "Your staff portal home", Icon: HomeIcon, staffOnly: true },
            { key: "home", label: "Home", desc: "Your starting point", Icon: HomeIcon, adminOnly: true },
            { key: "portalmgmt", label: "Portal Management", desc: "Staff, progress & onboarding", Icon: Users2, adminOnly: true },
            { key: "mine", label: "My Onboarding", desc: "Your personally assigned modules", Icon: ClipboardList, staffOnly: true },
            { key: "staffforms", label: "WHS & EC Forms", desc: "WHS forms, leave, training & equipment", Icon: ShieldCheck, staffOnly: true },
            { key: "ldlibrary", label: "Learning & Development", desc: "Modules, resources & quizzes", Icon: BookOpen, staffOnly: true },
            { key: "species", label: "Species Profiles & Survey Requirements", desc: "Flora, fauna & survey timing standards", Icon: BookOpen, staffOnly: true },
          ].filter((item) => {
            if (item.staffOnly) return !inAdminPortal;
            if (item.adminOnly) return inAdminPortal;
            return true;
          }).map(({ key, label, desc, Icon }) => {
            const active = mode === key;
            return (
              <button key={key} onClick={() => { setMode(key); if (key === "library") setLibraryTopic(null); }} className="ec-nav-tab" style={{
                cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start",
                padding: "9px 15px", borderRadius: 10, fontFamily: FONT, textAlign: "left", minWidth: 150,
                border: `1px solid ${active ? "transparent" : C.hairSoft}`,
                background: active ? C.paperCard : "rgba(255,253,248,0.55)",
                boxShadow: active ? `inset 3px 0 0 ${C.eucalypt}` : "none",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: active ? C.inkDeep : C.sageText }}>
                  <Icon size={14} /> {label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 400, color: C.sage, lineHeight: 1.3 }}>{desc}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <div className="wb-layout" style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px 80px", display: "flex", gap: 32, alignItems: "flex-start", background: C.paper }}>
        {mode === "workbook" && <WorkbookSidebar navItems={navItems} />}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 56 }}>
          {mode === "staffhome" && !inAdminPortal ? (
            <StaffHome user={user} onNavigate={setMode} />
          ) : mode === "library" ? (
            <ResourceLibrary key={libraryTopic || "root"} isAdmin={isAdmin} onToast={showToast} initialTopic={libraryTopic} />
          ) : mode === "whs" ? (
            <WhsFormsHub />
          ) : mode === "mine" ? (
            <MyOnboarding onToast={showToast} />
          ) : isAdmin && mode === "portalmgmt" ? (
            <PortalManagement>
              <StaffLoginsPanel onToast={showToast} />
              <AdminPanel adminEmails={data.adminEmails} currentEmail={user?.email} onMutate={mutate} onToast={showToast} />
              <StaffProgress onToast={showToast} />
              <DraftOnboarding onToast={showToast} currentEmail={user?.email} />
            </PortalManagement>
          ) : isAdmin && mode === "draft" ? (
            <DraftOnboarding onToast={showToast} currentEmail={user?.email} />
          ) : isAdmin && mode === "adminprojects" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className="admin-subtabs" data-print="hide">
                <button
                  className={"admin-subtab" + (projectsSubview === "setup" ? " sel" : "")}
                  onClick={() => setProjectsSubview("setup")}
                >
                  Setup &amp; allocations
                </button>
                <button
                  className={"admin-subtab" + (projectsSubview === "health" ? " sel" : "")}
                  onClick={() => setProjectsSubview("health")}
                >
                  <TrendingUp size={13} /> Health report
                </button>
              </div>
              {projectsSubview === "setup" ? <AdminProjectSetup /> : <ProjectHealthReport />}
            </div>
          ) : isAdmin && mode === "remoteops" ? (
            <AdminRemoteOps />
          ) : isAdmin && mode === "quotepipeline" ? (
            <AdminQuotePipeline />
          ) : isAdmin && mode === "whsmonitor" ? (
            <AdminWhsMonitor />
          ) : isAdmin && mode === "servicerequests" ? (
            <AdminServiceRequests />
          ) : isAdmin && mode === "ldlibrary" ? (
            <AdminLearningLibrary />
          ) : isAdmin && mode === "speciesprofiles" ? (
            <AdminSpeciesProfiles onToast={showToast} />
          ) : mode === "ldlibrary" && !inAdminPortal ? (
            <StaffLearningLibrary />
          ) : mode === "species" && !inAdminPortal ? (
            <SpeciesProfiles onToast={showToast} />
          ) : mode === "staffforms" && !inAdminPortal ? (
            <StaffForms />
          ) : isAdmin && (mode === "staff" || mode === "portalmgmt") ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <StaffLoginsPanel onToast={showToast} />
              <AdminPanel adminEmails={data.adminEmails} currentEmail={user?.email} onMutate={mutate} onToast={showToast} />
              <StaffProgress onToast={showToast} />
              <DraftOnboarding onToast={showToast} currentEmail={user?.email} />
            </div>
          ) : inAdminPortal ? (
            <AdminHome user={user} onNavigate={setMode} />
          ) : (
            <>
              {data.phases.map((phase, i) => (
                <PhaseBlock key={phase.id} phase={phase} num={String(i + 1).padStart(2, "0")} isAdmin={isAdmin} onMutate={mutate} onToast={showToast} />
              ))}
              <LDPhase ldMonths={data.ldMonths} num={String(data.phases.length + 1).padStart(2, "0")} isAdmin={isAdmin} onMutate={mutate} onToast={showToast} onGoToLibraryTopic={goToLibraryTopic} />
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

const ecHdrBtn = {
  display: "flex", alignItems: "center", gap: 7, fontFamily: FONT, fontSize: 12.5, fontWeight: 500,
  padding: "9px 13px", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 8,
  background: "rgba(255,255,255,0.08)", color: "#eaf1e8", cursor: "pointer",
};
const ecHdrBtnGold = {
  display: "flex", alignItems: "center", gap: 7, fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
  padding: "9px 14px", border: "1px solid rgba(233,201,121,0.5)", borderRadius: 8,
  background: "rgba(233,201,121,0.16)", color: "#f0dca8", cursor: "pointer",
};
const ecHdrBtnGhost = {
  display: "flex", alignItems: "center", gap: 7, fontFamily: FONT, fontSize: 12.5, fontWeight: 500,
  padding: "9px 13px", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 8,
  background: "transparent", color: "rgba(234,241,232,0.8)", cursor: "pointer",
};
