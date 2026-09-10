"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import SignaturePad from "./SignaturePad";

/* ---------------------------------------------------------------
   Draft autosave — same device-local mechanism StaffForms already
   uses for every other WHS form, duplicated here (not imported) so
   this component has no private dependency on StaffForms internals.
----------------------------------------------------------------- */
const DRAFT_KEY = "ecology-consulting:whs-form:daily_risk_assessment";
const DRAFT_TTL = 1000 * 60 * 60 * 24 * 14;

function readDraft() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || Date.now() - Number(saved.savedAt || 0) > DRAFT_TTL) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return saved.form && typeof saved.form === "object" ? saved.form : null;
  } catch {
    return null;
  }
}
function writeDraft(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), form: value }));
  } catch {
    // Private browsing or storage-full — the in-memory form still works.
  }
}
function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

/* ---------------------------------------------------------------
   Fixed checklist definitions — verbatim from the controlled
   EC-WHS-DRA-001 Rev 2 template.
----------------------------------------------------------------- */
const TOOLBOX_CHECKLIST = [
  "The Field Lead has discussed the field plan with all members of the field team.",
  "The Field Lead has completed a site risk assessment in collaboration with all team members.",
  "All team members have performed a PPE and equipment check.",
  "The Field Lead has discussed the field emergency response plan and a designated emergency meeting point has been identified.",
  "The Field Lead has been informed of any team members with at-risk medical or health conditions, and those members have explained what support they may need.",
  "The Field Lead has discussed site-specific access locations, including restricted access areas and NO GO zones.",
  "The Field Lead has allocated a team member to perform the daily check-ins.",
];

const HRCW_CHECKLIST = [
  "A risk of a person falling more than two metres (three metres in some jurisdictions).",
  "Work on a telecommunication tower.",
  "Demolition of a load-bearing element, or one related to structural integrity.",
  "Disturbance of asbestos, or work likely to disturb it.",
  "Structural alterations or repairs requiring temporary support to prevent collapse.",
  "Work in or near a confined space.",
  "Work in or near a shaft or trench with an excavated depth greater than 1.5 metres.",
  "Work in or near a tunnel.",
  "Use of explosives.",
  "Work on or near pressurised gas distribution mains or piping.",
  "Work on or near chemical, fuel or refrigerant lines.",
  "Work on or near energised electrical installations or services.",
  "Work in an area that may have a contaminated or flammable atmosphere.",
  "Work involving tilt-up or precast concrete.",
  "Work on, in or adjacent to a road, railway, shipping lane or traffic corridor in use.",
  "Work in areas with movement of powered mobile plant.",
  "Work in areas with artificial extremes of temperature.",
  "Work in or near water or other liquid involving a risk of drowning.",
  "Work that involves diving work.",
];

const HAZARD_WALKTHROUGH = [
  ["H1", "Snakes and venomous fauna in survey area"],
  ["H2", "Heat stress / dehydration — water carried per person"],
  ["H3", "Ticks, leeches, biting insects, bee or ant nests"],
  ["H4", "Uneven ground, holes, logs, slip and trip hazards"],
  ["H5", "Steep terrain, cliff edges, unstable batters"],
  ["H6", "Water hazards — creeks, dams, other water bodies"],
  ["H7", "Falling limbs / dead standing trees in work area"],
  ["H8", "Plant and machinery operating on site"],
  ["H9", "Traffic — road verge, haul road, public interface"],
  ["H10", "Working alone or beyond line of sight of crew"],
  ["H11", "Nocturnal work — lighting, fatigue, night driving"],
  ["H12", "Contaminated land, dust, chemicals, asbestos"],
  ["H13", "Livestock, dogs, landholder or third-party conflict"],
  ["H14", "Manual handling — carrying equipment / gear"],
  ["H15", "Fatigue — travel time, consecutive field days"],
];

const PPE_ITEMS = [
  "Eye protection", "P2 dust mask", "Gloves", "Hi-vis PPE",
  "Boots", "Cap", "Sun safe hat", "Weatherproof PPE",
  "In-Reach or two-way radio", "Head torch / spotlight", "Respirator", "Waders",
  "Buoyancy aid", "Snake gaiters", "Hearing protection", "Sunscreen",
];

const SOP_LIST = [
  "Clearing activities",
  "Terrestrial Fauna Survey",
  "Dewatering Activities",
  "Fieldwork Biosecurity",
  "Project Travel",
];

function emptyChecklist(items) {
  return items.map((item) => ({ check: Array.isArray(item) ? item[1] : item, ref: Array.isArray(item) ? item[0] : null, answer: "", comment: "" }));
}
function emptyHealthRow() { return { member: "", support: "", medication: "", briefed: "" }; }
function emptyTaskRow() { return { step: "", hazard: "", control: "", who: "" }; }
function emptyResidualRow() { return { hazardRef: "", control: "", likelihood: "", consequence: "", residual: "", acceptable: "" }; }
function emptyCrewRow() { return { name: "", role: "", fitForWork: "", ppeChecked: "", signature: "", timeOnSite: "" }; }

function initialForm() {
  return {
    date: "", startTime: "", fieldLead: "", projectNumber: "", site: "", nearestTown: "",
    worksiteManagedBy: "", crewSize: "", expectedFinish: "", vehicleLog: "",
    weather: "", fireDanger: "", groundConditions: "", currentTemp: "", maxWindGusts: "", avgWindGusts: "", mobileCoverage: "", access: "", distanceToHospital: "",
    toolboxChecklist: emptyChecklist(TOOLBOX_CHECKLIST),
    healthConditions: [emptyHealthRow(), emptyHealthRow()],
    ppe: {}, ppeNotes: "",
    hrcw: emptyChecklist(HRCW_CHECKLIST),
    jsaApplicable: "", swmsRef: {}, additionalRefs: "",
    hazardWalkthrough: emptyChecklist(HAZARD_WALKTHROUGH),
    otherHazards: "",
    taskSteps: [emptyTaskRow(), emptyTaskRow()],
    stopWorkTriggers: "",
    residualRisk: [emptyResidualRow()],
    emergencyMeetingPoint: "", firstAidOfficer: "", firstAidKitLocation: "", nearestHospital: "",
    commsDevice: "", checkInPerson: "", plbId: "", checkInInterval: "", overdueEscalationTime: "", emergencyDecisions: "",
    crew: [emptyCrewRow(), emptyCrewRow()],
    fieldLeadSignOffName: "", fieldLeadSignOffDate: "", fieldLeadSignature: "",
  };
}

/* ---------------------------------------------------------------
   Small building blocks
----------------------------------------------------------------- */
function Field({ label, children, error, hint, full }) {
  return (
    <label className={"dra-field" + (full ? " dra-full" : "") + (error ? " dra-invalid" : "")}>
      <span>{label}</span>
      {children}
      {error ? <em className="dra-field-error"><AlertCircle size={12} /> {error}</em> : null}
    </label>
  );
}

function ChecklistTable({ title, rows, onChange, refWidth = 44, commentPlaceholder = "Comment / action" }) {
  return (
    <div className="dra-tbl-wrap">
      {title ? <div className="dra-tbl-label">{title}</div> : null}
      <div className="dra-tbl-scroll">
        <table className="dra-table">
          <thead>
            <tr>
              {rows[0]?.ref ? <th style={{ width: refWidth }}>Ref</th> : null}
              <th>Check</th>
              <th style={{ width: 52 }}>Yes</th>
              <th style={{ width: 52 }}>No</th>
              <th style={{ width: 52 }}>N/A</th>
              <th style={{ width: "28%" }}>{commentPlaceholder}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 ? "dra-alt" : ""}>
                {row.ref ? <td className="dra-ref">{row.ref}</td> : null}
                <td className="dra-desc">{row.check}</td>
                {["yes", "no", "na"].map((opt) => (
                  <td key={opt} className="dra-c">
                    <input
                      type="checkbox"
                      checked={row.answer === opt}
                      onChange={() => onChange(i, { ...row, answer: row.answer === opt ? "" : opt })}
                      aria-label={`${row.check} — ${opt}`}
                    />
                  </td>
                ))}
                <td>
                  <input
                    type="text"
                    value={row.comment}
                    placeholder={commentPlaceholder}
                    onChange={(e) => onChange(i, { ...row, comment: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableTable({ label, columns, rows, onChange, onAdd, onRemove, minRows = 1 }) {
  return (
    <div className="dra-tbl-wrap">
      {label ? <div className="dra-tbl-label">{label}</div> : null}
      <div className="dra-tbl-scroll">
        <table className="dra-table">
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 ? "dra-alt" : ""}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <input type="text" value={row[c.key] || ""} placeholder={c.placeholder || ""} onChange={(e) => onChange(i, { ...row, [c.key]: e.target.value })} />
                  </td>
                ))}
                <td className="dra-c">
                  {rows.length > minRows ? (
                    <button type="button" className="dra-row-remove" onClick={() => onRemove(i)} title="Remove row"><Trash2 size={14} /></button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="dra-add-row" onClick={onAdd}><Plus size={13} /> Add row</button>
    </div>
  );
}

function SectionHead({ n, title, mandatory }) {
  return (
    <div className={"dra-section-head" + (mandatory ? " mandatory" : "")}>
      <span className="dra-section-title">{n}. {title}</span>
      {mandatory ? <span className="dra-mand">Mandatory</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------
   Main component
----------------------------------------------------------------- */
export default function DailyRiskAssessmentForm({ authFetch, onBack, onSubmitted, onToast }) {
  const [form, setForm] = useState(initialForm);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(null); // { ref } once posted successfully
  const fieldRefs = useRef({});

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setForm({ ...initialForm(), ...draft });
      setRestoredDraft(true);
    }
  }, []);

  useEffect(() => {
    if (submitted) return; // stop overwriting the draft once submitted+cleared
    writeDraft(form);
  }, [form, submitted]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setChecklistRow = (key) => (index, next) => setForm((f) => ({ ...f, [key]: f[key].map((r, i) => (i === index ? next : r)) }));
  const setPpe = (item, value) => setForm((f) => ({ ...f, ppe: { ...f.ppe, [item]: value } }));
  const setSwmsRef = (item, value) => setForm((f) => ({ ...f, swmsRef: { ...f.swmsRef, [item]: value } }));

  const dynamicTable = (key, empty, minRows = 1) => ({
    rows: form[key],
    onChange: (i, next) => setForm((f) => ({ ...f, [key]: f[key].map((r, idx) => (idx === i ? next : r)) })),
    onAdd: () => setForm((f) => ({ ...f, [key]: [...f[key], empty()] })),
    onRemove: (i) => setForm((f) => ({ ...f, [key]: f[key].length > minRows ? f[key].filter((_, idx) => idx !== i) : f[key] })),
    minRows,
  });

  const validate = () => {
    const next = {};
    if (!form.date) next.date = "Required";
    if (!form.startTime) next.startTime = "Required";
    if (!form.fieldLead) next.fieldLead = "Required";
    if (!form.projectNumber) next.projectNumber = "Required";
    if (!form.site) next.site = "Required";
    if (!form.weather) next.weather = "Required";
    if (!form.fireDanger) next.fireDanger = "Required";
    if (!form.groundConditions) next.groundConditions = "Required";
    const uncheckedToolbox = form.toolboxChecklist.some((r) => !r.answer);
    if (uncheckedToolbox) next.toolboxChecklist = "Every line needs Yes, No or N/A before this can be submitted.";
    const crewComplete = form.crew.filter((r) => r.name.trim() && r.signature);
    if (!crewComplete.length) next.crew = "At least one crew member needs a name and signature.";
    if (!form.fieldLeadSignOffName) next.fieldLeadSignOffName = "Required";
    if (!form.fieldLeadSignature) next.fieldLeadSignature = "The Field Lead needs to sign before this can be submitted.";
    return next;
  };

  const scrollToFirstError = (errs) => {
    const order = ["date", "startTime", "fieldLead", "projectNumber", "site", "weather", "fireDanger", "groundConditions", "toolboxChecklist", "crew", "fieldLeadSignOffName", "fieldLeadSignature"];
    const firstKey = order.find((k) => errs[k]);
    const el = firstKey && fieldRefs.current[firstKey];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el.focus) el.focus();
    }
  };

  const submit = async () => {
    if (submitting) return;
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      setSubmitError("Some required fields are missing — they're highlighted below.");
      scrollToFirstError(errs);
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    try {
      const res = await authFetch("POST", "/api/whs-forms", {
        form_type: "daily_risk_assessment",
        title: `Daily Risk Assessment & Toolbox Talk: ${form.site || form.projectNumber || form.date}`,
        site: form.site || "",
        form_date: form.date || null,
        notifiable_flag: false,
        details: form,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't submit — please try again.");
      clearDraft();
      setSubmitted({ id: d.id || d.form?.id || null, at: new Date() });
      onSubmitted && onSubmitted();
      onToast && onToast("Daily Risk Assessment & Toolbox Talk submitted.");
    } catch (e) {
      setSubmitError(e.message || "Couldn't submit — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const startNew = () => {
    clearDraft();
    setForm(initialForm());
    setSubmitted(null);
    setErrors({});
    setSubmitError("");
  };

  const errorCount = Object.keys(errors).length;

  if (submitted) {
    return (
      <div className="dra dra-confirm">
        <style>{DRA_CSS}</style>
        <div className="dra-confirm-card">
          <div className="dra-confirm-icon"><CheckCircle2 size={30} /></div>
          <div className="dra-confirm-eyebrow">Submitted</div>
          <h1>Daily Risk Assessment &amp; Toolbox Talk recorded</h1>
          <p>
            Filed to your submission history and reported to WHS Monitoring for review
            {form.site ? <> — <strong>{form.site}</strong></> : null}
            {form.date ? <>, {form.date}</> : null}.
          </p>
          <p className="dra-confirm-sub">You can find it any time under "View my submission history" on the WHS &amp; EC Forms hub.</p>
          <div className="dra-confirm-actions">
            <button type="button" className="dra-btn-primary" onClick={onBack}><ChevronLeft size={15} /> Back to WHS &amp; EC Forms</button>
            <button type="button" className="dra-btn-ghost" onClick={startNew}>Start another Toolbox Talk</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dra">
      <style>{DRA_CSS}</style>
      <button type="button" className="dra-back" onClick={onBack}><ChevronLeft size={15} /> Back to forms</button>

      <header className="dra-hero">
        <span className="dra-hero-code">EC-WHS-DRA-001 · Rev 2</span>
        <h1>Daily Risk Assessment &amp; Toolbox Talk</h1>
        <p>Complete once per crew, per site, per day.</p>
      </header>

      {restoredDraft ? (
        <p className="dra-notice dra-notice-info"><CheckCircle2 size={15} /> Restored your saved draft from this device.</p>
      ) : null}
      <p className="dra-notice dra-notice-info">
        <ShieldAlert size={15} /> This form saves automatically on this device as you go — you can switch apps or lose signal and come back without losing your entries. Nothing is submitted to WHS Monitoring until you press Submit at the bottom.
      </p>
      {submitError ? <p className="dra-notice dra-notice-error"><AlertCircle size={15} /> {submitError}</p> : null}

      <div className="dra-alert dra-alert-info">
        <b>Purpose —</b> This is both the daily risk assessment and the toolbox talk for the field day, completed once per crew, per site. Conditions are recorded on arrival against the stop-work triggers, the standing hazard walk-through is worked through and the residual risk rated after controls, task-level hazards and controls are agreed for today, and the talk itself is run by the Field Lead with every attendee signing on. It is the Field Lead's job to run it and every attendee's job to speak up.
      </div>

      {/* 1. Today */}
      <section className="dra-section">
        <SectionHead n={1} title="Today" mandatory />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Complete in the vehicle on arrival, before boots hit the ground.</p>
          <div className="dra-row3">
            <Field label="Date" error={errors.date}><input ref={(el) => (fieldRefs.current.date = el)} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Start time" error={errors.startTime}><input ref={(el) => (fieldRefs.current.startTime = el)} type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></Field>
            <Field label="Field Lead" error={errors.fieldLead}><input ref={(el) => (fieldRefs.current.fieldLead = el)} type="text" placeholder="Name" value={form.fieldLead} onChange={(e) => set("fieldLead", e.target.value)} /></Field>
          </div>
          <div className="dra-row3">
            <Field label="Project & job number" error={errors.projectNumber}><input ref={(el) => (fieldRefs.current.projectNumber = el)} type="text" placeholder="EC-____" value={form.projectNumber} onChange={(e) => set("projectNumber", e.target.value)} /></Field>
            <Field label="Site / location" error={errors.site}><input ref={(el) => (fieldRefs.current.site = el)} type="text" placeholder="Location or plot ID" value={form.site} onChange={(e) => set("site", e.target.value)} /></Field>
            <Field label="Nearest town"><input type="text" placeholder="For emergency response" value={form.nearestTown} onChange={(e) => set("nearestTown", e.target.value)} /></Field>
          </div>
          <div className="dra-row3">
            <Field label="Worksite is managed by">
              <select value={form.worksiteManagedBy} onChange={(e) => set("worksiteManagedBy", e.target.value)}>
                <option value="">Select…</option>
                <option>Ecology Consulting</option><option>Principal Contractor</option><option>Client / landholder</option><option>Subcontractor engagement</option>
              </select>
            </Field>
            <Field label="Crew size">
              <select value={form.crewSize} onChange={(e) => set("crewSize", e.target.value)}>
                <option value="">Select…</option>
                <option>1 (lone worker)</option><option>2</option><option>3</option><option>4+</option>
              </select>
            </Field>
            <Field label="Expected finish"><input type="time" value={form.expectedFinish} onChange={(e) => set("expectedFinish", e.target.value)} /></Field>
          </div>
          <Field label="Vehicle log book completed (required if driving a company vehicle)" full>
            <input type="text" placeholder="Yes / No — rego" value={form.vehicleLog} onChange={(e) => set("vehicleLog", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 2. Conditions on arrival */}
      <section className="dra-section">
        <SectionHead n={2} title="Conditions on arrival" mandatory />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Record what you can actually see and feel — not the forecast. If any red trigger below applies, stop and call the project manager.</p>
          <div className="dra-row3">
            <Field label="Weather" error={errors.weather}>
              <select ref={(el) => (fieldRefs.current.weather = el)} value={form.weather} onChange={(e) => set("weather", e.target.value)}>
                <option value="">Select…</option>
                <option>Sunny / Clear</option><option>Partly Cloudy</option><option>Cloudy</option><option>Overcast</option><option>Rain</option><option>Drizzle</option><option>Snow</option><option>Stormy</option>
              </select>
            </Field>
            <Field label="Fire danger rating" error={errors.fireDanger}>
              <select ref={(el) => (fieldRefs.current.fireDanger = el)} value={form.fireDanger} onChange={(e) => set("fireDanger", e.target.value)}>
                <option value="">Select…</option>
                <option>No rating</option><option>Moderate</option><option>High</option><option>Extreme</option><option>Catastrophic</option>
              </select>
            </Field>
            <Field label="Ground conditions" error={errors.groundConditions}>
              <select ref={(el) => (fieldRefs.current.groundConditions = el)} value={form.groundConditions} onChange={(e) => set("groundConditions", e.target.value)}>
                <option value="">Select…</option>
                <option>Dry / firm</option><option>Soft / boggy</option><option>Steep / loose</option><option>Flooded</option><option>Recently burnt</option>
              </select>
            </Field>
          </div>
          <div className="dra-row3">
            <Field label="Current temperature"><input type="text" placeholder="°C" value={form.currentTemp} onChange={(e) => set("currentTemp", e.target.value)} /></Field>
            <Field label="Max wind gusts"><input type="text" placeholder="km per hour" value={form.maxWindGusts} onChange={(e) => set("maxWindGusts", e.target.value)} /></Field>
            <Field label="Average wind gusts"><input type="text" placeholder="km per hour" value={form.avgWindGusts} onChange={(e) => set("avgWindGusts", e.target.value)} /></Field>
          </div>
          <div className="dra-row3">
            <Field label="Mobile coverage">
              <select value={form.mobileCoverage} onChange={(e) => set("mobileCoverage", e.target.value)}>
                <option value="">Select…</option><option>Full</option><option>Patchy</option><option>None — satellite / PLB required</option>
              </select>
            </Field>
            <Field label="Access">
              <select value={form.access} onChange={(e) => set("access", e.target.value)}>
                <option value="">Select…</option><option>2WD</option><option>4WD required</option><option>Foot access only</option><option>Boat / vessel</option>
              </select>
            </Field>
            <Field label="Distance to nearest hospital"><input type="text" placeholder="km / minutes" value={form.distanceToHospital} onChange={(e) => set("distanceToHospital", e.target.value)} /></Field>
          </div>
          <div className="dra-alert dra-alert-warn"><b>Stop-work triggers —</b> Catastrophic fire danger, active storm cell, floodwater over access track, lone worker with no comms, or any crew member unfit for field work. Do not proceed. Call the project manager and record the decision in Section 12.</div>
        </div>
      </section>

      {/* 3. Toolbox talk checklist */}
      <section className="dra-section">
        <SectionHead n={3} title="Toolbox talk checklist" mandatory />
        <div className="dra-section-body" ref={(el) => (fieldRefs.current.toolboxChecklist = el)}>
          <p className="dra-hint"><b>How to complete —</b> Every line is a conversation, not a tick. If the answer is No, resolve it before work starts.</p>
          {errors.toolboxChecklist ? <p className="dra-table-error"><AlertCircle size={13} /> {errors.toolboxChecklist}</p> : null}
          <ChecklistTable title="3.1 Before work commences" rows={form.toolboxChecklist} onChange={setChecklistRow("toolboxChecklist")} refWidth={42} />
        </div>
      </section>

      {/* 4. At-risk health/medical */}
      <section className="dra-section">
        <SectionHead n={4} title="At-risk health or medical conditions" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Raised privately with the Field Lead. Record only what the team needs in order to respond — never clinical detail.</p>
          <p className="dra-lead">These are the conditions most likely to change how the crew responds in an emergency. A team member is not obliged to disclose a diagnosis, but the Field Lead does need to know what support may be required and where any emergency medication is kept.</p>
          <EditableTable
            label="4.1 Support requirements declared today"
            columns={[
              { key: "member", label: "Team member" },
              { key: "support", label: "Support that may be needed" },
              { key: "medication", label: "Location of medication / aid" },
              { key: "briefed", label: "Field Lead briefed", width: 130 },
            ]}
            {...dynamicTable("healthConditions", emptyHealthRow, 1)}
          />
          <div className="dra-alert dra-alert-warn">
            <b>Examples —</b> Asthma or respiratory conditions · Severe allergies or anaphylaxis · Diabetes · Heart conditions or high blood pressure · Epilepsy or seizure disorders · Recent injuries · Mental health or psychosocial vulnerabilities · Heat or cold sensitivity · Any medication-dependent condition where emergency access to medication is required.
          </div>
        </div>
      </section>

      {/* 5. PPE */}
      <section className="dra-section">
        <SectionHead n={5} title="PPE requirements" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Select every item required for today. An unticked item that is needed is a stop-work.</p>
          <div className="dra-tbl-label">5.1 Select all applicable PPE</div>
          <div className="dra-ppe-grid">
            {PPE_ITEMS.map((item) => (
              <label key={item} className="dra-tick">
                <input type="checkbox" checked={!!form.ppe[item]} onChange={(e) => setPpe(item, e.target.checked)} /> {item}
              </label>
            ))}
          </div>
          <Field label="PPE notes — items unavailable, damaged or substituted" full>
            <textarea placeholder="Anything missing, and what was done about it." value={form.ppeNotes} onChange={(e) => set("ppeNotes", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 6. Applicable safety documents */}
      <section className="dra-section">
        <SectionHead n={6} title="Applicable safety documents" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Name the controlling documents the crew has actually read today — not the ones that exist.</p>
          <p className="dra-lead"><b>SWMS</b> — a Safe Work Method Statement describes how work will be undertaken safely in a construction environment. Ecological surveys on construction sites are often <b>High Risk Construction Work</b> because of plant interaction, clearing operations, uneven terrain and remote conditions, which means a SWMS is typically legally required.</p>
          <p className="dra-lead"><b>JSA</b> — a Job Safety Analysis breaks a specific survey activity into steps, identifies the hazard at each step and defines the controls.</p>
          <p className="dra-lead"><b>SOP</b> — a Standard Operating Procedure sets the standardised method for a task regardless of site.</p>
          <ChecklistTable title="6.1 High Risk Construction Work — does today involve any of the following?" rows={form.hrcw} onChange={setChecklistRow("hrcw")} refWidth={42} />
          <div className="dra-alert dra-alert-stop"><b>If any line above is Yes</b> — a SWMS is required in addition to this toolbox talk. Do not commence that task until the relevant SWMS has been read, signed and is available on site.</div>
          <div className="dra-row2">
            <Field label="JSA applicable to today">
              <select value={form.jsaApplicable} onChange={(e) => set("jsaApplicable", e.target.value)}>
                <option value="">Select…</option>
                <option>General Field Surveys</option><option>Pre-Clearing Assessments</option><option>Clearing Supervision</option><option>Remote and Isolated Work</option><option>More than one — list below</option><option>N/A</option>
              </select>
            </Field>
          </div>
          <Field label="Applicable SOPs in force today — select all that apply" full>
            <div className="dra-ppe-grid" style={{ marginTop: 6 }}>
              {SOP_LIST.map((item) => (
                <label key={item} className="dra-tick" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 400, textTransform: "none", letterSpacing: 0, fontFamily: "'Archivo', sans-serif", color: "#3a4740" }}>
                  <input type="checkbox" checked={!!form.swmsRef[item]} onChange={(e) => setSwmsRef(item, e.target.checked)} /> {item}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Additional JSA, SWMS or SOP references applied today" full>
            <textarea placeholder="List every controlling document the crew has read and signed." value={form.additionalRefs} onChange={(e) => set("additionalRefs", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 7. Subcontractor obligations — informational */}
      <section className="dra-section">
        <SectionHead n={7} title="Subcontractor and Principal Contractor obligations" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Read aloud where Ecology Consulting is engaged as a subcontractor.</p>
          <p className="dra-lead">When Ecology Consulting is engaged as a subcontractor, all workers, subcontractors and visitors must comply fully with <b>both</b> Ecology Consulting's internal WHS requirements <b>and</b> the Principal Contractor's WHS systems. Where the Principal Contractor's requirements are more stringent or site-specific, those take precedence — but Ecology Consulting's WHS documentation must still always be completed in full.</p>
          <div className="dra-hoc">
            {[
              ["#3f8f5f", "Documentation", "always required", "Completion of all Ecology Consulting WHS documents, ensuring they are accurate, current and submitted as required."],
              ["#1d7d8c", "Induction", "before entry", "Completion of the Principal Contractor's WHS induction before entering or commencing any work on site."],
              ["#c98a1e", "Site systems", "read and follow", "Reviewing, understanding and adhering to the Principal Contractor's SWMS, risk assessments and associated WHS documentation."],
              ["#d66e2d", "Emergency", "site specific", "Following all site-specific emergency response procedures, including evacuation routes, muster points, communication protocols and incident reporting requirements."],
              ["#c4453a", "Site rules", "non-negotiable", "Complying with all site rules, PPE requirements, exclusion zones, traffic management controls, plant interaction protocols and directions issued by Principal Contractor representatives."],
            ].map(([color, label, eff, desc]) => (
              <div className="dra-hoc-row" key={label}>
                <div className="dra-hoc-rank" style={{ background: color }}>{label}<span>{eff}</span></div>
                <div className="dra-hoc-desc">{desc}</div>
              </div>
            ))}
          </div>
          <div className="dra-alert dra-alert-stop"><b>Failure to comply</b> — with either Ecology Consulting's internal documentation or Principal Contractor requirements — may result in immediate removal from site, work stoppage, corrective or disciplinary action, and reporting to Ecology Consulting management for further review.</div>
        </div>
      </section>

      {/* 8. Field Lead responsibilities — informational */}
      <section className="dra-section">
        <SectionHead n={8} title="Field Lead responsibilities" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Read aloud. This is the boundary of the Field Lead role.</p>
          <p className="dra-lead">Field Leads play a critical role in coordinating safe field operations. However, they do <b>not</b> assume the legal duties or responsibilities of other workers, subcontractors or visitors. Each individual remains responsible for fulfilling their own obligations under applicable WHS legislation.</p>
          <p className="dra-lead">All incidents, near misses, hazards or accidents occurring on site must be reported by the Field Lead to the <b>Communication Officer</b> and the <b>WHS Officer</b>.</p>
          <div className="dra-alert dra-alert-warn"><b>All workers, subcontractors and volunteers are required to —</b> apply sound risk-management practices in accordance with the Ecology Consulting WHS Handbook and WHS legislation; carry out their duties in a way that ensures the safety of themselves and others; and report hazards, risks, exposures or losses to the Field Lead immediately. Failure to follow these requirements may lead to work cessation, reassignment or further management action.</div>
        </div>
      </section>

      {/* 9. Hazard walk-through */}
      <section className="dra-section">
        <SectionHead n={9} title="Today's hazard walk-through" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Tick every hazard present today and name the control you will actually use. Anything ticked without a control is not ready to work.</p>
          <ChecklistTable title="9.1 Hazard walk-through" rows={form.hazardWalkthrough} onChange={setChecklistRow("hazardWalkthrough")} commentPlaceholder="Comment / control" />
          <Field label="Other hazards specific to today" full>
            <textarea placeholder="Anything not covered above — describe the hazard and the control." value={form.otherHazards} onChange={(e) => set("otherHazards", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 10. Task steps */}
      <section className="dra-section">
        <SectionHead n={10} title="Task steps, hazards and controls" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Written on site, by the crew, for today. Not copied from yesterday.</p>
          <EditableTable
            label="10.1 Site risk assessment"
            columns={[
              { key: "step", label: "Task step" },
              { key: "hazard", label: "Hazard identified" },
              { key: "control", label: "Control applied" },
              { key: "who", label: "Who is responsible", width: 160 },
            ]}
            {...dynamicTable("taskSteps", emptyTaskRow, 1)}
          />
          <Field label="Stop-work triggers agreed for today" full>
            <textarea placeholder="The conditions under which this crew stops and calls the Communication Officer." value={form.stopWorkTriggers} onChange={(e) => set("stopWorkTriggers", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 11. Residual risk */}
      <section className="dra-section">
        <SectionHead n={11} title="Risk rating after controls" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Rate each significant hazard with controls in place. Anything remaining High or Extreme must be escalated before work starts.</p>
          <EditableTable
            label="11.1 Residual risk"
            columns={[
              { key: "hazardRef", label: "Hazard ref", width: 90 },
              { key: "control", label: "Control in place" },
              { key: "likelihood", label: "Likelihood", width: 110 },
              { key: "consequence", label: "Consequence", width: 120 },
              { key: "residual", label: "Residual risk", width: 110 },
              { key: "acceptable", label: "Acceptable? (Y/N)", width: 120 },
            ]}
            {...dynamicTable("residualRisk", emptyResidualRow, 1)}
          />
        </div>
      </section>

      {/* 12. Emergency arrangements */}
      <section className="dra-section">
        <SectionHead n={12} title="Emergency arrangements" />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Everyone repeats the muster point out loud before separating.</p>
          <div className="dra-row3">
            <Field label="Emergency meeting point"><input type="text" placeholder="Where the crew regroups" value={form.emergencyMeetingPoint} onChange={(e) => set("emergencyMeetingPoint", e.target.value)} /></Field>
            <Field label="First aid officer on site"><input type="text" placeholder="Name" value={form.firstAidOfficer} onChange={(e) => set("firstAidOfficer", e.target.value)} /></Field>
            <Field label="Location of first aid kit"><input type="text" placeholder="Vehicle / pack" value={form.firstAidKitLocation} onChange={(e) => set("firstAidKitLocation", e.target.value)} /></Field>
          </div>
          <div className="dra-row3">
            <Field label="Nearest hospital"><input type="text" placeholder="Name and address" value={form.nearestHospital} onChange={(e) => set("nearestHospital", e.target.value)} /></Field>
            <Field label="Communication device"><input type="text" placeholder="Mobile / UHF / In-Reach" value={form.commsDevice} onChange={(e) => set("commsDevice", e.target.value)} /></Field>
            <Field label="Daily check-in allocated to"><input type="text" placeholder="Name" value={form.checkInPerson} onChange={(e) => set("checkInPerson", e.target.value)} /></Field>
          </div>
          <div className="dra-row3">
            <Field label="PLB / satellite device ID"><input type="text" placeholder="Serial or channel" value={form.plbId} onChange={(e) => set("plbId", e.target.value)} /></Field>
            <Field label="Check-in interval">
              <select value={form.checkInInterval} onChange={(e) => set("checkInInterval", e.target.value)}>
                <option value="">Select…</option><option>On arrival and departure only</option><option>Every 2 hours</option><option>Every 4 hours</option><option>Morning and evening</option>
              </select>
            </Field>
            <Field label="Overdue escalation time"><input type="time" value={form.overdueEscalationTime} onChange={(e) => set("overdueEscalationTime", e.target.value)} /></Field>
          </div>
          <Field label="Decisions made — work stopped, deferred or method changed today" full>
            <textarea rows={3} placeholder="Record any stop-work, deferral or change of method, who authorised it and when." value={form.emergencyDecisions} onChange={(e) => set("emergencyDecisions", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 13. Crew sign-on */}
      <section className="dra-section">
        <SectionHead n={13} title="Crew sign-on" mandatory />
        <div className="dra-section-body">
          <p className="dra-hint"><b>How to complete —</b> Every person on site signs. By signing, each person confirms they attended the toolbox talk, are fit for field work, have the right PPE and understand the controls above.</p>
          {errors.crew ? <p className="dra-table-error" ref={(el) => (fieldRefs.current.crew = el)}><AlertCircle size={13} /> {errors.crew}</p> : null}
          <div className="dra-tbl-label">13.1 Attendance and declaration</div>
          <div className="dra-crew-list">
            {form.crew.map((row, i) => (
              <div className="dra-crew-row" key={i}>
                <div className="dra-crew-grid">
                  <Field label="Name"><input type="text" value={row.name} onChange={(e) => setForm((f) => ({ ...f, crew: f.crew.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)) }))} /></Field>
                  <Field label="Role"><input type="text" value={row.role} onChange={(e) => setForm((f) => ({ ...f, crew: f.crew.map((r, idx) => (idx === i ? { ...r, role: e.target.value } : r)) }))} /></Field>
                  <Field label="Fit for work (Y/N)"><input type="text" value={row.fitForWork} onChange={(e) => setForm((f) => ({ ...f, crew: f.crew.map((r, idx) => (idx === i ? { ...r, fitForWork: e.target.value } : r)) }))} /></Field>
                  <Field label="PPE checked"><input type="text" value={row.ppeChecked} onChange={(e) => setForm((f) => ({ ...f, crew: f.crew.map((r, idx) => (idx === i ? { ...r, ppeChecked: e.target.value } : r)) }))} /></Field>
                  <Field label="Time on site"><input type="text" placeholder="e.g. 8:15am" value={row.timeOnSite} onChange={(e) => setForm((f) => ({ ...f, crew: f.crew.map((r, idx) => (idx === i ? { ...r, timeOnSite: e.target.value } : r)) }))} /></Field>
                </div>
                <SignaturePad label={`${row.name || `Crew member ${i + 1}`} signature`} value={row.signature || ""} onChange={(sig) => setForm((f) => ({ ...f, crew: f.crew.map((r, idx) => (idx === i ? { ...r, signature: sig } : r)) }))} />
                {form.crew.length > 1 ? (
                  <button type="button" className="dra-row-remove dra-crew-remove" onClick={() => setForm((f) => ({ ...f, crew: f.crew.filter((_, idx) => idx !== i) }))}><Trash2 size={13} /> Remove</button>
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" className="dra-add-row" onClick={() => setForm((f) => ({ ...f, crew: [...f.crew, emptyCrewRow()] }))}><Plus size={13} /> Add crew member</button>

          <div className="dra-row2" style={{ marginTop: 18 }}>
            <Field label="Field Lead name" error={errors.fieldLeadSignOffName}><input ref={(el) => (fieldRefs.current.fieldLeadSignOffName = el)} type="text" placeholder="Full name" value={form.fieldLeadSignOffName} onChange={(e) => set("fieldLeadSignOffName", e.target.value)} /></Field>
            <Field label="Date and time"><input type="date" value={form.fieldLeadSignOffDate} onChange={(e) => set("fieldLeadSignOffDate", e.target.value)} /></Field>
          </div>
          <div ref={(el) => (fieldRefs.current.fieldLeadSignature = el)}>
            <Field label="Field Lead signature — sign with your finger" error={errors.fieldLeadSignature} full>
              <SignaturePad label="Sign here with your finger" value={form.fieldLeadSignature} onChange={(sig) => set("fieldLeadSignature", sig)} />
            </Field>
          </div>
        </div>
      </section>

      <div className="dra-submit-bar">
        {errorCount > 0 ? (
          <p className="dra-submit-warning"><AlertCircle size={14} /> {errorCount} required item{errorCount === 1 ? "" : "s"} still need{errorCount === 1 ? "s" : ""} attention above.</p>
        ) : (
          <p className="dra-submit-ready"><CheckCircle2 size={14} /> All required fields look complete.</p>
        )}
        <button type="button" className="dra-btn-primary dra-btn-submit" onClick={submit} disabled={submitting}>
          <Send size={15} /> {submitting ? "Submitting…" : "Submit Daily Risk Assessment & Toolbox Talk"}
        </button>
        <p className="dra-submit-note">Submitting locks a copy of this form — including signatures — into your submission history and the WHS Monitoring register for review.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Scoped styles. Self-contained on purpose: this component doesn't
   depend on the state of app/globals.css, which has been edited by
   multiple parties this project. Colours match the approved
   EC-WHS-DRA-001 mockup and the app's established type system
   (Newsreader / Archivo / IBM Plex Mono).
----------------------------------------------------------------- */
const DRA_CSS = `
.dra { max-width: 900px; margin: 0 auto; padding: 24px 18px 80px; font-family: 'Archivo', -apple-system, Helvetica, Arial, sans-serif; color: #12211a; }
.dra-back { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: #1f5a34; font-size: 13.5px; font-weight: 700; cursor: pointer; padding: 8px 0 14px; }
.dra-hero { background: #eef3e4; border: 1px solid #d7e2c8; border-top: 5px solid #3f8f5f; border-radius: 12px 12px 0 0; padding: 20px 22px 16px; }
.dra-hero-code { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: #5a6b57; }
.dra-hero h1 { font-family: 'Newsreader', Georgia, serif; font-weight: 400; font-size: 30px; line-height: 1.08; margin: 8px 0 6px; color: #12211a; }
.dra-hero p { margin: 0; font-size: 13.5px; color: #5c6b58; }
.dra-notice { display: flex; align-items: flex-start; gap: 9px; margin: 12px 0 0; padding: 11px 14px; border-radius: 9px; font-size: 13px; line-height: 1.5; }
.dra-notice-info { background: rgba(29,125,140,.08); border: 1px solid rgba(29,125,140,.24); color: #134a52; }
.dra-notice-error { background: rgba(196,69,58,.08); border: 1px solid rgba(196,69,58,.3); color: #8a2f26; }
.dra-alert { border-radius: 9px; padding: 13px 15px; font-size: 13px; line-height: 1.6; margin: 14px 0; }
.dra-alert-info { background: rgba(29,125,140,.08); border: 1px solid rgba(29,125,140,.26); border-left: 3px solid #1d7d8c; color: #134a52; }
.dra-alert-warn { background: rgba(201,138,30,.09); border: 1px solid rgba(201,138,30,.3); border-left: 3px solid #c98a1e; color: #7a5510; }
.dra-alert-stop { background: rgba(196,69,58,.08); border: 1px solid rgba(196,69,58,.28); border-left: 3px solid #c4453a; color: #8a2f26; }
.dra-section { border: 1px solid #e3ded2; border-top: none; background: #fdfbf6; }
.dra-section:first-of-type { border-top: 1px solid #e3ded2; }
.dra-section-head { display: flex; align-items: center; gap: 11px; padding: 12px 18px; background: #f2f8f3; border-bottom: 1px solid #e3ded2; border-left: 4px solid #3f8f5f; }
.dra-section-head.mandatory { border-left-color: #c4453a; }
.dra-section-title { flex: 1; font-family: 'IBM Plex Mono', monospace; font-weight: 500; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: #2b6141; }
.dra-section-head.mandatory .dra-section-title { color: #c4453a; }
.dra-mand { font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; letter-spacing: .12em; text-transform: uppercase; background: #c4453a; color: #fff; border-radius: 4px; padding: 3px 7px; }
.dra-section-body { padding: 16px 18px 18px; }
.dra-hint { background: rgba(63,143,95,.1); border: 1px solid rgba(63,143,95,.34); border-left: 3px solid #3f8f5f; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; line-height: 1.5; color: #2b6141; margin: 0 0 14px; }
.dra-lead { font-size: 13px; line-height: 1.6; color: #3a4740; margin: 0 0 12px; }
.dra-row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
.dra-row2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px; }
.dra-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 700; color: #3a4740; }
.dra-field.dra-full { grid-column: 1 / -1; }
.dra-field input, .dra-field select, .dra-field textarea { font-family: 'Archivo', sans-serif; font-weight: 400; font-size: 13.5px; color: #12211a; border: 1px solid #cdd8c6; border-radius: 8px; padding: 9px 11px; background: #fff; }
.dra-field textarea { min-height: 64px; resize: vertical; }
.dra-field.dra-invalid input, .dra-field.dra-invalid select, .dra-field.dra-invalid textarea { border-color: #c4453a; background: #fef4f2; }
.dra-field-error { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #c4453a; }
.dra-table-error { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #c4453a; background: #fef4f2; border: 1px solid rgba(196,69,58,.3); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; }
.dra-tbl-wrap { margin-bottom: 14px; }
.dra-tbl-label { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #6b7770; margin-bottom: 7px; }
.dra-tbl-scroll { overflow-x: auto; border: 1px solid #e3ded2; border-radius: 9px; }
.dra-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 560px; }
.dra-table th { text-align: left; font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: #6b7770; padding: 8px 10px; background: #f2f8f3; border-bottom: 1px solid #e3ded2; white-space: nowrap; }
.dra-table td { padding: 7px 9px; border-bottom: 1px solid #eee9dd; vertical-align: middle; }
.dra-table tr.dra-alt td { background: #faf8f2; }
.dra-table .dra-ref { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #6b7770; }
.dra-table .dra-desc { font-size: 12.5px; color: #3a4740; }
.dra-table .dra-c { text-align: center; }
.dra-table input[type=text] { width: 100%; border: 1px solid #dfe4d5; border-radius: 6px; padding: 6px 8px; font-size: 12.5px; font-family: inherit; }
.dra-table input[type=checkbox] { width: 17px; height: 17px; cursor: pointer; }
.dra-row-remove { background: none; border: none; color: #a5342a; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; }
.dra-add-row { display: inline-flex; align-items: center; gap: 6px; background: #eef3e4; border: 1px dashed #9cbf7a; border-radius: 8px; padding: 7px 13px; font-size: 12px; font-weight: 700; color: #2c6a34; cursor: pointer; font-family: inherit; }
.dra-ppe-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 14px; margin-bottom: 14px; }
.dra-tick { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #3a4740; }
.dra-tick input { width: 16px; height: 16px; }
.dra-hoc { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; }
.dra-hoc-row { display: flex; border: 1px solid #e3ded2; border-radius: 9px; overflow: hidden; }
.dra-hoc-rank { flex: 0 0 150px; padding: 12px 14px; color: #fff; font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; display: flex; flex-direction: column; gap: 4px; }
.dra-hoc-rank span { font-size: 9px; opacity: .85; font-weight: 400; letter-spacing: .04em; }
.dra-hoc-desc { flex: 1; padding: 12px 14px; font-size: 12.5px; line-height: 1.5; color: #3a4740; background: #fff; }
.dra-crew-list { display: flex; flex-direction: column; gap: 16px; margin-bottom: 12px; }
.dra-crew-row { border: 1px solid #e3ded2; border-radius: 10px; padding: 14px; background: #fff; position: relative; }
.dra-crew-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 10px; }
.dra-crew-remove { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; font-size: 11.5px; font-weight: 700; }
.dra-submit-bar { margin-top: 22px; padding: 20px; border-radius: 12px; border: 1px solid rgba(31,90,52,.28); background: #fffdf8; text-align: center; }
.dra-submit-warning { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #a5772b; margin: 0 0 12px; }
.dra-submit-ready { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #2c6a34; margin: 0 0 12px; }
.dra-btn-primary { display: inline-flex; align-items: center; gap: 8px; background: #1f5a34; color: #fff; border: none; border-radius: 10px; padding: 13px 26px; font-size: 14.5px; font-weight: 600; cursor: pointer; font-family: 'Archivo', sans-serif; }
.dra-btn-primary:hover { background: #164426; }
.dra-btn-primary:disabled { background: #9aa69c; cursor: not-allowed; }
.dra-submit-note { margin: 12px 0 0; font-size: 12px; color: #6b7770; line-height: 1.5; }
.dra-confirm { display: flex; align-items: center; justify-content: center; min-height: 70vh; padding: 24px 18px; }
.dra-confirm-card { max-width: 480px; text-align: center; background: #0b2016; color: #f2f6ef; border-radius: 18px; padding: 40px 32px; box-shadow: 0 26px 60px -24px rgba(6,18,12,.6); }
.dra-confirm-icon { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: rgba(233,201,121,.16); color: #e7c979; margin-bottom: 16px; }
.dra-confirm-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #e7c979; margin-bottom: 10px; }
.dra-confirm-card h1 { font-family: 'Newsreader', Georgia, serif; font-weight: 400; font-size: 26px; margin: 0 0 12px; }
.dra-confirm-card p { font-size: 13.5px; line-height: 1.6; color: rgba(242,246,239,.85); margin: 0 0 8px; }
.dra-confirm-sub { font-size: 12.5px !important; color: rgba(242,246,239,.6) !important; }
.dra-confirm-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
.dra-btn-ghost { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.24); color: #eaf1e8; border-radius: 10px; padding: 11px 20px; font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: 'Archivo', sans-serif; }
@media (max-width: 720px) {
  .dra-row3, .dra-row2, .dra-crew-grid { grid-template-columns: 1fr; }
  .dra-ppe-grid { grid-template-columns: 1fr 1fr; }
  .dra-table { min-width: 480px; }
}
@media (max-width: 480px) {
  .dra-ppe-grid { grid-template-columns: 1fr; }
}
`;
