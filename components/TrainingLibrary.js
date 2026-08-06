"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, X, Pencil, Upload, FileText, Loader2 } from "lucide-react";
import * as db from "../lib/data";
import { supabase } from "../lib/supabaseClient";

export const C = {
  bg: "#f4f4ee", ink: "#23301f", inkSoft: "#6b755f", inkFaint: "#8a927c",
  line: "#e3e6d8", lineSoft: "#edf0e3", lineFaint: "#f0f2e6",
  green900: "#16371f", green800: "#1e4d2b", green700: "#24522a", green600: "#2c4426",
  green500: "#35692f", green400: "#3d7a35", green300: "#5b8f45", green200: "#6ea24f",
  greenTint: "#e6efd8", greenTintSoft: "#eef3e4", cream: "#cfe3b8",
  amber: "#b08948", amberLight: "#c9a25e", amberBg: "#fbf6ea", amberText: "#7a6233",
  rust: "#c05a4a", cardBg: "#ffffff",
};
export const FONT = "'Nunito Sans', 'Helvetica Neue', sans-serif";

// The 8 fixed capability-framework categories (structural, from the
// company's own framework — not something a level's content lives under
// changes, so kept as a constant rather than per-row data).
const HEADERS = [
  "Ecologist Specific", "Written Communication", "Oral Communication", "Teamwork",
  "Leadership & Judgement", "Conceptual & Analytical", "Results Oriented", "Health & Safety",
];

// Official Ecology Consulting brand colours, one per level, so they're
// genuinely distinct rather than shades of the same green.
export const LEVEL_COLORS = { "Early career": "#4197D0", "Experienced": "#3B7438", "Senior": "#A87C4F", "Director": "#44546A" };
export const LEVEL_INFORMAL = { "Early career": "Basic", "Experienced": "Intermediate", "Senior": "Middle Level / Advanced", "Director": "Senior / Principal" };

const VALUES = [
  { name: "Respect", desc: "Value each other, clients, honesty, and diverse opinions", color: "#8FBF7F" },
  { name: "Teamwork", desc: "Trust, stronger together, open to new ideas", color: "#B08752" },
  { name: "Communication", desc: "Clarity, active listening, constructive dialogue", color: "#8FC1E3" },
  { name: "Well-being", desc: "Prioritise safety and work-life balance", color: "#3E7A3E" },
  { name: "Recognition", desc: "Celebrate excellence and achievements", color: "#D9C0A0" },
  { name: "Empowerment", desc: "Unlock potential and supporting others", color: "#3E93C9" },
  { name: "Leadership", desc: "Motivates, take responsibility for issues, invites feedback", color: "#D9BB93" },
];

const REPORTS = [
  ["Straightforward", "Intermediate", "Complex"],
  ["Preliminary site assessments", "Flora & fauna assessments", "BDAR"],
  ["Clearing surveys", "Review of Environmental Effects", "BSAR"],
  ["Education guides", "Management Plans", "BCAR"],
  [null, "Information briefing", "Client advice"],
];

export const inputStyle = {
  border: `1px solid #e6e8da`, background: "#fafbf4", borderRadius: 8, padding: "7px 9px",
  fontSize: 13, fontWeight: 600, color: C.ink, width: "100%", outline: "none", fontFamily: FONT, boxSizing: "border-box",
};
export const addSmallBtn = {
  display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
  color: C.green400, fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0, fontFamily: FONT,
};

function splitCapabilityText(raw) {
  if (!raw) return [];
  return raw.split("\n").map((l) => l.replace(/^\u00b7\s*/, "").trim()).filter((l) => l.length > 0);
}

function SectionHeading({ children }) {
  return (
    <h2 style={{ margin: "0 0 12px", fontSize: 21, fontWeight: 900, color: C.green700, fontFamily: FONT, borderBottom: `2px solid ${C.greenTint}`, paddingBottom: 8 }}>
      {children}
    </h2>
  );
}

function ValuesGrid() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {VALUES.map((v) => (
        <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 12, background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px" }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: v.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 900, fontSize: 13.5, color: C.ink, width: 130, flexShrink: 0 }}>{v.name}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft }}>{v.desc}</span>
        </div>
      ))}
    </div>
  );
}

function RatingsTable() {
  const rows = [
    ["1", "Exceeds the standard for this criterion, performing at a higher level of classification"],
    ["2+", "Meets the standard to a high degree, but not yet to the standard required for the next highest level"],
    ["2", "Meets the standard for this criterion at their current classification level, performing fully"],
    ["3", "Still developing their capability at this level of classification"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(([r, text]) => (
        <div key={r} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 14px" }}>
          <span style={{ fontWeight: 900, fontSize: 14, color: C.green600, width: 26, flexShrink: 0 }}>{r}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft }}>{text}</span>
        </div>
      ))}
    </div>
  );
}

function ReportsTable() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      {REPORTS[0].map((tier, i) => (
        <div key={tier} style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ background: i === 2 ? C.amberBg : C.greenTintSoft, padding: "8px 12px", fontWeight: 900, fontSize: 13, color: i === 2 ? C.amberText : C.green700, borderBottom: `1px solid ${C.line}` }}>{tier}</div>
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {REPORTS.slice(1).map((row) => row[i]).filter(Boolean).map((item, idx) => (
              <div key={idx} style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{item}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------
   Capability text — read-only bullets, or a raw editable textarea
   for admins (kept in the same "line per point, blank line between
   ideas" format the data is actually stored in).
----------------------------------------------------------------- */

function CapabilityBlock({ name, rawText, color, editable, onChange }) {
  const [editing, setEditing] = useState(false);
  const points = splitCapabilityText(rawText);

  if (editable && editing) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 13.5, color, marginBottom: 6 }}>{name}</div>
        <textarea
          autoFocus defaultValue={rawText || ""} rows={5}
          onBlur={(e) => { onChange(e.target.value); setEditing(false); }}
          placeholder="One idea per line; leave a blank line between separate points"
          style={{ ...inputStyle, resize: "vertical", fontFamily: FONT }}
        />
      </div>
    );
  }

  if (!points.length && !editable) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        onClick={() => editable && setEditing(true)}
        style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 900, fontSize: 13.5, color, marginBottom: 6, cursor: editable ? "pointer" : "default" }}
      >
        {name} {editable && <Pencil size={11} style={{ opacity: 0.4 }} />}
      </div>
      {points.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {points.map((p, i) => <li key={i} style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft }}>{p}</li>)}
        </ul>
      ) : (
        <span style={{ fontSize: 12.5, color: C.inkFaint, fontStyle: "italic" }}>Click to add content</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   External pathway — editable bullet list
----------------------------------------------------------------- */

function PathwayList({ items, editable, onChange }) {
  if (!editable) {
    return (
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
        {items.map((item, i) => <li key={i} style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft }}>{item}</li>)}
      </ul>
    );
  }
  const update = (i, val) => { const next = [...items]; next[i] = val; onChange(next); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ color: C.green400, fontWeight: 900, paddingTop: 6 }}>•</span>
          <textarea value={item} onChange={(e) => update(i, e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical", flex: 1 }} />
          <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer", paddingTop: 6 }}><X size={13} /></button>
        </div>
      ))}
      <button onClick={add} style={addSmallBtn}><Plus size={12} /> Add resource</button>
    </div>
  );
}

/* ---------------------------------------------------------------
   Module guide card — editable name / objective / outline / resources
----------------------------------------------------------------- */

function EditableStringList({ items, onChange, placeholder }) {
  const update = (i, val) => { const next = [...items]; next[i] = val; onChange(next); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input value={item} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
          <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer" }}><X size={12} /></button>
        </div>
      ))}
      <button onClick={add} style={addSmallBtn}><Plus size={11} /> Add</button>
    </div>
  );
}

// A resource entry is either a plain string (legacy / free-text description)
// or { label, url } for an actual attached file. Both render fine read-only;
// only the object form is a real clickable link.
function ResourceItem({ item }) {
  if (typeof item === "object" && item?.url) {
    return <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.green600, fontWeight: 700 }}>{item.label || item.url}</a>;
  }
  return <span>{typeof item === "object" ? item.label : item}</span>;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

export function ResourceList({ items, onChange, addLabel }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const update = (i, val) => { const next = [...items]; next[i] = val; onChange(next); };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const addText = () => onChange([...items, ""]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { setUploadError("File is over 20MB — link to it externally instead."); return; }
    setUploading(true);
    setUploadError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || "unknown";
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("training-materials").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("training-materials").getPublicUrl(path);
      onChange([...items, { label: file.name, url: pub.publicUrl }]);
    } catch (err) {
      setUploadError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map((item, i) => {
        const isFile = typeof item === "object" && item?.url;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isFile ? (
              <div style={{ ...inputStyle, flex: 1, display: "flex", alignItems: "center", gap: 6, background: C.greenTintSoft }}>
                <FileText size={13} color={C.green600} style={{ flexShrink: 0 }} />
                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.green600, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</a>
              </div>
            ) : (
              <input value={item} onChange={(e) => update(i, e.target.value)} placeholder="Resource description or link" style={{ ...inputStyle, flex: 1 }} />
            )}
            <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer", flexShrink: 0 }}><X size={12} /></button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 2 }}>
        <button onClick={addText} style={addSmallBtn}><Plus size={11} /> {addLabel || "Add text resource"}</button>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ ...addSmallBtn, opacity: uploading ? 0.6 : 1 }}>
          {uploading ? <Loader2 size={11} className="tl-spin" /> : <Upload size={11} />} {uploading ? "Uploading…" : "Upload a file"}
        </button>
        <input ref={fileInputRef} type="file" onChange={handleFile} style={{ display: "none" }} />
      </div>
      {uploadError && <div style={{ fontSize: 11.5, fontWeight: 700, color: C.rust }}>{uploadError}</div>}
    </div>
  );
}

function ModuleGuideCard({ m, color, editable, onChange, onRemove }) {
  if (!editable) {
    return (
      <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 14, color, marginBottom: 6 }}>{m.name}</div>
        <div style={{ fontSize: 12.5, fontStyle: "italic", fontWeight: 600, color: C.inkSoft, marginBottom: 8 }}>{m.objective}</div>
        <ul style={{ margin: "0 0 8px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
          {m.outline.map((o, i) => <li key={i} style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{o}</li>)}
        </ul>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.green600, display: "flex", flexWrap: "wrap", gap: "4px 6px", alignItems: "center" }}>
          Resources:
          {m.resources.map((r, i) => (
            <span key={i} style={{ fontWeight: 600, color: C.inkSoft }}>
              <ResourceItem item={r} />{i < m.resources.length - 1 ? ";" : ""}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const set = (patch) => onChange({ ...m, ...patch });
  return (
    <div style={{ background: C.cardBg, border: `2px dashed ${C.line}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input value={m.name} onChange={(e) => set({ name: e.target.value })} placeholder="Module name"
          style={{ ...inputStyle, flex: 1, fontWeight: 800, color }} />
        <button onClick={onRemove} title="Remove this module guide" style={{ background: "none", border: "none", color: C.rust, cursor: "pointer" }}><X size={16} /></button>
      </div>
      <textarea value={m.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="Objective" rows={2}
        style={{ ...inputStyle, resize: "vertical", fontStyle: "italic" }} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Outline</div>
        <EditableStringList items={m.outline} onChange={(v) => set({ outline: v })} placeholder="Content point" />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Resources</div>
        <ResourceList items={m.resources} onChange={(v) => set({ resources: v })} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   One career level
----------------------------------------------------------------- */

function LevelSection({ levelObj, defaultOpen, isAdmin, onSave, onToast }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [local, setLocal] = useState(levelObj);
  useEffect(() => setLocal(levelObj), [levelObj]);
  const name = local.level;
  const color = LEVEL_COLORS[name] || C.green600;

  const save = (patch) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onSave(name, patch).catch(() => onToast("Couldn't save — try again"));
  };

  const addModuleGuide = () => {
    save({ moduleGuides: [...local.moduleGuides, { name: "New module", objective: "", outline: [], resources: [] }] });
  };
  const updateModuleGuide = (i, next) => {
    const list = [...local.moduleGuides];
    list[i] = next;
    save({ moduleGuides: list });
  };
  const removeModuleGuide = (i) => {
    if (!window.confirm("Remove this module guide?")) return;
    save({ moduleGuides: local.moduleGuides.filter((_, idx) => idx !== i) });
  };

  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 10px rgba(35,48,31,0.05)" }}>
      <div onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", cursor: "pointer",
        background: `linear-gradient(100deg, ${color}18, #f8f9f1 70%)`, borderBottom: open ? `1px solid ${C.line}` : "none",
      }}>
        <div style={{ width: 8, height: 32, borderRadius: 99, background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.ink, fontFamily: FONT }}>{name}</h3>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginTop: 2 }}>Informally: {LEVEL_INFORMAL[name] || "—"}</div>
        </div>
        {isAdmin && (
          <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", color: "#fff", background: color, borderRadius: 20, padding: "3px 10px" }}>
            Editable
          </span>
        )}
        {open ? <ChevronDown size={18} color={C.inkSoft} /> : <ChevronRight size={18} color={C.inkSoft} />}
      </div>
      {open && (
        <div style={{ padding: "18px 22px 22px" }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color, marginBottom: 10 }}>Capability Framework</div>
          {HEADERS.map((h) => (
            <CapabilityBlock
              key={h} name={h} rawText={local.capabilities[h]} color={color} editable={isAdmin}
              onChange={(text) => save({ capabilities: { ...local.capabilities, [h]: text } })}
            />
          ))}

          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color, margin: "18px 0 10px" }}>External Credential Pathway</div>
          <PathwayList items={local.externalPathway} editable={isAdmin} onChange={(v) => save({ externalPathway: v })} />

          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color, margin: "18px 0 10px" }}>Internal L&amp;D Module Guides</div>
          {local.moduleGuides.map((m, i) => (
            <ModuleGuideCard
              key={i} m={m} color={color} editable={isAdmin}
              onChange={(next) => updateModuleGuide(i, next)}
              onRemove={() => removeModuleGuide(i)}
            />
          ))}
          {isAdmin && (
            <button onClick={addModuleGuide} style={{ ...addSmallBtn, marginTop: 4 }}>
              <Plus size={12} /> Add module guide
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Top level
----------------------------------------------------------------- */

export default function TrainingLibrary({ isAdmin, onToast }) {
  const [levels, setLevels] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await db.fetchTrainingLibrary();
      setLevels(data);
    } catch (e) {
      console.error("TrainingLibrary load failed:", e);
      const msg = e?.message || "Couldn't load the Training Library";
      setError(msg);
      onToast && onToast(msg);
    }
    setLoaded(true);
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const saveLevel = (level, patch) => db.updateTrainingLibraryLevel(level, patch);

  if (!loaded) {
    return <div style={{ textAlign: "center", padding: 40, color: C.inkSoft, fontFamily: FONT, fontWeight: 700 }}>Loading the Training Library…</div>;
  }

  if (error || !levels) {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 14, padding: "28px 24px" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.rust, marginBottom: 8, fontFamily: FONT }}>Couldn't load the Training Library</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, marginBottom: 18, lineHeight: 1.5 }}>
          {error || "No content came back from the database."}
        </div>
        <button onClick={load} style={{
          background: C.green400, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px",
          fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
        }}>
          Try again
        </button>
      </div>
    );
  }

  if (levels.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", textAlign: "center", background: C.cardBg, border: `1px dashed ${C.line}`, borderRadius: 14, padding: "28px 24px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.inkSoft }}>No Training Library content yet.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 900, margin: "0 auto" }}>
      <style>{`
        @keyframes tl-spin { to { transform: rotate(360deg); } }
        .tl-spin { animation: tl-spin 0.8s linear infinite; }
      `}</style>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: C.green800, fontFamily: FONT }}>Ecologist Training &amp; Development Library</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600, color: C.inkSoft, lineHeight: 1.5 }}>
          Built on Ecology Consulting's own capability framework and values, with external credential pathways (EIANZ, BAM, NSW/ACT/Commonwealth) layered on for anyone working toward outside recognition.
          {isAdmin && " As an admin, you can edit anything below directly — click any capability text, resource, or module guide."}
        </p>
      </div>

      <section>
        <SectionHeading>Our Values &amp; Culture</SectionHeading>
        <p style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          These values sit underneath every level of the capability framework below. Leadership &amp; Judgement and Teamwork, for example, are where Respect, Teamwork, and Leadership actually show up as assessed capabilities.
        </p>
        <ValuesGrid />
      </section>

      <section>
        <SectionHeading>Assessment &amp; Performance Ratings</SectionHeading>
        <p style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, marginTop: 0, marginBottom: 12 }}>How each capability criterion is scored during a performance review:</p>
        <RatingsTable />
      </section>

      <section>
        <SectionHeading>Report Complexity &amp; Deliverable Ownership</SectionHeading>
        <p style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, marginTop: 0, marginBottom: 12 }}>
          Client advice sits in the Complex tier alongside BDAR, BSAR and BCAR, it carries the same weight as a full assessment report, not less.
        </p>
        <ReportsTable />
      </section>

      <section>
        <SectionHeading>Career Levels</SectionHeading>
        <p style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, marginTop: 0, marginBottom: 16 }}>
          Click a level to see its full capability framework text, external credential pathway, and module guides.
          {isAdmin ? " Everything here is live-edited and saved as you go." : " Ready to draft training from."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {levels.map((lvl, i) => (
            <LevelSection
              key={lvl.level} levelObj={lvl} defaultOpen={i === 0} isAdmin={isAdmin}
              onSave={saveLevel} onToast={onToast || (() => {})}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
