"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ClipboardCheck, Save, Send } from "lucide-react";
import SignaturePad from "./SignaturePad";
import { OFFICE_RISK_CHECKLIST, OFFICE_RISK_ITEM_IDS } from "../lib/officeRiskChecklist";
import { OFFICE_RISK_STYLE } from "../lib/officeRiskStyles";

const DRAFT_PREFIX = "ecology-consulting:whs-form:office_risk_assessment";
const DRAFT_TTL = 1000 * 60 * 60 * 24 * 14;
const ANSWERS = ["yes", "no"];

function draftKey(userId) {
  return `${DRAFT_PREFIX}:${userId || "anonymous"}`;
}

function emptyChecks() {
  return Object.fromEntries(
    OFFICE_RISK_ITEM_IDS.map((id) => [id, { injuryRisk: "", actionRequired: "", notes: "" }]),
  );
}

function initialForm() {
  return {
    version: 2,
    area: "",
    assessedBy: "",
    date: "",
    reviewDate: "",
    manager: "",
    workersConsulted: "",
    checks: emptyChecks(),
    signature: "",
    signedAt: "",
  };
}

function readDraft(userId) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(draftKey(userId)) || "null");
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > DRAFT_TTL) {
      window.localStorage.removeItem(draftKey(userId));
      return null;
    }
    const saved = parsed.form;
    if (!saved || typeof saved !== "object") return null;
    return {
      ...initialForm(),
      ...saved,
      version: 2,
      checks: { ...emptyChecks(), ...(saved.checks || {}) },
    };
  } catch {
    return null;
  }
}

function writeDraft(userId, form) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(userId), JSON.stringify({ savedAt: Date.now(), form }));
  } catch {
    // The in-memory assessment remains usable when browser storage is unavailable.
  }
}

function clearDraft(userId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(userId));
  } catch {}
}

function Choice({ checked, label, onClick, tone }) {
  return (
    <button
      type="button"
      className={`ora-choice ora-choice--${tone}${checked ? " is-selected" : ""}`}
      aria-pressed={checked}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function OfficeRiskAssessmentForm({ authFetch, userId, onBack, onSubmitted, onToast }) {
  const [form, setForm] = useState(initialForm);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set(["A"]));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  const completedCount = useMemo(
    () => OFFICE_RISK_ITEM_IDS.filter((id) => {
      const item = form.checks[id] || {};
      return ANSWERS.includes(item.injuryRisk) && ANSWERS.includes(item.actionRequired);
    }).length,
    [form.checks],
  );

  useEffect(() => {
    const saved = readDraft(userId);
    if (saved) {
      setForm(saved);
      setRestoredDraft(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!submitted) writeDraft(userId, form);
  }, [form, submitted, userId]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateCheck = (id, patch) => setForm((current) => ({
    ...current,
    checks: { ...current.checks, [id]: { ...(current.checks[id] || {}), ...patch } },
  }));

  const validate = () => {
    const next = {};
    if (!form.area.trim()) next.area = "Enter the office or home-work area assessed.";
    if (!form.assessedBy.trim()) next.assessedBy = "Enter the assessor’s name.";
    if (!form.date) next.date = "Enter the assessment date.";
    const incomplete = OFFICE_RISK_ITEM_IDS.filter((id) => {
      const item = form.checks[id] || {};
      return !ANSWERS.includes(item.injuryRisk) || !ANSWERS.includes(item.actionRequired);
    });
    if (incomplete.length) next.checks = `${incomplete.length} check${incomplete.length === 1 ? "" : "s"} still need both Yes or No choices.`;
    if (!form.signature) next.signature = "Sign the assessment before submitting.";
    return next;
  };

  const submit = async () => {
    if (submitting) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      document.getElementById(nextErrors.checks ? "ora-checklist" : "ora-details")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await authFetch("POST", "/api/whs-forms", {
        form_type: "office_risk_assessment",
        title: `Office Risk Assessment: ${form.area}`,
        site: form.area,
        form_date: form.date,
        notifiable_flag: false,
        details: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The assessment could not be submitted.");
      clearDraft(userId);
      setSubmitted(data.form || { id: data.id });
      onSubmitted?.();
      onToast?.("Office Risk Assessment submitted to WHS Monitoring.");
    } catch (error) {
      setErrors({ submit: error.message || "The assessment could not be submitted." });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section className="ora ora-confirm" aria-live="polite">
        <style>{OFFICE_RISK_STYLE}</style>
        <CheckCircle2 size={34} />
        <p className="ora-kicker">Submitted</p>
        <h1>Office Risk Assessment recorded</h1>
        <p>Your completed assessment has been saved to your submission history and the WHS Monitoring register.</p>
        <div className="ora-actions">
          <button type="button" className="ora-button ora-button--secondary" onClick={onBack}><ChevronLeft size={16} /> Back to forms</button>
          <button type="button" className="ora-button" onClick={() => { setForm(initialForm()); setSubmitted(null); setErrors({}); }}>Start another assessment</button>
        </div>
      </section>
    );
  }

  return (
    <section className="ora" aria-labelledby="ora-title">
      <style>{OFFICE_RISK_STYLE}</style>
      <button type="button" className="ora-back" onClick={onBack}><ChevronLeft size={16} /> Back to WHS &amp; EC Forms</button>
      <header className="ora-hero">
        <div><span>EC-WHS-ORA-001 · Rev 2</span><h1 id="ora-title">Office Risk Assessment</h1><p>A plain-English check for office and home-work areas. Answer every item based on what you can see; no equipment or technical measurements are needed.</p></div>
        <ClipboardCheck aria-hidden="true" size={32} />
      </header>
      {restoredDraft ? <p className="ora-notice ora-notice--info"><CheckCircle2 size={16} /> Restored your saved draft from this device.</p> : null}
      {errors.submit ? <p className="ora-notice ora-notice--error"><AlertCircle size={16} /> {errors.submit}</p> : null}

      <section className="ora-section" id="ora-details">
        <header><span>1</span><div><h2>Assessment details</h2><p>Record the space and the people involved.</p></div></header>
        <div className="ora-body ora-details-grid">
          <label>Office or home-work area<input value={form.area} onChange={(event) => set("area", event.target.value)} placeholder="e.g. Crookwell office — Level 1" /></label>
          <label>Assessed by<input value={form.assessedBy} onChange={(event) => set("assessedBy", event.target.value)} placeholder="Full name" /></label>
          <label>Date<input type="date" value={form.date} onChange={(event) => set("date", event.target.value)} /></label>
          <label>Review date <small>(optional)</small><input type="date" value={form.reviewDate} onChange={(event) => set("reviewDate", event.target.value)} /></label>
          <label>Manager or supervisor <small>(optional)</small><input value={form.manager} onChange={(event) => set("manager", event.target.value)} /></label>
          <label>Workers consulted <small>(optional)</small><input value={form.workersConsulted} onChange={(event) => set("workersConsulted", event.target.value)} /></label>
        </div>
        {errors.area || errors.assessedBy || errors.date ? <p className="ora-error"><AlertCircle size={15} /> Complete the required assessment details before submitting.</p> : null}
      </section>

      <section className="ora-section" id="ora-checklist">
        <header><span>2</span><div><h2>Office safety check</h2><p>For every check, answer two simple questions. “Yes” means there is a possible injury risk or an action is required; add a note when it helps explain the response.</p></div><strong className="ora-progress">{completedCount} / {OFFICE_RISK_ITEM_IDS.length} complete</strong></header>
        <div className="ora-body">
          {errors.checks ? <p className="ora-error"><AlertCircle size={15} /> {errors.checks}</p> : null}
          <div className="ora-guide"><b>Could this issue injure someone?</b> Choose Yes or No. <b>Does someone need to fix or improve it?</b> Choose Yes or No. If you cannot tell whether something is safe, choose Yes and add a note for review.</div>
          {OFFICE_RISK_CHECKLIST.map((category) => {
            const isExpanded = expanded.has(category.id);
            const complete = category.items.filter((item) => {
              const check = form.checks[item.id] || {};
              return ANSWERS.includes(check.injuryRisk) && ANSWERS.includes(check.actionRequired);
            }).length;
            return (
              <article className="ora-category" key={category.id}>
                <button type="button" className="ora-category-head" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })} aria-expanded={isExpanded}>
                  <span>{category.id}</span><strong>{category.title}</strong><small>{complete} / {category.items.length} complete</small><i>{isExpanded ? "−" : "+"}</i>
                </button>
                {isExpanded ? <div className="ora-category-body">
                  {category.items.map((item) => {
                    const check = form.checks[item.id] || {};
                    return <article className="ora-item" key={item.id}>
                      <div className="ora-item-title"><span>{item.id}</span><p>{item.label.replace(/\s*\([^)]*(?:lux|AS\/NZS)[^)]*\)/gi, "")}</p></div>
                      <div className="ora-question"><b>Could this issue injure someone?</b><div><Choice label="Yes" tone="risk" checked={check.injuryRisk === "yes"} onClick={() => updateCheck(item.id, { injuryRisk: "yes" })} /><Choice label="No" tone="safe" checked={check.injuryRisk === "no"} onClick={() => updateCheck(item.id, { injuryRisk: "no" })} /></div></div>
                      <div className="ora-question"><b>Does someone need to fix or improve it?</b><div><Choice label="Yes" tone="action" checked={check.actionRequired === "yes"} onClick={() => updateCheck(item.id, { actionRequired: "yes" })} /><Choice label="No" tone="safe" checked={check.actionRequired === "no"} onClick={() => updateCheck(item.id, { actionRequired: "no" })} /></div></div>
                      <label className="ora-note">Note or action <small>(optional)</small><textarea rows={2} value={check.notes || ""} onChange={(event) => updateCheck(item.id, { notes: event.target.value })} placeholder="What did you notice, or what needs to happen?" /></label>
                    </article>;
                  })}
                </div> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="ora-section">
        <header><span>3</span><div><h2>Sign-off</h2><p>Confirm this reflects what was checked today.</p></div></header>
        <div className="ora-body">
          <SignaturePad label="Assessor signature — sign with your finger or mouse" value={form.signature} onChange={(signature) => set("signature", signature)} />
          <label className="ora-signed-date">Signed date <small>(optional)</small><input type="date" value={form.signedAt} onChange={(event) => set("signedAt", event.target.value)} /></label>
          {errors.signature ? <p className="ora-error"><AlertCircle size={15} /> {errors.signature}</p> : null}
        </div>
      </section>

      <div className="ora-submit">
        <p>Your draft saves on this device while you work. Submit only when every category is complete.</p>
        <button type="button" className="ora-button ora-button--secondary" onClick={() => { writeDraft(userId, form); onToast?.("Office Risk Assessment draft saved on this device."); }}><Save size={16} /> Save draft</button>
        <button type="button" className="ora-button" disabled={submitting} onClick={submit}><Send size={16} /> {submitting ? "Submitting…" : "Submit assessment"}</button>
      </div>
    </section>
  );
}

const LEGACY_ORA_CSS = `
.ora{max-width:1040px;margin:0 auto;padding:24px 18px 70px;color:#153122;font:14px/1.5 Arial,Helvetica,sans-serif}.ora *{box-sizing:border-box}.ora-back{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;padding:6px 0 14px;color:#235c3e;font:700 13px inherit;cursor:pointer}.ora-hero{display:flex;justify-content:space-between;gap:18px;padding:24px;border:1px solid #b9d6c0;border-radius:15px 15px 0 0;color:#fffdf4;background:linear-gradient(120deg,#083b27,#1c6843)}.ora-hero>svg{color:#f0cd6d;flex:0 0 auto}.ora-hero span,.ora-kicker{color:#f0cd6d;font:800 10px/1 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase}.ora h1{margin:8px 0 6px;font:400 clamp(27px,4vw,38px)/1.05 Georgia,serif}.ora-hero p{max-width:720px;margin:0;color:#e0eadc}.ora-notice,.ora-error,.ora-guide{display:flex;align-items:flex-start;gap:8px;margin:14px 0;padding:11px 13px;border-radius:9px;font-size:13px;line-height:1.45}.ora-notice--info{border:1px solid #a6cdb4;background:#ebf7ed;color:#235a38}.ora-notice--error,.ora-error{border:1px solid #e4a29a;background:#fff0ee;color:#812b23}.ora-section{margin:14px 0;border:1px solid #c7dac9;border-radius:13px;overflow:hidden;background:#fffefa;box-shadow:0 8px 25px -22px rgba(5,48,30,.55)}.ora-section>header{display:flex;align-items:flex-start;gap:11px;padding:13px 16px;border-bottom:1px solid #dbe7dc;background:#eff7f0}.ora-section>header>span{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;border-radius:7px;color:#fff;background:#1d7044;font-weight:800}.ora-section h2{margin:0;color:#183d29;font:700 17px/1.2 Arial,Helvetica,sans-serif}.ora-section header p{margin:3px 0 0;color:#546d5b;font-size:12px}.ora-progress{margin-left:auto;white-space:nowrap;color:#6d591c;font-size:12px}.ora-body{padding:16px}.ora-details-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.ora-details-grid label,.ora-note,.ora-signed-date{display:grid;gap:5px;color:#34523e;font-size:11px;font-weight:800;letter-spacing:.025em}.ora label small{font-weight:500;letter-spacing:0;color:#637866}.ora input,.ora textarea{width:100%;border:1px solid #aebfac;border-radius:8px;padding:10px 11px;color:#143020;background:#fff;font:14px/1.4 Arial,Helvetica,sans-serif}.ora textarea{resize:vertical;min-height:64px}.ora input:focus-visible,.ora textarea:focus-visible,.ora button:focus-visible{outline:3px solid rgba(196,149,46,.55);outline-offset:2px}.ora-guide{display:block;margin-top:0;border:1px solid #e6d49a;border-left:4px solid #b98821;background:#fff9e9;color:#554515}.ora-category{margin-top:10px;border:1px solid #cbdccc;border-radius:10px;overflow:hidden}.ora-category-head{display:grid;grid-template-columns:30px minmax(0,1fr) auto 20px;gap:9px;align-items:center;width:100%;padding:12px;border:0;color:#173e29;background:#f6faf5;text-align:left;font:inherit;cursor:pointer}.ora-category-head>span{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;color:#fff;background:#175e3a;font-weight:800}.ora-category-head strong{font-size:13px}.ora-category-head small{color:#617864;font-size:11px}.ora-category-head i{font-style:normal;font-size:21px;line-height:1;color:#386d4a}.ora-category-body{padding:10px;background:#fff}.ora-item{display:grid;grid-template-columns:minmax(220px,1.35fr) minmax(175px,.85fr) minmax(195px,1fr);gap:12px;align-items:start;padding:13px 8px;border-bottom:1px solid #e2ebe2}.ora-item:last-child{border-bottom:0}.ora-item-title{display:flex;gap:8px}.ora-item-title>span{flex:0 0 auto;color:#755e18;font:800 10px/1.5 "IBM Plex Mono",monospace}.ora-item-title p{margin:0;color:#223b2c;font-size:13px;line-height:1.42}.ora-question{display:grid;gap:7px}.ora-question b{color:#41624d;font-size:10.5px;line-height:1.25}.ora-question>div{display:flex;gap:6px}.ora-choice{min-height:38px;flex:1;border:1px solid #b9c9b9;border-radius:7px;background:#fff;color:#36523e;font:800 12px Arial,Helvetica,sans-serif;cursor:pointer}.ora-choice--risk.is-selected,.ora-choice--action.is-selected{border-color:#b24b37;background:#fff0eb;color:#822a1d}.ora-choice--safe.is-selected{border-color:#2e7749;background:#eaf6eb;color:#205d36}.ora-note{grid-column:2/-1}.ora-submit{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:18px;padding:15px;border:1px solid #cadaca;border-radius:12px;background:#eef6ef}.ora-submit p{flex:1 1 280px;margin:0;color:#4b6854;font-size:12px}.ora-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;border:1px solid #16623d;border-radius:8px;padding:10px 14px;color:#fff;background:#176640;font:800 13px Arial,Helvetica,sans-serif;cursor:pointer}.ora-button:disabled{opacity:.65;cursor:wait}.ora-button--secondary{color:#175c39;background:#fff}.ora-confirm{max-width:700px;margin-top:36px;border:1px solid #c9dccb;border-radius:15px;padding:32px;text-align:center;background:#fffefa}.ora-confirm>svg{color:#267a45}.ora-confirm h1{color:#1d4f33}.ora-confirm p{color:#58705d}.ora-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px}@media(max-width:820px){.ora-details-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ora-item{grid-template-columns:1fr 1fr}.ora-item-title{grid-column:1/-1}.ora-note{grid-column:1/-1}}@media(max-width:560px){.ora{padding:16px 10px 50px}.ora-hero{padding:19px}.ora-hero>svg{display:none}.ora-details-grid,.ora-item{grid-template-columns:1fr}.ora-section>header{padding:12px}.ora-progress{margin-left:0;grid-column:2}.ora-section>header{flex-wrap:wrap}.ora-category-head{grid-template-columns:28px minmax(0,1fr) 18px}.ora-category-head small{grid-column:2;color:#6b806e}.ora-category-head i{grid-row:1/3;grid-column:3}.ora-question>div{gap:8px}.ora-choice{min-height:44px}.ora-submit{align-items:stretch;flex-direction:column}.ora-submit .ora-button{width:100%}}@media print{.ora-back,.ora-submit,.ora-category-head i{display:none!important}.ora{padding:0;color:#000}.ora-section{break-inside:avoid;box-shadow:none}.ora-category-body{display:block!important}.ora-item{grid-template-columns:1fr 1fr}.ora-note{grid-column:1/-1}}
`;
