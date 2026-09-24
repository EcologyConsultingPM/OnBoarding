"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ClipboardCheck, Download, FileWarning, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import SignaturePad from "./SignaturePad";
import {
  ECOLOGICAL_FIELD_SWMS_BASE_CONTROLS,
  ECOLOGICAL_FIELD_SWMS_HAZARDS,
  normaliseEcologicalFieldSwmsDetails,
} from "../lib/ecologicalFieldSwms";

const DRAFT_KEY = "ecology-consulting:ecological-field-swms:v1";

function blankForm(defaultName = "") {
  return {
    project: "",
    client: "",
    jobNumber: "",
    date: new Date().toISOString().slice(0, 10),
    activity: "",
    site: "",
    accessEgress: "",
    fieldLead: defaultName,
    principalContractor: "",
    firstAider: "",
    communicationOfficer: "",
    emergencyPlan: "",
    musterPoint: "",
    gpsCoordinates: "",
    nearestCrossRoad: "",
    communications: "",
    conditions: "",
    team: [{ name: defaultName, role: "Field Lead", acknowledged: false }].filter((member) => member.name),
    selectedHazards: [],
    hazardDetails: {},
    baseControlsRead: false,
    sourceDocumentsAvailable: false,
    noSpecialistHazardConfirmed: false,
    changesDuringDay: "",
    fieldLeadSignature: "",
    signedAt: "",
  };
}

function readDraft(defaultName) {
  if (typeof window === "undefined") return blankForm(defaultName);
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
    if (draft && typeof draft === "object") return { ...blankForm(defaultName), ...draft };
  } catch {}
  return blankForm(defaultName);
}

export default function EcologicalFieldSwmsForm({ authFetch, defaultName = "", onBack, onSubmitted, onToast }) {
  const [form, setForm] = useState(() => readDraft(defaultName));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {}
  }, [form]);

  const selectedHazards = useMemo(
    () => ECOLOGICAL_FIELD_SWMS_HAZARDS.filter((hazard) => form.selectedHazards.includes(hazard.id)),
    [form.selectedHazards],
  );

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const patchHazard = (id, patch) => setForm((current) => ({
    ...current,
    hazardDetails: { ...current.hazardDetails, [id]: { ...(current.hazardDetails[id] || {}), ...patch } },
  }));

  const toggleHazard = (id) => setForm((current) => {
    const selected = current.selectedHazards.includes(id);
    return {
      ...current,
      selectedHazards: selected ? current.selectedHazards.filter((value) => value !== id) : [...current.selectedHazards, id],
      hazardDetails: selected
        ? Object.fromEntries(Object.entries(current.hazardDetails).filter(([key]) => key !== id))
        : { ...current.hazardDetails, [id]: { sourceVersion: "Revision 1.0", reason: "", location: "", controlsConfirmed: false, stopWorkBriefed: false } },
    };
  });

  const updateTeam = (index, patch) => set("team", form.team.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member));
  const addTeamMember = () => set("team", [...form.team, { name: "", role: "", acknowledged: false }]);
  const removeTeamMember = (index) => set("team", form.team.length > 1 ? form.team.filter((_, memberIndex) => memberIndex !== index) : []);

  const downloadSource = useCallback(async (documentCode) => {
    setDownloading(documentCode);
    setError("");
    try {
      const response = await authFetch("GET", `/api/governance-source?key=${encodeURIComponent(documentCode)}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The controlled SWMS could not be opened.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (requestError) {
      setError(requestError.message || "The controlled SWMS could not be opened.");
    } finally {
      setDownloading("");
    }
  }, [authFetch]);

  const submit = async () => {
    if (submitting) return;
    setError("");
    setMessage("");
    const payload = { ...form, signedAt: form.signedAt || new Date().toISOString() };
    const checked = normaliseEcologicalFieldSwmsDetails(payload);
    if (checked.errors.length) {
      setError(checked.errors[0]);
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch("POST", "/api/whs-forms", {
        form_type: "ecological_field_swms",
        title: `Generic SWMS — Ecological Field Surveys: ${checked.details.project} — ${checked.details.activity}`,
        site: checked.details.site,
        form_date: checked.details.date,
        details: checked.details,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The ecological field survey SWMS could not be submitted.");
      try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      setForm(blankForm(defaultName));
      await onSubmitted?.();
      const text = data.duplicate
        ? "This ecological field survey SWMS was already submitted. Your existing record has been retained."
        : "Ecological field survey SWMS submitted and reported to WHS monitoring.";
      setMessage(text);
      onToast?.(text);
    } catch (requestError) {
      setError(requestError.message || "The ecological field survey SWMS could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="efs">
      <header className="efs__hero">
        <span><ClipboardCheck size={16} /> EC-GEN-SWMS-001 · Revision 1.1</span>
        <h1>Generic SWMS — Ecological Field Surveys</h1>
        <p>Complete this daily selector for the specific survey activity. It records the project details, crew and every relevant specialist hazard. It does not replace a selected controlled SWMS or the site-specific Emergency Response Plan.</p>
      </header>
      <button type="button" className="sf-back" onClick={onBack}><ChevronLeft size={15} /> Back to forms</button>

      <section className="efs__notice">
        <ShieldAlert size={18} />
        <div><strong>Use the source SWMS with this form</strong><p>Select every relevant hazard below, open its controlled source document, brief the listed controls and stop-work triggers, then obtain crew acknowledgement before work begins.</p></div>
      </section>

      {error ? <p className="sf-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="sf-success"><CheckCircle2 size={15} /> {message}</p> : null}

      <div className="efs__form">
        <section className="efs__section">
          <div className="efs__section-heading"><span>1</span><div><h2>Project and daily activity</h2><p>Describe today’s ecological work and the place where it will happen.</p></div></div>
          <div className="efs__grid">
            <label><span>Project <b>*</b></span><input value={form.project} onChange={(event) => set("project", event.target.value)} placeholder="Project name" /></label>
            <label><span>Client</span><input value={form.client} onChange={(event) => set("client", event.target.value)} /></label>
            <label><span>Job number</span><input value={form.jobNumber} onChange={(event) => set("jobNumber", event.target.value)} /></label>
            <label><span>Work date <b>*</b></span><input type="date" value={form.date} onChange={(event) => set("date", event.target.value)} /></label>
            <label className="efs__wide"><span>Ecological survey activity <b>*</b></span><textarea rows={3} value={form.activity} onChange={(event) => set("activity", event.target.value)} placeholder="For example: pre-clearing fauna survey, dusk bat survey, habitat inspection, device deployment or flora survey" /></label>
            <label className="efs__wide"><span>Exact site / work area <b>*</b></span><textarea rows={2} value={form.site} onChange={(event) => set("site", event.target.value)} placeholder="Site, plot, alignment, structure or work area" /></label>
            <label className="efs__wide"><span>Access and egress route / activity limits</span><textarea rows={2} value={form.accessEgress} onChange={(event) => set("accessEgress", event.target.value)} placeholder="Approved access route, safe limits, observation-only or non-entry method" /></label>
          </div>
        </section>

        <section className="efs__section">
          <div className="efs__section-heading"><span>2</span><div><h2>People, communications and emergency information</h2><p>Ensure the daily team and emergency arrangements are clear before mobilisation.</p></div></div>
          <div className="efs__grid">
            <label><span>Field Lead <b>*</b></span><input value={form.fieldLead} onChange={(event) => set("fieldLead", event.target.value)} /></label>
            <label><span>Principal Contractor / site supervisor</span><input value={form.principalContractor} onChange={(event) => set("principalContractor", event.target.value)} /></label>
            <label><span>First aider</span><input value={form.firstAider} onChange={(event) => set("firstAider", event.target.value)} /></label>
            <label><span>Communication Officer / standby role</span><input value={form.communicationOfficer} onChange={(event) => set("communicationOfficer", event.target.value)} /></label>
            <label><span>Site ERP reference <b>*</b></span><input value={form.emergencyPlan} onChange={(event) => set("emergencyPlan", event.target.value)} placeholder="ERP reference, version or location" /></label>
            <label><span>Muster / emergency meeting point <b>*</b></span><input value={form.musterPoint} onChange={(event) => set("musterPoint", event.target.value)} /></label>
            <label><span>GPS coordinates</span><input value={form.gpsCoordinates} onChange={(event) => set("gpsCoordinates", event.target.value)} /></label>
            <label><span>Nearest cross road / responder access</span><input value={form.nearestCrossRoad} onChange={(event) => set("nearestCrossRoad", event.target.value)} /></label>
            <label className="efs__wide"><span>Communications and check-in arrangement <b>*</b></span><textarea rows={2} value={form.communications} onChange={(event) => set("communications", event.target.value)} placeholder="Mobile / radio / InReach or PLB, contact person, check-in schedule and escalation" /></label>
            <label className="efs__wide"><span>Daily conditions and go / no-go review <b>*</b></span><textarea rows={3} value={form.conditions} onChange={(event) => set("conditions", event.target.value)} placeholder="Weather, light, ground or bank condition, water, traffic/plant activity, electrical assets, asbestos register, permit status and communications test as applicable" /></label>
          </div>
        </section>

        <section className="efs__section">
          <div className="efs__section-heading"><span>3</span><div><h2>Field team acknowledgement</h2><p>Every worker must be listed with their role and confirm they have been included in the daily briefing.</p></div></div>
          <div className="efs__team">
            {form.team.map((member, index) => <article key={`team-${index}`} className="efs__team-row">
              <div className="efs__team-number">{index + 1}</div>
              <label><span>Name <b>*</b></span><input value={member.name} onChange={(event) => updateTeam(index, { name: event.target.value })} placeholder="Full name" /></label>
              <label><span>Role <b>*</b></span><input value={member.role} onChange={(event) => updateTeam(index, { role: event.target.value })} placeholder="Field ecologist, standby, first aider…" /></label>
              <label className="efs__tick"><input type="checkbox" checked={member.acknowledged === true} onChange={(event) => updateTeam(index, { acknowledged: event.target.checked })} /><span>I was briefed and understand the selected controls.</span></label>
              <button type="button" className="efs__remove" onClick={() => removeTeamMember(index)} aria-label={`Remove team member ${index + 1}`}><Trash2 size={15} /> Remove</button>
            </article>)}
          </div>
          <button type="button" className="efs__add" onClick={addTeamMember}><Plus size={15} /> Add team member</button>
        </section>

        <section className="efs__section">
          <div className="efs__section-heading"><span>4</span><div><h2>Specialist hazard selector</h2><p>Tick every specialist hazard that applies today. Read the displayed controls and open the controlled source SWMS before confirming it with the crew.</p></div></div>
          <div className="efs__base-controls">
            <strong>Every day — generic ecological field survey controls</strong>
            <ul>{ECOLOGICAL_FIELD_SWMS_BASE_CONTROLS.map((control) => <li key={control}>{control}</li>)}</ul>
            <label><input type="checkbox" checked={form.baseControlsRead === true} onChange={(event) => set("baseControlsRead", event.target.checked)} /> I have reviewed the generic controls with the team.</label>
          </div>
          <div className="efs__hazards">
            {ECOLOGICAL_FIELD_SWMS_HAZARDS.map((hazard) => {
              const selected = form.selectedHazards.includes(hazard.id);
              const detail = form.hazardDetails[hazard.id] || {};
              return <article className={`efs__hazard${selected ? " selected" : ""}`} key={hazard.id}>
                <label className="efs__hazard-toggle"><input type="checkbox" checked={selected} onChange={() => toggleHazard(hazard.id)} /><span><b>{hazard.documentCode}</b><strong>{hazard.title}</strong><small>{hazard.prompt}</small></span></label>
                {selected ? <div className="efs__hazard-content">
                  <div className="efs__source-row"><span>Controlled source: <b>{hazard.documentCode} · Revision 1.0</b></span><button type="button" onClick={() => downloadSource(hazard.documentCode)} disabled={downloading === hazard.documentCode}>{downloading === hazard.documentCode ? "Opening…" : <><Download size={14} /> Open controlled SWMS</>}</button></div>
                  <div className="efs__grid"><label><span>Why this hazard applies <b>*</b></span><textarea rows={2} value={detail.reason || ""} onChange={(event) => patchHazard(hazard.id, { reason: event.target.value })} /></label><label><span>Specific task / location <b>*</b></span><textarea rows={2} value={detail.location || ""} onChange={(event) => patchHazard(hazard.id, { location: event.target.value })} /></label></div>
                  <div className="efs__limit-block"><strong>Scope and non-authorising limits</strong><ul>{hazard.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul></div>
                  <div className="efs__prereq-block"><strong>Pre-start checks and prerequisites</strong><ul>{hazard.prerequisites.map((prerequisite) => <li key={prerequisite}>{prerequisite}</li>)}</ul></div>
                  <div className="efs__control-block"><strong>Controls to brief and apply</strong><ul>{hazard.controls.map((control) => <li key={control}>{control}</li>)}</ul></div>
                  <div className="efs__cross-block"><strong>Required linked controls and documents</strong><ul>{hazard.crossReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul></div>
                  <div className="efs__emergency-block"><strong>Emergency boundaries</strong><ul>{hazard.emergency.map((step) => <li key={step}>{step}</li>)}</ul></div>
                  <div className="efs__stop-block"><FileWarning size={16} /><div><strong>Stop work immediately if</strong><ul>{hazard.stopWork.map((condition) => <li key={condition}>{condition}</li>)}</ul></div></div>
                  <div className="efs__confirmation-row"><label><input type="checkbox" checked={detail.controlsConfirmed === true} onChange={(event) => patchHazard(hazard.id, { controlsConfirmed: event.target.checked })} /> Scope limits, prerequisites, controls, linked documents, authorisations, training, PPE and equipment are confirmed.</label><label><input type="checkbox" checked={detail.stopWorkBriefed === true} onChange={(event) => patchHazard(hazard.id, { stopWorkBriefed: event.target.checked })} /> Stop-work triggers, emergency boundaries and safe retreat/muster arrangements were briefed.</label></div>
                </div> : null}
              </article>;
            })}
          </div>
          <div className="efs__final-checks"><label><input type="checkbox" checked={form.sourceDocumentsAvailable === true} onChange={(event) => set("sourceDocumentsAvailable", event.target.checked)} /> The current controlled source SWMS documents for every selected hazard are available at the work location.</label><label><input type="checkbox" checked={form.noSpecialistHazardConfirmed === true} onChange={(event) => set("noSpecialistHazardConfirmed", event.target.checked)} /> No other specialist SWMS hazard applies, or every applicable hazard has been selected above.</label></div>
        </section>

        <section className="efs__section">
          <div className="efs__section-heading"><span>5</span><div><h2>Changes, Field Lead verification and signature</h2><p>Record any changed conditions or re-briefing completed during the day.</p></div></div>
          <label className="efs__wide"><span>Changes during the day / re-briefing / decisions</span><textarea rows={3} value={form.changesDuringDay} onChange={(event) => set("changesDuringDay", event.target.value)} placeholder="Record changed conditions, control changes, work stopped or re-briefing completed." /></label>
          <SignaturePad label="Field Lead signature — confirms this daily selector and the selected controlled SWMS were briefed before work" value={form.fieldLeadSignature} onChange={(signature) => set("fieldLeadSignature", signature)} />
        </section>

        <div className="efs__actions"><button type="button" className="sf-submit" onClick={submit} disabled={submitting} aria-busy={submitting}><Send size={15} /> {submitting ? "Submitting…" : "Submit ecological survey SWMS"}</button><button type="button" className="sf-clear-draft" onClick={() => { try { window.localStorage.removeItem(DRAFT_KEY); } catch {} setForm(blankForm(defaultName)); setMessage("Saved ecological survey SWMS draft cleared from this device."); }}>Clear saved draft</button><button type="button" className="sf-cancel" onClick={onBack}>Save & close</button></div>
      </div>
    </div>
  );
}
