"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CalendarDays,
  GraduationCap,
  Package,
  Send,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  AlertTriangle,
  Route,
  ClipboardCheck,
  MapPin,
  FileWarning,
  Building2,
  History,
  ChevronLeft,
  HeartPulse,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FORM_SCHEMAS, FORM_GROUPS } from "../lib/formSchemas";
import { CARD_META } from "../lib/formCardMeta";
import SignaturePad from "./SignaturePad";
import WorkspaceNav from "./WorkspaceNav";

const ICONS = {
  leave: CalendarDays,
  training: GraduationCap,
  equipment: Package,
  daily_risk_assessment: ClipboardCheck,
  journey_plan: Route,
  pre_mobilisation: ClipboardCheck,
  site_erp: MapPin,
  injury_incident: AlertTriangle,
  near_miss: ShieldAlert,
  office_risk_assessment: Building2,
  job_safety_analysis: ListChecks,
  first_aid_kit: HeartPulse,
  hazard_report: FileWarning,
};
const BLURBS = {
  leave: "Annual, personal, or other leave.",
  training: "Courses, conferences, accreditation.",
  equipment: "Field gear, PPE, IT or other equipment.",
  daily_risk_assessment: "Conditions, hazards, check-in & crew sign-on.",
  journey_plan: "Crew, route, monitoring & overdue escalation.",
  pre_mobilisation: "Vehicle, comms, approvals before departure.",
  site_erp: "Access, medical, muster & evacuation.",
  injury_incident: "Record an injury, illness or dangerous incident.",
  office_risk_assessment: "Office hazards, controls & actions.",
  job_safety_analysis: "Step-by-step task hazard analysis.",
  first_aid_kit: "Vehicle, field & office kit checks.",
};

const FORM_REFERENCE_DOCS = {
  daily_risk_assessment: [{ label: "Daily Toolbox Talk template", href: "/resources/whs/EC-Daily-Toolbox-Talk-Template.pdf" }],
  pre_mobilisation: [{ label: "Pre-Mobilisation Checklist source", href: "/resources/whs/EC-Pre-Mobilisation-Checklist.pdf" }],
  site_erp: [{ label: "Site Specific Emergency Response Plan template", href: "/resources/whs/EC-Site-Specific-Emergency-Response-Plan-Template.pdf" }],
  job_safety_analysis: [{ label: "General Field Surveys JSA", href: "/resources/whs/EC-JSA-General-Field-Surveys.pdf" }],
  office_risk_assessment: [{ label: "Office Risk Assessment source", href: "/resources/whs/EC-Office-Risk-Assessment.html" }],
  first_aid_kit: [
    { label: "Family Soft Pack first-aid checklist", href: "/resources/whs/EC-First-Aid-Kit-Family-Soft-Pack.pdf" },
    { label: "Snake Bite Kit checklist", href: "/resources/whs/EC-First-Aid-Kit-Snake-Bite.pdf" },
    { label: "Modulator Kit checklist", href: "/resources/whs/EC-First-Aid-Kit-Modulator.pdf" },
  ],
};

const FORM_DRAFT_PREFIX = "ecology-consulting:whs-form:";
const FORM_DRAFT_TTL = 1000 * 60 * 60 * 24 * 14;

function formDraftKey(formKey) {
  return `${FORM_DRAFT_PREFIX}${formKey}`;
}

function readFormDraft(formKey) {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(formDraftKey(formKey));
    if (!raw) return {};
    const saved = JSON.parse(raw);
    if (!saved || Date.now() - Number(saved.savedAt || 0) > FORM_DRAFT_TTL) {
      window.localStorage.removeItem(formDraftKey(formKey));
      return {};
    }
    return saved.form && typeof saved.form === "object" ? saved.form : {};
  } catch {
    return {};
  }
}

function writeFormDraft(formKey, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(formDraftKey(formKey), JSON.stringify({ savedAt: Date.now(), form: value }));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory form still works.
  }
}

function clearFormDraft(formKey) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(formDraftKey(formKey));
  } catch {
    // Ignore unavailable storage.
  }
}

const WHS_DEFINITIONS = {
  injury_incident: {
    title: "What counts as a notifiable incident",
    body: "Under the model WHS Act, a notifiable incident is the death of a person, a serious injury or illness (e.g. requiring immediate in-patient hospital treatment, or immediate treatment for a serious injury), or a dangerous incident that exposes any person to a serious risk - even if no one is hurt. The test is objective. A PCBU must notify the regulator immediately of a notifiable incident.",
  },
};

const STATUS_STYLE = {
  submitted: { bg: "#fbf1dd", fg: "#a5772b", label: "Submitted" },
  approved: { bg: "#e5f1dd", fg: "#2c6a34", label: "Approved" },
  declined: { bg: "#fbecea", fg: "#a5342a", label: "Declined" },
  cancelled: { bg: "#eef0e9", fg: "#6b755f", label: "Cancelled" },
  reviewed: { bg: "#e3edf5", fg: "#2a6591", label: "Reviewed" },
  actioned: { bg: "#e5f1dd", fg: "#2c6a34", label: "Actioned" },
  archived: { bg: "#eef0e9", fg: "#6b755f", label: "Archived" },
};

export default function StaffForms() {
  const { session } = useAuth();
  const [view, setView] = useState("hub");
  const [activeKey, setActiveKey] = useState(null);
  const [form, setForm] = useState({});
  const [whsHistory, setWhsHistory] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const authFetch = useCallback(
    (method, url, body) =>
      fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    [session],
  );

  const loadHistory = useCallback(async () => {
    try {
      const wRes = await authFetch("GET", "/api/whs-forms");
      const wData = await wRes.json();
      if (wRes.ok) setWhsHistory(wData.forms || []);
    } catch (e) {
      setError(e.message);
    }
  }, [authFetch]);

  useEffect(() => {
    if (session?.access_token) loadHistory();
  }, [session, loadHistory]);

  useEffect(() => {
    if (view !== "form" || !activeKey) return;
    writeFormDraft(activeKey, form);
  }, [activeKey, form, view]);

  const notify = (m) => {
    setMessage(m);
    setError("");
    setTimeout(() => setMessage(""), 2600);
  };
  const openForm = (key) => {
    const savedDraft = readFormDraft(key);
    setActiveKey(key);
    setForm(savedDraft);
    setError("");
    setView("form");
    if (Object.keys(savedDraft).length) {
      setMessage("Restored your saved draft from this device.");
      setTimeout(() => setMessage(""), 3200);
    }
  };
  const backToHub = () => {
    setView("hub");
    setActiveKey(null);
    setForm({});
  };
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }));

  const schema = activeKey ? FORM_SCHEMAS[activeKey] : null;

  const submit = async () => {
    if (submitting || !schema) return;
    setSubmitting(true);
    setError("");
    // Title: first text field value, else form label.
    const firstText = schema.sections
      .flatMap((s) => s.fields)
      .find((f) => ["text"].includes(f[2]));
    const title = (form[firstText?.[0]] || schema.label).toString().trim();

    try {
      const res = await authFetch("POST", "/api/whs-forms", {
        form_type: activeKey,
        title: `${schema.label}: ${title}`,
        site: form.site || form.location || form.siteName || "",
        form_date: form.date || null,
        notifiable_flag: !!form.notifiable_flag,
        details: form,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      clearFormDraft(activeKey);
      backToHub();
      await loadHistory();
      notify(
        activeKey === "injury_incident"
          ? "Submitted - a copy has gone to admin for review."
          : activeKey === "daily_risk_assessment"
            ? "Daily Risk Assessment submitted, saved to your history and reported to administrators."
            : "Submitted and saved to your history.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };


  const renderField = ([key, label, type]) => {
    if (type === "signature_rows") {
      const rows = Array.isArray(form[key]) && form[key].length
        ? form[key]
        : [{ name: "", acknowledgement: "", signedAt: "", signature: "" }];
      const updateRow = (index, patch) => {
        const next = rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
        set(key, next);
      };
      const addRow = () => set(key, [...rows, { name: "", acknowledgement: "", signedAt: "", signature: "" }]);
      const removeRow = (index) => set(key, rows.length > 1 ? rows.filter((_, rowIndex) => rowIndex !== index) : [{ name: "", acknowledgement: "", signedAt: "", signature: "" }]);
      return (
        <section key={key} className="sf-team-signoff" aria-label={label}>
          <div className="sf-team-signoff__head">
            <div>
              <span className="sf-team-signoff__kicker">Individual acknowledgement</span>
              <strong>{label}</strong>
              <p>Each person present must record their own acknowledgement and finger or mouse signature.</p>
            </div>
            <button type="button" className="sf-team-signoff__add" onClick={addRow}>
              <Plus size={15} /> Add staff member
            </button>
          </div>
          <div className="sf-team-signoff__rows">
            {rows.map((row, index) => (
              <article className="sf-team-signoff__row" key={`${key}-${index}`}>
                <div className="sf-team-signoff__row-head">
                  <span>Staff member {index + 1}</span>
                  <button
                    type="button"
                    className="sf-team-signoff__remove"
                    onClick={() => removeRow(index)}
                    aria-label={`Remove staff member ${index + 1} sign-off`}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
                <div className="sf-team-signoff__fields">
                  <label className="sf-field">
                    <span>Name</span>
                    <input value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} placeholder="Full name" />
                  </label>
                  <label className="sf-field">
                    <span>Acknowledgement</span>
                    <select value={row.acknowledgement} onChange={(event) => updateRow(index, { acknowledgement: event.target.value })}>
                      <option value="">Select…</option>
                      <option value="I have read and understood this assessment">I have read and understood this assessment</option>
                      <option value="I have participated in the toolbox talk">I have participated in the toolbox talk</option>
                    </select>
                  </label>
                  <label className="sf-field">
                    <span>Date and time</span>
                    <input type="datetime-local" value={row.signedAt} onChange={(event) => updateRow(index, { signedAt: event.target.value })} />
                  </label>
                </div>
                <SignaturePad
                  label={`Staff member ${index + 1} signature`}
                  value={row.signature || ""}
                  onChange={(signature) => updateRow(index, { signature })}
                />
              </article>
            ))}
          </div>
        </section>
      );
    }
    if (type === "signature")
      return (
        <SignaturePad
          key={key}
          label={label}
          value={form[key] || ""}
          onChange={(v) => set(key, v)}
        />
      );
    if (type === "checkbox")
      return (
        <label key={key} className="sf-field sf-full sf-check">
          <input
            type="checkbox"
            checked={!!form[key]}
            onChange={(e) => set(key, e.target.checked)}
          />
          <span>{label}</span>
        </label>
      );
    let input;
    if (type === "textarea")
      input = (
        <textarea
          rows={2}
          value={form[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        />
      );
    else if (type === "date")
      input = (
        <input
          type="date"
          value={form[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        />
      );
    else if (type === "time")
      input = (
        <input
          type="time"
          value={form[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        />
      );
    else if (type === "number")
      input = (
        <input
          type="number"
          value={form[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        />
      );
    else if (type && type.startsWith("select:"))
      input = (
        <select
          value={form[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        >
          <option value="">Select...</option>
          {type
            .slice(7)
            .split(",")
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </select>
      );
    else
      input = (
        <input
          value={form[key] || ""}
          onChange={(e) => set(key, e.target.value)}
        />
      );
    const wide = type === "textarea";
    return (
      <label key={key} className={"sf-field" + (wide ? " sf-full" : "")}>
        <span>{label}</span>
        {input}
      </label>
    );
  };

  // ---------- HISTORY ----------
  if (view === "history") {
    const all = [
      ...whsHistory.map((w) => ({
        id: w.id,
        when: w.created_at,
        title: w.title,
        kind: w.form_type.replace(/_/g, " "),
        status: w.status,
        note: w.review_note,
      })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when));
    return (
      <div className="sf">
        <header className="sf-hero">
          <span>Ecology Consulting - Your records</span>
          <h1>Submission history</h1>
          <p>
            Every WHS form you have submitted, with its current status. Leave,
            training and equipment requests are managed in My Projects.
          </p>
        </header>
        <button className="sf-back" onClick={() => setView("hub")}>
          <ChevronLeft size={15} /> Back to forms
        </button>
        {all.length ? (
          <div className="sf-list">
            {all.map((r) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.submitted;
              return (
                <div key={r.id} className="sf-row">
                  <div className="sf-row-main">
                    <div className="sf-row-title">{r.title}</div>
                    <div className="sf-row-meta">
                      {r.kind} - {new Date(r.when).toLocaleDateString("en-AU")}
                      {r.note ? " - " + r.note : ""}
                    </div>
                  </div>
                  <span
                    className="sf-status"
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="sf-empty">Nothing submitted yet.</p>
        )}
      </div>
    );
  }

  // ---------- A FORM ----------
  if (view === "form" && schema) {
    const def = WHS_DEFINITIONS[activeKey];
    const sourceDocuments = FORM_REFERENCE_DOCS[activeKey] || [];
    return (
      <div className="sf">
        <header className="sf-hero">
          <span>
            Ecology Consulting -{" "}
            WHS field form
          </span>
          <h1>{schema.label}</h1>
          <p>{BLURBS[activeKey] || ""}</p>
        </header>
        <button className="sf-back" onClick={backToHub}>
          <ChevronLeft size={15} /> Back to forms
        </button>
        {sourceDocuments.length ? (
          <div className="sf-legis sf-reference-links">
            <ListChecks size={16} />
            <div>
              <strong>Controlled source document{sourceDocuments.length > 1 ? "s" : ""}</strong>
              <p>Use the current reference template when completing this form.</p>
              <span>
                {sourceDocuments.map((document) => (
                  <a key={document.href} href={document.href} target="_blank" rel="noreferrer">{document.label}</a>
                ))}
              </span>
            </div>
          </div>
        ) : null}
        {def ? (
          <div className="sf-legis">
            <ShieldAlert size={16} />
            <div>
              <strong>{def.title}</strong>
              <p>{def.body}</p>
              <span className="sf-legis-note">
                This summarises the model WHS Act. Follow your jurisdiction
                regulator and EC WHS procedures. If in doubt, notify your
                supervisor immediately.
              </span>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="sf-error">
            <AlertCircle size={15} /> {error}
          </p>
        ) : null}

        <div className="sf-form">
          {schema.sections.map((sec) => (
            <div key={sec.title} className="sf-section">
              <div className="sf-section-title">{sec.title}</div>
              <div className="sf-grid">{sec.fields.map(renderField)}</div>
            </div>
          ))}
          <div className="sf-draft-status" role="status">
            This form saves automatically on this device. You can switch to another app and return without losing your entries.
          </div>
          <div className="sf-actions">
            <button className="sf-submit" onClick={submit} disabled={submitting} aria-busy={submitting}>
              <Send size={14} /> {submitting ? "Submitting…" : "Submit"}
            </button>
            <button className="sf-clear-draft" type="button" onClick={() => { clearFormDraft(activeKey); setForm({}); setMessage("Saved draft cleared from this device."); }}>
              Clear saved draft
            </button>
            <button className="sf-cancel" onClick={backToHub}>
              Save &amp; close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- HUB ----------
  const byGroup = FORM_GROUPS.map((g) => ({
    label: g,
    forms: Object.entries(FORM_SCHEMAS)
      .filter(([, s]) => s.group === g && s.kind !== "request")
      .map(([key, s]) => ({ key, label: s.label, kind: s.kind })),
  })).filter((group) => group.forms.length > 0);

  return (
    <div className="sf">
      <header className="sf-hero">
        <WorkspaceNav audience="staff" />
        <span>Ecology Consulting - Staff services</span>
        <h1>WHS &amp; EC Forms</h1>
        <p>
          Field forms, WHS reports and approved internal governance in one
          place. Submissions are saved to your history and route to the
          appropriate administrator for review.
        </p>
      </header>
      {error ? (
        <p className="sf-error">
          <AlertCircle size={15} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="sf-success">
          <CheckCircle2 size={15} /> {message}
        </p>
      ) : null}
      <div className="sf-hub-actions">
        <a className="sf-service-request-link" href="/staff/service-requests">
          <CalendarDays size={15} /> Leave, training and equipment requests
        </a>
        <button className="sf-history-btn" onClick={() => setView("history")}>
          <History size={15} /> View my WHS submission history
        </button>
      </div>

      {byGroup.map((g) => (
        <section key={g.label} className="sf-group">
          <div className="sf-group-label">{g.label}</div>
          <div className="sf-cards">
            {g.forms.map((f) => {
              const m = CARD_META[f.key] || {};
              return (
                <button
                  key={f.key}
                  className="sf-card"
                  onClick={() => openForm(f.key)}
                >
                  <div
                    className="sf-card-photo"
                    style={{
                      backgroundImage: `url('/assets/${m.photo || "wattle"}.png')`,
                    }}
                  >
                    <div className="sf-card-code">
                      {m.code || ""}
                      {m.rev ? ` · ${m.rev}` : ""}
                    </div>
                    <div className="sf-card-title">{f.label}</div>
                  </div>
                  <div className="sf-card-body">
                    <p className="sf-card-desc">
                      {m.desc || BLURBS[f.key] || ""}
                    </p>
                    <div className="sf-card-foot">
                      <span className="sf-card-pill">
                        {m.status || "READY"}
                      </span>
                      <span className="sf-card-open">OPEN FORM →</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sf-doc-control">
        <div className="sf-doc-control-label">Document control</div>
        <p>
          Complete on screen, sign with your finger, then press{" "}
          <strong>Submit form</strong>. The submitted copy — signatures and all
          — lands in <strong>Admin › WHS Monitoring</strong>, where it's
          recorded for the compliance audit. Never edit a controlled template —
          request a revision through the admin portal.
        </p>
      </div>
    </div>
  );
}
