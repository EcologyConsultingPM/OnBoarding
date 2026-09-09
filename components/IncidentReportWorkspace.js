"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardList, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const initialForm = {
  organisation: "", siteLocation: "", incidentDate: "", incidentTime: "", reportDate: "",
  reportedBy: "", supervisorNotified: "", supervisorContact: "",
  severityRating: "", investigationTarget: "", notifiable: "", safeworkReference: "",
  scenePreserved: "", notifiedDatetime: "",
  personName: "", personDob: "", personPosition: "", employmentType: "", employerCompany: "",
  yearsExperience: "", yearsWithOrg: "",
  injuryNature: "", bodyParts: "", medicalTreatment: "",
  taskPerformed: "", exactLocation: "", environmentalConditions: "", incidentDescription: "",
};

const INCIDENT_TYPES = ["Injury", "Illness", "Near miss", "Property damage", "Environmental", "Dangerous incident", "Security"];
const SEVERITY = ["Minor", "Moderate", "Serious", "Major", "Critical"];

const blankWitness = { name: "", contact: "", type: "", statement: "" };
const blankAction = { action: "", responsible: "", dateCompleted: "" };
const blankSignoff = { role: "", name: "", signature: "", date: "" };

const defaultSignoff = [
  { role: "Reporting Worker / Person", name: "", signature: "", date: "" },
  { role: "Supervisor / Manager", name: "", signature: "", date: "" },
  { role: "WHS Manager", name: "", signature: "", date: "" },
];

export default function IncidentReportWorkspace() {
  const { session, loading } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [incidentTypes, setIncidentTypes] = useState([]);
  const [witnesses, setWitnesses] = useState([{ ...blankWitness }]);
  const [actions, setActions] = useState([{ ...blankAction }]);
  const [signoff, setSignoff] = useState(defaultSignoff.map((row) => ({ ...row })));
  const [reportId, setReportId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const toggleType = (type) =>
    setIncidentTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));

  const updateRow = (setter) => (index, field, value) =>
    setter((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const removeRow = (setter, blank) => (index) =>
    setter((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : [{ ...blank }]));

  const updateWitness = updateRow(setWitnesses);
  const updateAction = updateRow(setActions);
  const updateSignoff = updateRow(setSignoff);

  const resetForm = () => {
    setReportId(null);
    setForm(initialForm);
    setIncidentTypes([]);
    setWitnesses([{ ...blankWitness }]);
    setActions([{ ...blankAction }]);
    setSignoff(defaultSignoff.map((row) => ({ ...row })));
  };

  const payload = () => ({
    ...form,
    incidentTypes,
    witnesses: witnesses.filter((row) => row.name.trim()),
    correctiveActions: actions.filter((row) => row.action.trim()),
    signoff: signoff.filter((row) => row.name.trim() || row.signature.trim()),
  });

  const save = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!session?.access_token) {
      setError("Your sign-in session has expired. Please sign in again.");
      return;
    }
    if (!form.incidentDescription.trim()) {
      setError("Add a description of the incident before saving.");
      return;
    }
    setSaving(true);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
      const url = reportId ? `/api/incident-reports/${reportId}` : "/api/incident-reports";
      const method = reportId ? "PATCH" : "POST";
      const response = await fetch(url, { method, headers, body: JSON.stringify(payload()) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the incident report.");
      setReportId(data.report.id);
      setMessage(reportId ? "Incident report updated." : "Incident report saved.");
    } catch (requestError) {
      setError(requestError.message || "Could not save the incident report.");
    } finally {
      setSaving(false);
    }
  };

  const submitForReview = async () => {
    if (!reportId || !session?.access_token) return;
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/incident-reports/${reportId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit the report.");
      setMessage("Submitted for review.");
    } catch (requestError) {
      setError(requestError.message || "Could not submit the report.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="swms-page"><p>Loading your workspace…</p></main>;

  return (
    <main className="swms-page">
      <header className="swms-hero">
        <span><ClipboardList size={18} /> Ecology Consulting · WHS incident record</span>
        <h1>Incident report form</h1>
        <p>Record what is known to have occurred — facts, not assumptions. Submit for review; full root cause analysis is completed separately.</p>
      </header>

      <div className="incident-notifiable"><AlertTriangle size={20} /><p><strong>Notifiable incident?</strong> If this involved a death, serious injury/illness, or dangerous incident, notify SafeWork NSW immediately on <strong>13 10 50</strong> and preserve the scene. Do not move equipment until advised.</p></div>

      <form className="swms-form" onSubmit={save}>
        <p className="tt-section-label">1. Incident details</p>
        <div className="swms-two-fields">
          <label>Organisation / PCBU<input value={form.organisation} onChange={(e) => setField("organisation", e.target.value)} /></label>
          <label>Site / location<input value={form.siteLocation} onChange={(e) => setField("siteLocation", e.target.value)} /></label>
        </div>
        <div className="swms-two-fields">
          <label>Incident date<input type="date" value={form.incidentDate} onChange={(e) => setField("incidentDate", e.target.value)} /></label>
          <label>Incident time<input value={form.incidentTime} onChange={(e) => setField("incidentTime", e.target.value)} placeholder="HH:MM" /></label>
        </div>
        <div className="swms-two-fields">
          <label>Report date<input type="date" value={form.reportDate} onChange={(e) => setField("reportDate", e.target.value)} /></label>
          <label>Reported by (name/position)<input value={form.reportedBy} onChange={(e) => setField("reportedBy", e.target.value)} /></label>
        </div>
        <div className="swms-two-fields">
          <label>Supervisor notified<input value={form.supervisorNotified} onChange={(e) => setField("supervisorNotified", e.target.value)} /></label>
          <label>Supervisor contact<input value={form.supervisorContact} onChange={(e) => setField("supervisorContact", e.target.value)} /></label>
        </div>

        <p className="tt-section-label">2. Incident classification</p>
        <div className="incident-chips">
          {INCIDENT_TYPES.map((type) => (
            <button type="button" key={type} className={incidentTypes.includes(type) ? "incident-chip active" : "incident-chip"} onClick={() => toggleType(type)}>{type}</button>
          ))}
        </div>
        <div className="swms-two-fields">
          <label>Severity rating<select value={form.severityRating} onChange={(e) => setField("severityRating", e.target.value)}><option value="">Select…</option>{SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Investigation target<input value={form.investigationTarget} onChange={(e) => setField("investigationTarget", e.target.value)} placeholder="e.g. 10 working days" /></label>
        </div>
        <div className="swms-two-fields">
          <label>Notifiable incident?<select value={form.notifiable} onChange={(e) => setField("notifiable", e.target.value)}><option value="">Select…</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
          <label>SafeWork NSW reference #<input value={form.safeworkReference} onChange={(e) => setField("safeworkReference", e.target.value)} /></label>
        </div>
        <div className="swms-two-fields">
          <label>Scene preserved?<select value={form.scenePreserved} onChange={(e) => setField("scenePreserved", e.target.value)}><option value="">Select…</option><option value="Yes">Yes</option><option value="No">No</option><option value="N/A">N/A</option></select></label>
          <label>Date / time notified<input value={form.notifiedDatetime} onChange={(e) => setField("notifiedDatetime", e.target.value)} /></label>
        </div>

        <p className="tt-section-label">3. Person(s) involved</p>
        <div className="swms-two-fields">
          <label>Full name<input value={form.personName} onChange={(e) => setField("personName", e.target.value)} /></label>
          <label>Date of birth<input value={form.personDob} onChange={(e) => setField("personDob", e.target.value)} /></label>
        </div>
        <div className="swms-two-fields">
          <label>Position / role<input value={form.personPosition} onChange={(e) => setField("personPosition", e.target.value)} /></label>
          <label>Employment type<input value={form.employmentType} onChange={(e) => setField("employmentType", e.target.value)} /></label>
        </div>
        <div className="swms-two-fields">
          <label>Employer / contractor company<input value={form.employerCompany} onChange={(e) => setField("employerCompany", e.target.value)} /></label>
          <label>Years experience in role<input value={form.yearsExperience} onChange={(e) => setField("yearsExperience", e.target.value)} /></label>
        </div>
        <label>Years with organisation<input value={form.yearsWithOrg} onChange={(e) => setField("yearsWithOrg", e.target.value)} /></label>

        <p className="tt-section-label">4. Injury / illness details</p>
        <label>Nature of injury / illness<textarea value={form.injuryNature} onChange={(e) => setField("injuryNature", e.target.value)} /></label>
        <label>Body part(s) affected<textarea value={form.bodyParts} onChange={(e) => setField("bodyParts", e.target.value)} /></label>
        <label>Medical treatment<textarea value={form.medicalTreatment} onChange={(e) => setField("medicalTreatment", e.target.value)} /></label>

        <p className="tt-section-label">5. Incident description</p>
        <label>Task being performed<input value={form.taskPerformed} onChange={(e) => setField("taskPerformed", e.target.value)} /></label>
        <label>Exact location (building/floor/area)<input value={form.exactLocation} onChange={(e) => setField("exactLocation", e.target.value)} /></label>
        <label>Environmental conditions (weather/lighting/noise/temp)<input value={form.environmentalConditions} onChange={(e) => setField("environmentalConditions", e.target.value)} /></label>
        <label>Detailed description (Who, What, When, Where, Why, How)<textarea value={form.incidentDescription} onChange={(e) => setField("incidentDescription", e.target.value)} required /></label>

        <p className="tt-section-label">6. Witnesses</p>
        <div className="tt-rows">
          {witnesses.map((row, index) => (
            <div className="tt-row" key={index}>
              <div className="tt-row-head"><span>Witness {index + 1}</span><button type="button" onClick={() => removeRow(setWitnesses, blankWitness)(index)} aria-label={`Remove witness ${index + 1}`}><Trash2 size={13} /></button></div>
              <div className="swms-two-fields">
                <input value={row.name} onChange={(e) => updateWitness(index, "name", e.target.value)} placeholder="Name & position" />
                <input value={row.contact} onChange={(e) => updateWitness(index, "contact", e.target.value)} placeholder="Contact details" />
              </div>
              <div className="swms-two-fields">
                <input value={row.type} onChange={(e) => updateWitness(index, "type", e.target.value)} placeholder="Witness type" />
                <input value={row.statement} onChange={(e) => updateWitness(index, "statement", e.target.value)} placeholder="Statement summary" />
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="tt-add" onClick={() => setWitnesses((rows) => [...rows, { ...blankWitness }])}><Plus size={13} /> Add witness</button>

        <p className="tt-section-label">7. Immediate corrective actions</p>
        <div className="tt-rows">
          {actions.map((row, index) => (
            <div className="tt-row" key={index}>
              <div className="tt-row-head"><span>Action {index + 1}</span><button type="button" onClick={() => removeRow(setActions, blankAction)(index)} aria-label={`Remove action ${index + 1}`}><Trash2 size={13} /></button></div>
              <input value={row.action} onChange={(e) => updateAction(index, "action", e.target.value)} placeholder="Immediate action taken" />
              <div className="swms-two-fields">
                <input value={row.responsible} onChange={(e) => updateAction(index, "responsible", e.target.value)} placeholder="Responsible person" />
                <input value={row.dateCompleted} onChange={(e) => updateAction(index, "dateCompleted", e.target.value)} placeholder="Date completed" />
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="tt-add" onClick={() => setActions((rows) => [...rows, { ...blankAction }])}><Plus size={13} /> Add action</button>

        <p className="tt-section-label">8. Report sign-off</p>
        <div className="tt-rows">
          {signoff.map((row, index) => (
            <div className="tt-row" key={index}>
              <div className="tt-row-head"><span>{row.role || `Signatory ${index + 1}`}</span></div>
              <div className="swms-two-fields">
                <input value={row.name} onChange={(e) => updateSignoff(index, "name", e.target.value)} placeholder="Name" />
                <input value={row.signature} onChange={(e) => updateSignoff(index, "signature", e.target.value)} placeholder="Signature / initials" />
              </div>
              <input type="date" value={row.date} onChange={(e) => updateSignoff(index, "date", e.target.value)} />
            </div>
          ))}
        </div>

        {error ? <p className="swms-error" role="alert">{error}</p> : null}
        {message ? <p className="swms-success" role="status"><CheckCircle2 size={18} /> {message}</p> : null}

        <div className="tt-actions">
          <button className="swms-submit" disabled={saving} type="submit"><ClipboardList size={17} /> {saving ? "Saving…" : reportId ? "Update report" : "Save report"}</button>
          {reportId ? <button className="tt-secondary" type="button" disabled={submitting} onClick={submitForReview}>{submitting ? "Submitting…" : "Submit for review"}</button> : null}
          {reportId ? <button className="tt-secondary" type="button" onClick={resetForm}>Start new</button> : null}
        </div>
      </form>
    </main>
  );
}
