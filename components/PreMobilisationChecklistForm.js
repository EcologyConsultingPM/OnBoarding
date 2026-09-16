"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, Printer, Send, ShieldAlert } from "lucide-react";
import SignaturePad from "./SignaturePad";
import {
  CHECK_OUTCOMES,
  PRE_MOBILISATION_DOCUMENT_LABEL,
  PRE_MOBILISATION_SECTIONS,
  PRE_MOBILISATION_SOURCE_LINKS,
  VEHICLE_TYPES,
  createEmptyPreMobilisationForm,
  preMobilisationValidationMessages,
} from "../lib/preMobilisationChecklist";

const DRAFT_PREFIX = "ecology-consulting:whs-form-controlled:";
const DRAFT_TTL = 1000 * 60 * 60 * 24 * 14;

function draftKey(userId) { return `${DRAFT_PREFIX}${userId || "anonymous"}:pre_mobilisation`; }

function readDraft(userId) {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(draftKey(userId)) || "null");
    if (!saved || Date.now() - Number(saved.savedAt || 0) > DRAFT_TTL) {
      window.localStorage.removeItem(draftKey(userId));
      return null;
    }
    return saved.form && typeof saved.form === "object" ? saved.form : null;
  } catch {
    return null;
  }
}

function writeDraft(userId, form) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(userId), JSON.stringify({ savedAt: Date.now(), form }));
  } catch {
    // A privacy setting or quota failure must not stop checklist completion.
  }
}

function clearDraft(userId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(userId));
  } catch {
    // The in-memory result remains usable when storage cannot be cleared.
  }
}

function mergeDraft(draft) {
  const empty = createEmptyPreMobilisationForm();
  if (!draft || typeof draft !== "object") return empty;
  const suppliedById = new Map(Array.isArray(draft.checks) ? draft.checks.map((row) => [row?.id, row]) : []);
  return {
    ...empty,
    metadata: { ...empty.metadata, ...(draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {}) },
    checks: empty.checks.map((row) => ({ ...row, ...(suppliedById.get(row.id) || {}) })),
    conditions: { ...empty.conditions, ...(draft.conditions && typeof draft.conditions === "object" ? draft.conditions : {}) },
    approval: { ...empty.approval, ...(draft.approval && typeof draft.approval === "object" ? draft.approval : {}) },
  };
}

function FormField({ label, required, error, children, help, full = false }) {
  return (
    <label className={`pmc-field${full ? " pmc-field--full" : ""}${error ? " pmc-field--invalid" : ""}`}>
      <span className="pmc-label">{label}{required ? <abbr title="required"> *</abbr> : null}</span>
      {children}
      {help ? <small>{help}</small> : null}
      {error ? <em><AlertCircle size={13} /> {error}</em> : null}
    </label>
  );
}

function ChecklistTable({ section, checks, onRowChange, error }) {
  const rowsById = new Map(checks.map((row) => [row.id, row]));
  return (
    <section className="pmc-table-wrap" aria-labelledby={`pmc-${section.id}-title`}>
      <h3 id={`pmc-${section.id}-title`}>{section.title}</h3>
      {error ? <p className="pmc-table-error" role="alert"><AlertCircle size={14} /> {error}</p> : null}
      <div className="pmc-table-scroll">
        <table className="pmc-table">
          <thead>
            <tr><th scope="col">Ref</th><th scope="col">Check</th><th scope="col">Outcome</th><th scope="col">Corrective action / comment</th></tr>
          </thead>
          <tbody>
            {section.rows.map((definition, index) => {
              const row = rowsById.get(definition.id) || { id: definition.id, outcome: "", action: "" };
              const isFailed = row.outcome === "fail";
              return (
                <tr key={definition.id} className={isFailed ? "pmc-row--fail" : index % 2 ? "pmc-row--alt" : ""}>
                  <th scope="row" className="pmc-ref">{definition.id}</th>
                  <td>{definition.check}</td>
                  <td>
                    <fieldset className="pmc-outcomes" aria-label={`${definition.id}: ${definition.check}`}>
                      <legend className="pmc-visually-hidden">Outcome for {definition.id}</legend>
                      {CHECK_OUTCOMES.map((outcome) => (
                        <label key={outcome} className={`pmc-outcome pmc-outcome--${outcome}`}>
                          <input
                            type="radio"
                            name={`check-${definition.id}`}
                            value={outcome}
                            checked={row.outcome === outcome}
                            onChange={() => onRowChange(definition.id, { ...row, outcome })}
                          />
                          {outcome === "na" ? "N/A" : outcome[0].toUpperCase() + outcome.slice(1)}
                        </label>
                      ))}
                    </fieldset>
                  </td>
                  <td>
                    <label className="pmc-visually-hidden" htmlFor={`action-${definition.id}`}>{definition.id} corrective action or comment</label>
                    <textarea
                      id={`action-${definition.id}`}
                      rows={2}
                      maxLength={1000}
                      value={row.action || ""}
                      aria-required={isFailed}
                      placeholder={isFailed ? "Required: corrective action before resubmitting" : "Comment or action (if relevant)"}
                      onChange={(event) => onRowChange(definition.id, { ...row, action: event.target.value })}
                    />
                    {isFailed && !row.action?.trim() ? <small className="pmc-fail-required">A corrective action is required for a Fail.</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PreMobilisationChecklistForm({ authFetch, userId, onBack, onSubmitted, onToast }) {
  const [form, setForm] = useState(createEmptyPreMobilisationForm);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [errors, setErrors] = useState([]);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const errorRef = useRef(null);

  useEffect(() => {
    const draft = readDraft(userId);
    if (draft) {
      setForm(mergeDraft(draft));
      setRestoredDraft(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!submitted) writeDraft(userId, form);
  }, [form, submitted, userId]);

  const failedChecks = useMemo(() => form.checks.filter((row) => row.outcome === "fail"), [form.checks]);
  const proceedStatus = failedChecks.length ? "blocked" : "cleared";

  const setMetadata = (key, value) => setForm((current) => ({ ...current, metadata: { ...current.metadata, [key]: value } }));
  const setConditions = (key, value) => setForm((current) => ({ ...current, conditions: { ...current.conditions, [key]: value } }));
  const setApproval = (key, value) => setForm((current) => ({ ...current, approval: { ...current.approval, [key]: value } }));
  const setCheck = (id, next) => setForm((current) => ({ ...current, checks: current.checks.map((row) => row.id === id ? next : row) }));

  const validate = () => {
    const messages = preMobilisationValidationMessages({ ...form, proceedStatus });
    setErrors(messages);
    return messages;
  };

  const scrollToErrors = () => {
    window.setTimeout(() => errorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 0);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const messages = validate();
    if (messages.length) {
      setSubmitError("This controlled checklist is incomplete. Review the required items below before submitting.");
      scrollToErrors();
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    const payload = { ...form, proceedStatus };
    try {
      const response = await authFetch("POST", "/api/whs-forms", {
        form_type: "pre_mobilisation",
        title: `Pre-Mobilisation Checklist: ${form.metadata.project} — ${form.metadata.vehicleRegistration}`,
        site: form.metadata.location,
        form_date: form.metadata.date,
        notifiable_flag: false,
        details: payload,
      });
      let body = {};
      try {
        body = await response.json();
      } catch {
        // Keep the user-facing error safe and actionable if a proxy returns non-JSON.
      }
      if (!response.ok) throw new Error(body.error || "The checklist could not be submitted. Please try again.");
      clearDraft(userId);
      setSubmitted({ id: body.form?.id || null, duplicate: body.duplicate === true });
      onSubmitted?.();
      onToast?.(body.duplicate ? "This checklist was already submitted and the original record was retained." : "Pre-Mobilisation Checklist submitted.");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The checklist could not be submitted. Please try again.");
      scrollToErrors();
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    if (typeof window !== "undefined" && !window.confirm("Clear this saved Pre-Mobilisation Checklist draft?")) return;
    clearDraft(userId);
    setForm(createEmptyPreMobilisationForm());
    setErrors([]);
    setSubmitError("");
    setRestoredDraft(false);
  };

  if (submitted) {
    return (
      <div className="pmc pmc-confirm">
        <style>{PMC_CSS}</style>
        <main className="pmc-confirm-card">
          <CheckCircle2 size={36} aria-hidden="true" />
          <p className="pmc-kicker">{PRE_MOBILISATION_DOCUMENT_LABEL}</p>
          <h1>Pre-Mobilisation Checklist recorded</h1>
          <p>{submitted.duplicate ? "An identical submission was already on record, so the original checklist was retained." : "The signed checklist has been filed in your WHS submission history."}</p>
          <div className="pmc-actions">
            <button type="button" className="pmc-button pmc-button--primary" onClick={() => { setSubmitted(null); setForm(createEmptyPreMobilisationForm()); setErrors([]); }}>Start another checklist</button>
            <button type="button" className="pmc-button" onClick={onBack}><ChevronLeft size={15} /> Back to forms</button>
          </div>
        </main>
      </div>
    );
  }

  const metadataError = errors.find((message) => /project, team and vehicle/.test(message));
  const conditionsError = errors.find((message) => /pre-departure condition/.test(message));
  const rowsError = errors.find((message) => /Pass, Fail or N\/A/.test(message));
  const failActionError = errors.find((message) => /Every failed item needs/.test(message));
  const failedSummaryError = errors.find((message) => /Summarise failed/.test(message));
  const approvalError = errors.find((message) => /sign-off/.test(message));

  return (
    <div className="pmc">
      <style>{PMC_CSS}</style>
      <header className="pmc-masthead">
        <div>
          <p className="pmc-kicker">Operations · Vehicle pre-start</p>
          <h1>Pre-Mobilisation Checklist</h1>
          <p>Confirm the vehicle, emergency equipment, load and day&apos;s conditions before travel. One checklist is required for each vehicle and trip.</p>
        </div>
        <div className="pmc-doc-control"><strong>{PRE_MOBILISATION_DOCUMENT_LABEL}</strong><span>Issued September 2026 · Per journey</span></div>
      </header>

      <div className="pmc-toolbar pmc-no-print">
        <button type="button" className="pmc-button" onClick={onBack}><ChevronLeft size={15} /> Back to forms</button>
        <button type="button" className="pmc-button" onClick={reset}>Clear draft</button>
        <button type="button" className="pmc-button" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
      </div>

      <main className="pmc-main">
        <aside className="pmc-stop" role="alert">
          <ShieldAlert size={20} aria-hidden="true" />
          <div><strong>Do not proceed</strong><br />A failed vehicle, emergency equipment, fire, weather, air quality or lightning check blocks travel. Record the corrective action, report it to the Ecology Consulting Office, and obtain instruction before a new checklist is completed.</div>
        </aside>
        {restoredDraft ? <p className="pmc-draft" role="status">Your saved draft was restored from this device.</p> : null}
        {submitError ? <div ref={errorRef} className="pmc-submit-error" role="alert"><AlertCircle size={17} /><div><strong>Checklist not submitted</strong><br />{submitError}{errors.length ? <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}</div></div> : null}

        <form noValidate onSubmit={submit}>
          <section className="pmc-section" aria-labelledby="pmc-information">
            <div className="pmc-section-head"><h2 id="pmc-information">1. Information — project, team and vehicle</h2><span>Mandatory</span></div>
            <p className="pmc-hint">Complete one checklist per vehicle, per trip. Every team member travelling is recorded here; the person completing the form signs the approval section.</p>
            {metadataError ? <p className="pmc-section-error" role="alert">{metadataError}</p> : null}
            <div className="pmc-grid pmc-grid--three">
              <FormField label="Project" required><input required value={form.metadata.project} maxLength={160} onChange={(event) => setMetadata("project", event.target.value)} /></FormField>
              <FormField label="Job number" required><input required value={form.metadata.jobNumber} maxLength={80} onChange={(event) => setMetadata("jobNumber", event.target.value)} /></FormField>
              <FormField label="Location" required><input required value={form.metadata.location} maxLength={240} onChange={(event) => setMetadata("location", event.target.value)} /></FormField>
              <FormField label="Date" required><input required type="date" value={form.metadata.date} onChange={(event) => setMetadata("date", event.target.value)} /></FormField>
              <FormField label="Departure time" required><input required type="time" value={form.metadata.departureTime} onChange={(event) => setMetadata("departureTime", event.target.value)} /></FormField>
              <FormField label="Expected return" required><input required type="time" value={form.metadata.expectedReturnTime} onChange={(event) => setMetadata("expectedReturnTime", event.target.value)} /></FormField>
              <FormField label="Team member completing this form" required><input required value={form.metadata.completedBy} maxLength={120} onChange={(event) => setMetadata("completedBy", event.target.value)} /></FormField>
              <FormField label="Additional field staff travelling"><input value={form.metadata.additionalStaff} maxLength={1000} onChange={(event) => setMetadata("additionalStaff", event.target.value)} /></FormField>
              <FormField label="Communication Officer notified" required help="Record the name and time notified."><input required value={form.metadata.communicationOfficer} maxLength={160} onChange={(event) => setMetadata("communicationOfficer", event.target.value)} /></FormField>
              <FormField label="Vehicle registration" required><input required value={form.metadata.vehicleRegistration} maxLength={32} onChange={(event) => setMetadata("vehicleRegistration", event.target.value)} /></FormField>
              <FormField label="Vehicle type" required><select required value={form.metadata.vehicleType} onChange={(event) => setMetadata("vehicleType", event.target.value)}><option value="">Select…</option>{VEHICLE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></FormField>
              <FormField label="Odometer at departure" required><input required inputMode="numeric" value={form.metadata.odometer} maxLength={32} onChange={(event) => setMetadata("odometer", event.target.value)} /></FormField>
              <FormField label="Vehicle log book completed" required help="Required for a company vehicle."><select required value={form.metadata.vehicleLogBook} onChange={(event) => setMetadata("vehicleLogBook", event.target.value)}><option value="">Select…</option><option value="Yes">Yes</option><option value="No">No</option><option value="N/A">N/A</option></select></FormField>
            </div>
          </section>

          <section className="pmc-section" aria-labelledby="pmc-inspection">
            <div className="pmc-section-head"><h2 id="pmc-inspection">2. Pre-operational vehicle inspection</h2><span>Mandatory</span></div>
            <div className="pmc-inspection-notes">
              <p><strong>Vehicle positioning</strong>Park on a level surface, engage the parking brake and turn off the engine.</p>
              <p><strong>Safety precautions</strong>Assess surrounding hazards before inspection; chock wheels if necessary.</p>
              <p><strong>Inspection procedure</strong>Complete each check thoroughly. Refer to the manufacturer handbook, the Ecology Consulting Office or a qualified mechanic if unsure. Only visually inspect electrical items; do not handle exposed wiring.</p>
              <p><strong>Reporting deficiencies</strong>If an item fails, do not operate the vehicle. Tag out the faulty vehicle and report the issue to the Ecology Consulting Office for instruction.</p>
            </div>
          </section>

          <section className="pmc-section" aria-labelledby="pmc-checks">
            <div className="pmc-section-head"><h2 id="pmc-checks">3–6. Controlled checklist</h2><span>Mandatory</span></div>
            <p className="pmc-hint">Choose exactly one outcome for every row. <strong>Fail requires a row-specific corrective action and blocks proceeding.</strong> N/A is only for an item that is not applicable to this trip or vehicle.</p>
            {rowsError ? <p className="pmc-section-error" role="alert">{rowsError}</p> : null}
            {failActionError ? <p className="pmc-section-error" role="alert">{failActionError}</p> : null}
            {PRE_MOBILISATION_SECTIONS.map((section) => <ChecklistTable key={section.id} section={section} checks={form.checks} onRowChange={setCheck} error={null} />)}
            <div className={proceedStatus === "blocked" ? "pmc-proceed pmc-proceed--blocked" : "pmc-proceed pmc-proceed--cleared"} role="status" aria-live="polite">
              <strong>{proceedStatus === "blocked" ? "PROCEEDING BLOCKED" : "NO FAILS RECORDED"}</strong>
              <span>{proceedStatus === "blocked" ? `${failedChecks.map((row) => row.id).join(", ")} failed. Do not proceed; notify the Office and complete the corrective action record.` : "Submission remains unavailable until every required row and field is complete."}</span>
            </div>
          </section>

          <section className="pmc-section" aria-labelledby="pmc-conditions">
            <div className="pmc-section-head"><h2 id="pmc-conditions">7. Conditions recorded and source links</h2></div>
            <p className="pmc-hint">Record the actual ratings you read and where you read them. These fields are evidence that the pre-departure check occurred today.</p>
            {conditionsError ? <p className="pmc-section-error" role="alert">{conditionsError}</p> : null}
            <div className="pmc-grid pmc-grid--two">
              <FormField label="Weather conditions" required full><textarea required rows={4} value={form.conditions.weatherConditions} maxLength={2000} placeholder="Forecast, temperature range, wind, rain and warnings for the project location." onChange={(event) => setConditions("weatherConditions", event.target.value)} /></FormField>
              <FormField label="Comments" full><textarea rows={4} value={form.conditions.comments} maxLength={2000} placeholder="Changes to the plan, delayed start, revised route or additional controls." onChange={(event) => setConditions("comments", event.target.value)} /></FormField>
              <FormField label="Fire Danger Rating" required help="Record rating and district, including any Total Fire Ban."><input required value={form.conditions.fireDangerRating} maxLength={240} onChange={(event) => setConditions("fireDangerRating", event.target.value)} /></FormField>
              <FormField label="Air Quality Rating" required help="Record AQI category and region."><input required value={form.conditions.airQualityRating} maxLength={240} onChange={(event) => setConditions("airQualityRating", event.target.value)} /></FormField>
              <FormField label="Lightning / storm activity" required help="Record radar review and activity within 30 km."><input required value={form.conditions.lightningStormActivity} maxLength={240} onChange={(event) => setConditions("lightningStormActivity", event.target.value)} /></FormField>
              <FormField label="Live traffic / route status" required><input required value={form.conditions.liveTrafficRouteStatus} maxLength={500} onChange={(event) => setConditions("liveTrafficRouteStatus", event.target.value)} /></FormField>
              <FormField label="Mobile coverage on route" required><input required value={form.conditions.mobileCoverage} maxLength={500} onChange={(event) => setConditions("mobileCoverage", event.target.value)} /></FormField>
            </div>
            <h3 className="pmc-source-title">Important sources — bookmark before leaving coverage</h3>
            <ul className="pmc-sources">
              {PRE_MOBILISATION_SOURCE_LINKS.map((source) => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer">{source.label}</a><span>{source.purpose}</span></li>)}
            </ul>
          </section>

          <section className="pmc-section" aria-labelledby="pmc-approval">
            <div className="pmc-section-head"><h2 id="pmc-approval">8. Approval</h2><span>Mandatory</span></div>
            <p className="pmc-hint">The person completing the checklist signs on screen. Any failed item must be recorded and reported to the Office before departure.</p>
            {approvalError ? <p className="pmc-section-error" role="alert">{approvalError}</p> : null}
            <div className="pmc-grid pmc-grid--two">
              <FormField label="Name" required><input required value={form.approval.name} maxLength={120} onChange={(event) => setApproval("name", event.target.value)} /></FormField>
              <FormField label="Position" required><input required value={form.approval.position} maxLength={120} onChange={(event) => setApproval("position", event.target.value)} /></FormField>
              <FormField label="Date and time" required><input required type="datetime-local" value={form.approval.signedAt} onChange={(event) => setApproval("signedAt", event.target.value)} /></FormField>
              <div className="pmc-signature-field">
                <span className="pmc-label">Signature <abbr title="required">*</abbr></span>
                <SignaturePad label="Sign with your finger or mouse" value={form.approval.signature} onChange={(signature) => setApproval("signature", signature)} />
              </div>
              <FormField label="Failed items and action taken" required={failedChecks.length > 0} error={failedSummaryError} full help="For each Fail, list the item, who was notified at the Office and the instruction received."><textarea rows={4} value={form.approval.failedItemsAction} maxLength={4000} placeholder={failedChecks.length ? "Required: failed items, Office notification and instruction received." : "Record any fail, Office notification and instruction received."} onChange={(event) => setApproval("failedItemsAction", event.target.value)} /></FormField>
            </div>
          </section>

          <div className="pmc-submit-area pmc-no-print">
            <p><strong>{proceedStatus === "blocked" ? "Proceeding is blocked." : "Complete every required field to submit."}</strong> Submission stores the controlled revision and signed image with the WHS record.</p>
            <button className="pmc-button pmc-button--primary" type="submit" disabled={submitting} aria-busy={submitting}><Send size={15} /> {submitting ? "Submitting…" : "Submit checklist"}</button>
          </div>
        </form>
      </main>
      <footer className="pmc-footer">Ecology Consulting · {PRE_MOBILISATION_DOCUMENT_LABEL} · Controlled document · Complete, sign, print or save as PDF, then file to the project record.</footer>
    </div>
  );
}

const PMC_CSS = `
.pmc{--ink:#12211a;--muted:#617068;--line:#d8d5c9;--paper:#fdfbf6;--wash:#f4f2fb;--accent:#6b5bb0;--accent-dark:#4a3d87;--danger:#a9342c;--danger-wash:#fff1ef;--success:#216a43;--success-wash:#ecf8ef;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-family:Arial,sans-serif;line-height:1.5}.pmc *{box-sizing:border-box}.pmc-masthead{display:flex;justify-content:space-between;gap:24px;padding:28px 32px 24px;background:var(--wash);border-top:5px solid var(--accent);border-bottom:1px solid var(--line)}.pmc-kicker{margin:0 0 7px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--accent-dark)}.pmc h1{margin:0;font-family:Georgia,serif;font-size:34px;line-height:1.1}.pmc-masthead p:not(.pmc-kicker){max-width:720px;margin:10px 0 0;color:#415048}.pmc-doc-control{min-width:190px;text-align:right;font-size:12px;color:var(--muted)}.pmc-doc-control strong{display:block;color:var(--accent-dark);font-size:12px;letter-spacing:.06em}.pmc-doc-control span{display:block;margin-top:4px}.pmc-toolbar,.pmc-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.pmc-toolbar{padding:12px 32px;border-bottom:1px solid var(--line);background:#fbf8f1}.pmc-main{padding:24px 32px 30px}.pmc-stop,.pmc-submit-error{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:1px solid #e4aaa4;border-left:4px solid var(--danger);border-radius:8px;background:var(--danger-wash);color:#722a24;margin-bottom:16px}.pmc-stop strong{font-size:16px}.pmc-draft{padding:9px 12px;background:#eef7fc;border:1px solid #b5d5e5;border-radius:7px;color:#23516a}.pmc-submit-error ul{margin:7px 0 0;padding-left:18px}.pmc-section{margin-top:18px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}.pmc-section-head{display:flex;gap:10px;align-items:center;padding:12px 17px;background:var(--wash);border-left:4px solid var(--accent);border-bottom:1px solid var(--line)}.pmc-section-head h2{flex:1;margin:0;font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-dark)}.pmc-section-head span{padding:3px 7px;border-radius:4px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.pmc-hint{margin:15px 17px;color:#435248;font-size:13px}.pmc-section-error,.pmc-table-error{margin:0 17px 13px;color:var(--danger);font-weight:700;font-size:13px}.pmc-grid{display:grid;gap:14px;padding:0 17px 18px}.pmc-grid--three{grid-template-columns:repeat(3,minmax(0,1fr))}.pmc-grid--two{grid-template-columns:repeat(2,minmax(0,1fr))}.pmc-field{display:flex;flex-direction:column;gap:5px;min-width:0}.pmc-field--full{grid-column:1/-1}.pmc-label{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.pmc-label abbr{text-decoration:none;color:var(--danger)}.pmc-field input,.pmc-field select,.pmc-field textarea,.pmc-table textarea{width:100%;border:1px solid #cfcbbb;border-radius:6px;padding:9px 10px;color:var(--ink);font:inherit;background:#fff}.pmc-field textarea,.pmc-table textarea{resize:vertical}.pmc-field input:focus,.pmc-field select:focus,.pmc-field textarea:focus,.pmc-table textarea:focus{outline:3px solid rgba(107,91,176,.18);border-color:var(--accent)}.pmc-field small,.pmc-fail-required{font-size:11px;color:var(--muted)}.pmc-field em{display:flex;gap:4px;align-items:center;color:var(--danger);font-size:12px;font-style:normal}.pmc-inspection-notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0 17px 18px}.pmc-inspection-notes p{margin:0;padding:11px 12px;border-left:3px solid var(--accent);background:#faf9fd;font-size:13px}.pmc-inspection-notes strong{display:block;margin-bottom:3px;color:var(--accent-dark);font-size:11px;text-transform:uppercase;letter-spacing:.06em}.pmc-table-wrap{margin:17px}.pmc-table-wrap h3,.pmc-source-title{margin:0;padding:9px 12px;border:1px solid var(--line);border-bottom:0;border-radius:7px 7px 0 0;background:var(--wash);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-dark)}.pmc-table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:0 0 7px 7px}.pmc-table{width:100%;min-width:790px;border-collapse:collapse;font-size:13px}.pmc-table th,.pmc-table td{padding:9px 10px;text-align:left;vertical-align:top;border-top:1px solid #e8e4d8}.pmc-table thead th{border-top:0;background:var(--accent);color:#fff;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.pmc-table .pmc-ref{width:54px;color:var(--accent-dark);font-size:12px}.pmc-row--alt td,.pmc-row--alt .pmc-ref{background:#fdfbf7}.pmc-row--fail td,.pmc-row--fail .pmc-ref{background:var(--danger-wash)}.pmc-outcomes{display:flex;flex-wrap:wrap;gap:5px;min-width:184px;border:0;padding:0;margin:0}.pmc-outcome{display:inline-flex;gap:4px;align-items:center;padding:5px 6px;border:1px solid #cbc7ba;border-radius:5px;background:#fff;font-size:11px;cursor:pointer}.pmc-outcome input{accent-color:var(--accent);margin:0}.pmc-outcome--fail{border-color:#d99d98}.pmc-fail-required{display:block;margin-top:4px;color:var(--danger);font-weight:700}.pmc-proceed{display:flex;flex-direction:column;gap:3px;margin:17px;padding:13px 15px;border-radius:7px;border:1px solid}.pmc-proceed strong{font-size:12px;letter-spacing:.08em}.pmc-proceed span{font-size:13px}.pmc-proceed--blocked{border-color:#dfaaa4;background:var(--danger-wash);color:#7a2821}.pmc-proceed--cleared{border-color:#a9d1b7;background:var(--success-wash);color:var(--success)}.pmc-source-title{margin:0 17px}.pmc-sources{margin:0 17px 18px;padding:0;list-style:none;border:1px solid var(--line);border-radius:0 0 7px 7px}.pmc-sources li{display:flex;gap:12px;padding:9px 11px;border-top:1px solid #e8e4d8;font-size:13px}.pmc-sources li:first-child{border-top:0}.pmc-sources a{min-width:225px;color:var(--accent-dark);font-weight:700}.pmc-sources span{color:var(--muted)}.pmc-signature-field{display:flex;flex-direction:column;gap:5px}.pmc-signature-field .sig{margin:0}.pmc-signature-field .sig-label{display:none}.pmc-signature-field .sig-wrap{min-height:126px}.pmc-submit-area{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-top:18px;padding:15px 17px;border:1px solid var(--line);border-radius:9px;background:#fbf9f4}.pmc-submit-area p{margin:0;color:var(--muted);font-size:13px}.pmc-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #bdb8aa;border-radius:7px;padding:9px 12px;background:#fff;color:#34443a;font:600 13px Arial,sans-serif;cursor:pointer}.pmc-button:hover{border-color:var(--accent);color:var(--accent-dark)}.pmc-button:focus-visible{outline:3px solid rgba(107,91,176,.3);outline-offset:2px}.pmc-button:disabled{opacity:.62;cursor:wait}.pmc-button--primary{border-color:var(--accent);background:var(--accent);color:#fff}.pmc-button--primary:hover{background:var(--accent-dark);color:#fff}.pmc-footer{padding:15px 32px;border-top:4px solid var(--accent);background:var(--wash);font-size:11px;color:var(--muted)}.pmc-confirm{min-height:360px;display:grid;place-items:center;padding:24px}.pmc-confirm-card{max-width:560px;text-align:center}.pmc-confirm-card>svg{color:var(--success)}.pmc-confirm-card h1{font-size:28px;margin:8px 0}.pmc-confirm-card p:not(.pmc-kicker){color:var(--muted)}.pmc-confirm-card .pmc-actions{justify-content:center;margin-top:20px}.pmc-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:800px){.pmc-masthead{padding:22px 20px;display:block}.pmc-doc-control{text-align:left;margin-top:15px}.pmc-toolbar,.pmc-main,.pmc-footer{padding-left:20px;padding-right:20px}.pmc-grid--three,.pmc-grid--two,.pmc-inspection-notes{grid-template-columns:1fr}.pmc-sources li{display:block}.pmc-sources a{display:block;min-width:0;margin-bottom:3px}.pmc-submit-area{display:block}.pmc-submit-area .pmc-button{width:100%;margin-top:12px}}@media print{.pmc{border:0;border-radius:0}.pmc-no-print{display:none!important}.pmc-main{padding:12px}.pmc-section{break-inside:avoid}.pmc-table-wrap{break-inside:avoid}.pmc-masthead{padding:14px}.pmc h1{font-size:28px}.pmc-footer{padding:10px}.pmc-table{min-width:0;font-size:9px}.pmc-table th,.pmc-table td{padding:4px}.pmc-table-scroll{overflow:visible}.pmc-outcome{padding:2px;font-size:9px}.pmc-table textarea{min-height:28px;padding:3px}.pmc-signature-field .sig-wrap{min-height:82px}}
`;

export { PMC_CSS };
