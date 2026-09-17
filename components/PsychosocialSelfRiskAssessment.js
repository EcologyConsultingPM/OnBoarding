"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  HeartHandshake,
  Lock,
  Printer,
  Send,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const HAZARD_CATEGORIES = [
  "High job demands", "Low job control", "Poor support (supervisor / peer)", "Low role clarity",
  "Poor organisational change management", "Low reward and recognition", "Poor organisational justice",
  "Traumatic events or material", "Remote / isolated work", "Poor physical environment",
  "Violence and aggression", "Bullying", "Harassment (including sexual harassment)",
  "Conflict or poor workplace relationships",
];
const METHODS = ["Worker self-assessment", "Focus group / consultation", "Incident review", "Worksite observation", "Meeting / interview"];
const LIKELIHOOD = [
  { value: "1", label: "Rare (1)" }, { value: "2", label: "Unlikely (2)" }, { value: "3", label: "Possible (3)" },
  { value: "4", label: "Likely (4)" }, { value: "5", label: "Almost certain (5)" },
];
const CONSEQUENCE = [
  { value: "1", label: "Minor (1)" }, { value: "2", label: "Moderate (2)" }, { value: "3", label: "Major (3)" }, { value: "4", label: "Catastrophic (4)" },
];
const EXPOSURES = ["Rare", "Occasional", "Frequent", "Continuous"];
const EFFECTIVENESS = ["Effective", "Partially effective", "Ineffective", "Not in place"];
const STAGE_LABELS = {
  draft: "Stage 1 · Draft worker assessment",
  submitted: "Stage 2 · Awaiting WHS Officer review",
  whs_review: "Stage 2 · Review complete — ready to return",
  returned_to_worker: "Stage 3 · Worker acknowledgement required",
  worker_acknowledged: "Stage 4 · Ready for consultation meeting",
  consultation_completed: "Stage 5 · Worker final signature required",
  closed: "Closed",
};
const RATING_COLOURS = { Extreme: "#a5342a", High: "#c9702d", Medium: "#c98a1e", Low: "#2c6a34" };

const PSA_STYLE_ENHANCEMENTS = `
  .psa { max-width: 1040px !important; padding: clamp(14px, 2vw, 26px); border: 1px solid #ccd8cf; border-radius: 15px; background: #fbfcf8; box-shadow: 0 12px 30px rgba(18, 50, 32, .09); color: #1e3026 !important; font-family: Inter, Arial, sans-serif; }
  .psa-header { margin: -1px -1px 16px !important; padding: 20px 22px; border: 1px solid #1f5a34; border-radius: 11px; background: linear-gradient(125deg, #113c27, #246840); color: #fffdf4; }
  .psa-header h2 { color: #fffdf4; font-family: Georgia, serif; font-size: clamp(24px, 3vw, 31px) !important; }
  .psa-header .psa-btn.secondary { border-color: #d9bc59; background: #fff8dd; color: #173c29; }
  .psa-restricted { padding: 10px 12px; border: 1px solid #bdcdbf; border-radius: 8px; background: #f0f6ef; color: #314a3a !important; font-size: 13px !important; line-height: 1.45; }
  .psa-stage { margin: 0 0 14px; border: 1px solid #a9c5ad; background: #e8f4e9 !important; color: #184a2a !important; }
  .psa-section { border-color: #c8d4ca !important; border-radius: 11px !important; box-shadow: 0 2px 8px rgba(18, 50, 32, .035); }
  .psa-section h3 { padding: 13px 16px !important; background: #edf4ed !important; color: #214c33; font-size: 15px !important; letter-spacing: .015em; }
  .psa-body { padding: 18px !important; }
  .psa-field > span, .psa-field legend { color: #455c4d !important; font-size: 11px !important; letter-spacing: .065em !important; }
  .psa-field input, .psa-field select, .psa-field textarea { min-height: 42px; border-color: #acbeb0 !important; border-radius: 7px !important; color: #1d3025 !important; font-size: 14px !important; line-height: 1.45; }
  .psa-field textarea { min-height: 82px; }
  .psa-field input:focus, .psa-field select:focus, .psa-field textarea:focus { outline: 3px solid rgba(59, 129, 77, .22); outline-offset: 1px; border-color: #2b7442 !important; }
  .psa-muted { color: #4e6255 !important; font-size: 13px !important; }
  .psa-choice { min-height: 38px; border-color: #afc0b1 !important; padding: 8px 10px !important; color: #2d4435; font-size: 13px !important; }
  .psa-choice.active { background: #215f37 !important; border-color: #215f37 !important; color: #fff !important; }
  .psa-card { border-color: #c8d4ca !important; padding: 15px !important; background: #fff !important; }
  .psa-card h4 { color: #244c34; font-size: 14px !important; }
  .psa-rating { min-height: 34px; padding: 6px 11px !important; }
  .psa-btn { min-height: 42px; border-color: #1e6137 !important; background: #1e6137 !important; border-radius: 8px !important; }
  .psa-btn.secondary { background: #fff !important; color: #195a32 !important; }
  .psa-btn:focus-visible, .psa-choice:has(input:focus-visible) { outline: 3px solid #d4b04d; outline-offset: 2px; }
  .psa-summary div, .psa-readonly { background: #f0f5ed !important; border: 1px solid #d4ded2; }
  .psa-alert { font-size: 13px !important; line-height: 1.5 !important; }
  @media (max-width: 700px) {
    .psa { padding: 12px; border-radius: 10px; }
    .psa-header { padding: 16px; align-items: stretch; }
    .psa-header .psa-btn { width: 100%; margin: 4px 0 0; }
    .psa-body { padding: 14px !important; }
    .psa-choices { display: grid; grid-template-columns: 1fr; }
    .psa-choice { width: 100%; }
  }
`;

function blankActivity() {
  return { activity: "", hazard_category: "", hazard_detail: "", exposure: "", controls: "", control_effectiveness: "", likelihood: "", consequence: "" };
}

function calculateRisk(activity) {
  const likelihood = Number(activity.likelihood);
  const consequence = Number(activity.consequence);
  if (!likelihood || !consequence) return null;
  const score = likelihood * consequence;
  const risk_rating = score >= 15 ? "Extreme" : score >= 8 ? "High" : score >= 4 ? "Medium" : "Low";
  return { score, risk_rating };
}

function emptyForm() {
  return {
    position: "", assessment_date: "", workplace_location: "", scope: "", assessment_methods: [],
    hazard_categories: [], category_notes: {}, hazard_register: [blankActivity(), blankActivity(), blankActivity()],
    additional_notes: "", discuss_in_person: false, worker_declaration_signature: "", worker_declaration_confirmed: false,
  };
}

function reviewDefaults(record) {
  const actions = Array.isArray(record?.corrective_action_plan) ? record.corrective_action_plan : [];
  return {
    root_cause_analysis: record?.root_cause_analysis || "", corrective_action_plan: actions,
    risk_ratings_validated: record?.risk_ratings_validated || "", controls_reviewed_finding: record?.controls_reviewed_finding || "",
    additional_actions_identified: record?.additional_actions_identified || "", individual_action_plan_required: record?.individual_action_plan_required || "",
    highest_residual_risk: record?.highest_residual_risk || "",
  };
}

function meetingDefaults(record) {
  return {
    meeting_date: record?.meeting_date || "", meeting_time: record?.meeting_time || "", meeting_format: record?.meeting_format || "",
    meeting_location: record?.meeting_location || "", support_person: record?.support_person || "", meeting_attendees: (record?.meeting_attendees || []).join("\n"),
    meeting_outcomes: record?.meeting_outcomes || "", matters_not_agreed: record?.matters_not_agreed || "", follow_up_review_date: record?.follow_up_review_date || "",
    next_assessment_due: record?.next_assessment_due || "", escalation_status: record?.escalation_status || "", escalation_details: record?.escalation_details || "",
  };
}

export default function PsychosocialSelfRiskAssessment({ assessmentId = null }) {
  const { session, isAdmin } = useAuth();
  const [assessment, setAssessment] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [review, setReview] = useState(() => reviewDefaults(null));
  const [meeting, setMeeting] = useState(() => meetingDefaults(null));
  const [acknowledgement, setAcknowledgement] = useState({ signature: "", confirmed: false, response: "" });
  const [finalSignature, setFinalSignature] = useState({ signature: "", confirmed: false });
  const [closeOut, setCloseOut] = useState({ whs_officer_name: "", whs_officer_review_date: "", whs_officer_signature: "", project_manager_name: "", project_manager_signature: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const headers = useCallback(() => ({ "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);

  const applyAssessment = useCallback((record) => {
    setAssessment(record || null);
    if (!record) return;
    setForm({
      position: record.position || "", assessment_date: record.assessment_date || "", workplace_location: record.workplace_location || "", scope: record.scope || "",
      assessment_methods: record.assessment_methods || [], hazard_categories: record.hazard_categories || [], category_notes: record.category_notes || {},
      hazard_register: Array.isArray(record.hazard_register) && record.hazard_register.length ? record.hazard_register.map((row) => ({ ...blankActivity(), ...row })) : [blankActivity(), blankActivity(), blankActivity()],
      additional_notes: record.additional_notes || "", discuss_in_person: record.discuss_in_person === true,
      worker_declaration_signature: record.worker_declaration_signature || "", worker_declaration_confirmed: record.worker_declaration_confirmed === true,
    });
    setReview(reviewDefaults(record));
    setMeeting(meetingDefaults(record));
    setAcknowledgement({ signature: record.worker_acknowledgement_signature || "", confirmed: record.worker_acknowledgement_confirmed === true, response: record.worker_response_before_meeting || "" });
    setFinalSignature({ signature: record.worker_signature_final || "", confirmed: record.worker_final_signature_confirmed === true });
  }, []);

  const load = useCallback(async (requestedId = assessmentId) => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const url = requestedId ? `/api/psychosocial-assessments?id=${encodeURIComponent(requestedId)}` : "/api/psychosocial-assessments";
      const response = await fetch(url, { headers: headers() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to load the assessment.");
      if (requestedId) {
        applyAssessment(data.assessment);
      } else {
        const list = data.assessments || [];
        setAssessments(list);
        applyAssessment(list.find((item) => item.stage !== "closed") || list[0] || null);
      }
    } catch (cause) {
      setError(cause.message || "Unable to load the assessment.");
    } finally {
      setLoading(false);
    }
  }, [applyAssessment, assessmentId, headers, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const stage = assessment?.stage || "draft";
  const mediumPlus = useMemo(() => form.hazard_register.map((row, index) => ({ index, row, risk: calculateRisk(row) })).filter(({ risk }) => risk && ["Medium", "High", "Extreme"].includes(risk.risk_rating)), [form.hazard_register]);

  useEffect(() => {
    if (stage !== "submitted" && stage !== "whs_review") return;
    setReview((current) => {
      const byIndex = new Map((current.corrective_action_plan || []).map((action) => [Number(action.activity_index), action]));
      return {
        ...current,
        corrective_action_plan: mediumPlus.map(({ index, row, risk }) => ({
          activity_index: index, activity: row.activity, risk_rating: risk.risk_rating, action: byIndex.get(index)?.action || "", owner: byIndex.get(index)?.owner || "", due_date: byIndex.get(index)?.due_date || "", status: byIndex.get(index)?.status || "Not started",
        })),
      };
    });
  }, [mediumPlus, stage]);

  const request = async (payload, successMessage) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The assessment could not be saved.");
      applyAssessment(data.assessment);
      setNotice(data.duplicate ? "This step had already been recorded; the existing assessment was retained." : successMessage);
      await load();
      return data.assessment;
    } catch (cause) {
      setError(cause.message || "The assessment could not be saved.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key, value) => setForm((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const updateActivity = (index, patch) => setForm((current) => ({ ...current, hazard_register: current.hazard_register.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) }));
  const removeActivity = (index) => setForm((current) => ({ ...current, hazard_register: current.hazard_register.filter((_, rowIndex) => rowIndex !== index) }));
  const updateAction = (index, patch) => setReview((current) => ({ ...current, corrective_action_plan: current.corrective_action_plan.map((action) => action.activity_index === index ? { ...action, ...patch } : action) }));

  const workerPayload = (action) => ({ id: assessment?.id, action, ...form });
  const displayDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-AU") : "—";

  if (loading) return <p className="psa-loading" role="status">Loading confidential assessment…</p>;

  return (
    <section className="psa" aria-labelledby="psa-title">
      <style>{PSA_STYLE_ENHANCEMENTS + `
        .psa { max-width: 960px; color: #27342d; }
        .psa * { box-sizing: border-box; } .psa-header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
        .psa-header h2 { margin:0; font-size:21px; display:flex; align-items:center; gap:9px; } .psa-stage { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:5px 10px; background:#eef6ea; color:#1f5a34; font-size:12px; font-weight:700; }
        .psa-restricted { display:flex; gap:7px; align-items:flex-start; color:#5c6560; font-size:12px; margin:0 0 14px; } .psa-alert { border-radius:8px; padding:11px 13px; margin:0 0 13px; font-size:13px; line-height:1.5; }
        .psa-alert.critical { background:#fde2e1; color:#8a2f26; border-left:3px solid #a5342a; } .psa-alert.support { background:#fff1e9; color:#754018; border-left:3px solid #c9702d; }
        .psa-section { border:1px solid #e3ded2; border-radius:10px; margin:0 0 14px; overflow:hidden; background:#fff; } .psa-section h3 { margin:0; padding:11px 15px; background:#f7f8f2; border-bottom:1px solid #e3ded2; font-size:14px; }
        .psa-body { padding:14px 15px; } .psa-field { display:block; margin:0 0 12px; } .psa-field > span, .psa-field legend { display:block; font-size:11px; font-weight:700; color:#59645e; text-transform:uppercase; letter-spacing:.04em; margin:0 0 5px; }
        .psa-field input, .psa-field select, .psa-field textarea { width:100%; border:1px solid #d9d3c6; border-radius:6px; background:#fff; color:#27342d; font:inherit; font-size:13px; padding:8px 10px; } .psa-field textarea { resize:vertical; }
        .psa-row2, .psa-row3 { display:grid; gap:12px; } .psa-row2 { grid-template-columns:repeat(2,minmax(0,1fr)); } .psa-row3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .psa-choice-set { border:0; padding:0; margin:0 0 12px; } .psa-choices { display:flex; gap:7px; flex-wrap:wrap; } .psa-choice { display:inline-flex; align-items:center; gap:6px; border:1px solid #d9d3c6; border-radius:6px; padding:6px 8px; font-size:12.5px; cursor:pointer; } .psa-choice.active { background:#1f5a34; border-color:#1f5a34; color:#fff; }
        .psa-choice input { width:16px; height:16px; margin:0; accent-color:#1f5a34; } .psa-card { border:1px solid #e3ded2; border-radius:8px; padding:11px; margin:0 0 10px; } .psa-card h4 { margin:0 0 9px; font-size:13px; }
        .psa-rating { display:inline-flex; align-items:center; border-radius:999px; color:#fff; padding:4px 9px; min-height:31px; font-size:12px; font-weight:700; } .psa-muted { color:#69756e; font-size:12.5px; line-height:1.5; }
        .psa-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:40px; padding:8px 13px; margin:0 8px 0 0; border:1px solid #1f5a34; border-radius:7px; background:#1f5a34; color:#fff; font:inherit; font-weight:700; font-size:13px; cursor:pointer; } .psa-btn.secondary { background:#fff; color:#1f5a34; } .psa-btn.danger { background:#a5342a; border-color:#a5342a; } .psa-btn:disabled { cursor:not-allowed; opacity:.55; }
        .psa-status { border-radius:7px; padding:9px 11px; margin:0 0 12px; font-size:13px; } .psa-error { background:#fde2e1; color:#8a2f26; } .psa-notice { background:#e8f4e9; color:#1f5a34; } .psa-readonly { background:#f7f8f2; border-radius:7px; padding:11px; font-size:13px; line-height:1.5; }
        .psa-actions { margin-top:12px; } .psa-selection { max-width:500px; margin:0 0 13px; } .psa-inline-check { display:flex; align-items:flex-start; gap:8px; font-size:13px; line-height:1.4; margin:0 0 12px; } .psa-inline-check input { width:17px; height:17px; flex:0 0 auto; margin-top:1px; accent-color:#1f5a34; }
        .psa-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:0 0 12px; } .psa-summary div { background:#f7f8f2; padding:8px; border-radius:6px; } .psa-summary b { display:block; font-size:11px; text-transform:uppercase; color:#59645e; } .psa-summary span { font-size:13px; }
        @media (max-width:700px) { .psa-row2,.psa-row3,.psa-summary { grid-template-columns:1fr; } .psa-btn { width:100%; margin:0 0 8px; } }
        @media print { .psa .psa-btn, .psa .psa-selection, .psa-alert.support { display:none !important; } .psa { max-width:none; } .psa-section { break-inside:avoid; } }
      `}</style>

      <header className="psa-header">
        <h2 id="psa-title"><HeartHandshake size={21} aria-hidden="true" />Psychosocial Self Risk Assessment</h2>
        <button type="button" className="psa-btn secondary" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />Print assessment</button>
      </header>
      <p className="psa-restricted"><Lock size={13} aria-hidden="true" />Restricted psychosocial register. Your record is available only to you and authorised WHS administrators.</p>
      {assessment && <p className="psa-stage"><ShieldAlert size={13} aria-hidden="true" />{STAGE_LABELS[stage] || stage}</p>}
      <aside className="psa-alert support" aria-label="Immediate support information"><strong>Support is available.</strong> If this assessment brings up distress or you feel unsafe, contact your manager or WHS Officer, use your EAP if available, call <strong>Lifeline 13 11 14</strong> (24/7), or call <strong>000</strong> in an emergency.</aside>
      {assessment?.is_critical && <aside className="psa-alert critical" role="alert"><AlertCircle size={16} aria-hidden="true" />A High or Extreme risk has been recorded. The WHS Officer has been notified for prompt review.</aside>}
      {error && <p className="psa-status psa-error" role="alert">{error}</p>}
      {notice && <p className="psa-status psa-notice" role="status">{notice}</p>}

      {assessments.length > 1 && (
        <label className="psa-field psa-selection"><span>{isAdmin ? "Open assessment" : "Your assessment history"}</span>
          <select value={assessment?.id || ""} onChange={(event) => load(event.target.value)} aria-label="Choose assessment record">
            <option value="">Choose an assessment…</option>
            {assessments.map((item) => <option key={item.id} value={item.id}>{displayDate(item.assessment_date)} · {STAGE_LABELS[item.stage] || item.stage}</option>)}
          </select>
        </label>
      )}

      {(!assessment || stage === "draft") && (
        <>
          <section className="psa-section" aria-labelledby="psa-worker-details"><h3 id="psa-worker-details">Stage 1 · Worker self assessment</h3><div className="psa-body">
            <div className="psa-row3">
              <label className="psa-field"><span>Position / role</span><input value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} autoComplete="organization-title" /></label>
              <label className="psa-field"><span>Assessment date</span><input type="date" value={form.assessment_date} onChange={(event) => setForm({ ...form, assessment_date: event.target.value })} /></label>
              <label className="psa-field"><span>Workplace / location</span><input value={form.workplace_location} onChange={(event) => setForm({ ...form, workplace_location: event.target.value })} placeholder="Office, site, home-based or hybrid" /></label>
            </div>
            <label className="psa-field"><span>Scope of assessment</span><input value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} placeholder="For example: quarterly assessment of current field and office work" /></label>
            <fieldset className="psa-choice-set"><legend className="psa-field"><span>Assessment methods used (select all that apply)</span></legend><div className="psa-choices">
              {METHODS.map((method) => <label key={method} className={`psa-choice ${form.assessment_methods.includes(method) ? "active" : ""}`}><input type="checkbox" checked={form.assessment_methods.includes(method)} onChange={() => toggle("assessment_methods", method)} />{method}</label>)}
            </div></fieldset>
          </div></section>

          <section className="psa-section" aria-labelledby="psa-categories"><h3 id="psa-categories">Hazard categories and category notes</h3><div className="psa-body">
            <p className="psa-muted">Select each category present and record a short note for every selected category. Notes help WHS understand the context without requiring sensitive personal detail.</p>
            <fieldset className="psa-choice-set"><legend className="psa-field"><span>Categories present</span></legend><div className="psa-choices">
              {HAZARD_CATEGORIES.map((category) => <label key={category} className={`psa-choice ${form.hazard_categories.includes(category) ? "active" : ""}`}><input type="checkbox" checked={form.hazard_categories.includes(category)} onChange={() => toggle("hazard_categories", category)} />{category}</label>)}
            </div></fieldset>
            {form.hazard_categories.map((category) => <label className="psa-field" key={category}><span>Category note · {category}</span><textarea rows={2} value={form.category_notes[category] || ""} onChange={(event) => setForm({ ...form, category_notes: { ...form.category_notes, [category]: event.target.value } })} placeholder="What is occurring, where or when?" /></label>)}
          </div></section>

          <section className="psa-section" aria-labelledby="psa-activities"><h3 id="psa-activities">Work activities and risk assessment</h3><div className="psa-body">
            <p className="psa-muted">Record <strong>three to five complete work activities</strong>. Risk ratings displayed here are a guide; the server derives and records the final rating when you submit.</p>
            {form.hazard_register.map((activity, index) => {
              const rating = calculateRisk(activity);
              return <article className="psa-card" key={index} aria-labelledby={`activity-${index}`}><h4 id={`activity-${index}`}>Activity {index + 1}</h4>
                <div className="psa-row2">
                  <label className="psa-field"><span>Activity / task</span><input value={activity.activity} onChange={(event) => updateActivity(index, { activity: event.target.value })} placeholder="For example: Remote field reporting" /></label>
                  <label className="psa-field"><span>Hazard category</span><select value={activity.hazard_category} onChange={(event) => updateActivity(index, { hazard_category: event.target.value })}><option value="">Select…</option>{HAZARD_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                </div>
                <label className="psa-field"><span>Specific hazard and source</span><textarea rows={2} value={activity.hazard_detail} onChange={(event) => updateActivity(index, { hazard_detail: event.target.value })} /></label>
                <div className="psa-row2"><label className="psa-field"><span>Exposure</span><select value={activity.exposure} onChange={(event) => updateActivity(index, { exposure: event.target.value })}><option value="">Select…</option>{EXPOSURES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="psa-field"><span>Existing controls</span><textarea rows={2} value={activity.controls} onChange={(event) => updateActivity(index, { controls: event.target.value })} /></label></div>
                <div className="psa-row3"><label className="psa-field"><span>Control effectiveness</span><select value={activity.control_effectiveness} onChange={(event) => updateActivity(index, { control_effectiveness: event.target.value })}><option value="">Select…</option>{EFFECTIVENESS.map((value) => <option key={value}>{value}</option>)}</select></label><label className="psa-field"><span>Likelihood</span><select value={activity.likelihood} onChange={(event) => updateActivity(index, { likelihood: event.target.value })}><option value="">Select…</option>{LIKELIHOOD.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="psa-field"><span>Consequence</span><select value={activity.consequence} onChange={(event) => updateActivity(index, { consequence: event.target.value })}><option value="">Select…</option>{CONSEQUENCE.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
                <div className="psa-row2"><p className="psa-muted">Derived rating</p>{rating ? <span className="psa-rating" style={{ background: RATING_COLOURS[rating.risk_rating] }}>{rating.score} · {rating.risk_rating}</span> : <span className="psa-muted">Complete likelihood and consequence to calculate.</span>}</div>
                {form.hazard_register.length > 3 && <button type="button" className="psa-btn secondary" onClick={() => removeActivity(index)}>Remove activity</button>}
              </article>;
            })}
            {form.hazard_register.length < 5 && <button type="button" className="psa-btn secondary" onClick={() => setForm({ ...form, hazard_register: [...form.hazard_register, blankActivity()] })}>Add activity</button>}
          </div></section>

          <section className="psa-section" aria-labelledby="psa-submit"><h3 id="psa-submit">Worker declaration and submission</h3><div className="psa-body">
            <label className="psa-field"><span>Additional notes for the WHS Officer</span><textarea rows={3} value={form.additional_notes} onChange={(event) => setForm({ ...form, additional_notes: event.target.value })} /></label>
            <label className="psa-inline-check"><input type="checkbox" checked={form.discuss_in_person} onChange={(event) => setForm({ ...form, discuss_in_person: event.target.checked })} />Please contact me before reviewing this assessment.</label>
            <label className="psa-inline-check"><input type="checkbox" checked={form.worker_declaration_confirmed} onChange={(event) => setForm({ ...form, worker_declaration_confirmed: event.target.checked })} />I confirm this is an honest assessment of my current work conditions and I understand support is available.</label>
            <label className="psa-field"><span>Worker signature (type full name)</span><input value={form.worker_declaration_signature} onChange={(event) => setForm({ ...form, worker_declaration_signature: event.target.value })} autoComplete="name" /></label>
            <div className="psa-actions"><button type="button" className="psa-btn secondary" disabled={saving} onClick={() => request(workerPayload("save_draft"), "Draft saved.")}>Save draft</button><button type="button" className="psa-btn" disabled={saving} onClick={() => request(workerPayload("submit"), "Assessment submitted to the WHS Officer.")}><Send size={15} aria-hidden="true" />{saving ? "Submitting…" : "Submit to WHS Officer"}</button></div>
          </div></section>
        </>
      )}

      {assessment && stage !== "draft" && <section className="psa-section"><h3>Assessment record</h3><div className="psa-body"><div className="psa-summary"><div><b>Submitted</b><span>{displayDate(assessment.submitted_at?.slice(0, 10) || assessment.assessment_date)}</span></div><div><b>Location</b><span>{assessment.workplace_location || "—"}</span></div><div><b>Activities</b><span>{assessment.hazard_register?.length || 0}</span></div><div><b>Highest recorded risk</b><span>{assessment.hazard_register?.reduce((highest, row) => ({ Low: 1, Medium: 2, High: 3, Extreme: 4 }[row.risk_rating] > ({ Low: 1, Medium: 2, High: 3, Extreme: 4 }[highest] || 0) ? row.risk_rating : highest), "Low")}</span></div></div><p className="psa-readonly">This assessment has moved beyond the editable draft stage. The server controls all remaining stage transitions and close-out gates.</p></div></section>}

      {assessment && stage === "submitted" && isAdmin && <section className="psa-section" aria-labelledby="psa-review"><h3 id="psa-review">Stage 2 · WHS Officer review</h3><div className="psa-body">
        <label className="psa-field"><span>Root cause analysis</span><textarea rows={4} value={review.root_cause_analysis} onChange={(event) => setReview({ ...review, root_cause_analysis: event.target.value })} /></label>
        <div className="psa-row2"><label className="psa-field"><span>Risk ratings validated</span><select value={review.risk_ratings_validated} onChange={(event) => setReview({ ...review, risk_ratings_validated: event.target.value })}><option value="">Select…</option><option>Confirmed as submitted</option><option>Amended — raised</option><option>Amended — lowered</option></select></label><label className="psa-field"><span>Highest residual risk</span><select value={review.highest_residual_risk} onChange={(event) => setReview({ ...review, highest_residual_risk: event.target.value })}><option value="">Select…</option><option>Low</option><option>Medium</option><option>High</option><option>Extreme</option></select></label></div>
        <label className="psa-field"><span>Controls review finding</span><textarea rows={3} value={review.controls_reviewed_finding} onChange={(event) => setReview({ ...review, controls_reviewed_finding: event.target.value })} /></label>
        <label className="psa-field"><span>Additional actions identified</span><textarea rows={2} value={review.additional_actions_identified} onChange={(event) => setReview({ ...review, additional_actions_identified: event.target.value })} /></label>
        <label className="psa-field"><span>Individual action plan required</span><select value={review.individual_action_plan_required} onChange={(event) => setReview({ ...review, individual_action_plan_required: event.target.value })}><option value="">Select…</option><option>Yes</option><option>No</option></select></label>
        {review.corrective_action_plan.length > 0 && <><h4>Corrective action plan — required for every Medium, High or Extreme activity</h4>{review.corrective_action_plan.map((action) => <article className="psa-card" key={action.activity_index}><h4>{action.activity || `Activity ${action.activity_index + 1}`} · {action.risk_rating}</h4><label className="psa-field"><span>Corrective action</span><textarea rows={2} value={action.action} onChange={(event) => updateAction(action.activity_index, { action: event.target.value })} /></label><div className="psa-row3"><label className="psa-field"><span>Owner</span><input value={action.owner} onChange={(event) => updateAction(action.activity_index, { owner: event.target.value })} /></label><label className="psa-field"><span>Due date</span><input type="date" value={action.due_date} onChange={(event) => updateAction(action.activity_index, { due_date: event.target.value })} /></label><label className="psa-field"><span>Status</span><select value={action.status} onChange={(event) => updateAction(action.activity_index, { status: event.target.value })}><option>Not started</option><option>In progress</option><option>Completed</option></select></label></div></article>)}</>}
        <button type="button" className="psa-btn" disabled={saving} onClick={() => request({ id: assessment.id, action: "whs_review", ...review }, "WHS review recorded. Return the findings to the worker when ready.")}>Save WHS review</button>
      </div></section>}

      {assessment && stage === "whs_review" && isAdmin && <section className="psa-section"><h3>Return reviewed findings to worker</h3><div className="psa-body"><p className="psa-muted">Returning findings creates the worker acknowledgement task and notification. This is a separate audit step.</p><button type="button" className="psa-btn" disabled={saving} onClick={() => request({ id: assessment.id, action: "return_to_worker" }, "Findings returned to the worker.")}>Return findings to worker</button></div></section>}

      {assessment && stage === "returned_to_worker" && !isAdmin && <section className="psa-section" aria-labelledby="psa-ack"><h3 id="psa-ack">Stage 3 · Acknowledge WHS findings</h3><div className="psa-body"><div className="psa-readonly"><strong>Root cause analysis</strong><br />{assessment.root_cause_analysis || "The WHS Officer has returned findings for your review."}<br /><br /><strong>Controls review</strong><br />{assessment.controls_reviewed_finding || "—"}</div><label className="psa-field"><span>Questions or matters to raise at consultation (optional)</span><textarea rows={3} value={acknowledgement.response} onChange={(event) => setAcknowledgement({ ...acknowledgement, response: event.target.value })} /></label><label className="psa-inline-check"><input type="checkbox" checked={acknowledgement.confirmed} onChange={(event) => setAcknowledgement({ ...acknowledgement, confirmed: event.target.checked })} />I confirm that I have read the WHS findings. I understand acknowledgement does not mean I agree with every finding.</label><label className="psa-field"><span>Acknowledgement signature (type full name)</span><input value={acknowledgement.signature} onChange={(event) => setAcknowledgement({ ...acknowledgement, signature: event.target.value })} autoComplete="name" /></label><button type="button" className="psa-btn" disabled={saving} onClick={() => request({ id: assessment.id, action: "worker_acknowledge", worker_acknowledgement_signature: acknowledgement.signature, worker_acknowledgement_confirmed: acknowledgement.confirmed, worker_response_before_meeting: acknowledgement.response }, "Acknowledgement recorded. The WHS Officer can now record the consultation meeting.")}><CheckCircle2 size={15} aria-hidden="true" />Acknowledge findings</button></div></section>}

      {assessment && stage === "worker_acknowledged" && !isAdmin && <section className="psa-section"><h3>Consultation meeting</h3><div className="psa-body"><p className="psa-readonly">Your acknowledgement has been recorded. The WHS Officer will arrange and record the consultation meeting. You may bring a support person.</p></div></section>}

      {assessment && stage === "worker_acknowledged" && isAdmin && <section className="psa-section" aria-labelledby="psa-meeting"><h3 id="psa-meeting"><Users size={15} aria-hidden="true" /> Stage 4 · Consultation meeting</h3><div className="psa-body"><div className="psa-row3"><label className="psa-field"><span>Meeting date</span><input type="date" value={meeting.meeting_date} onChange={(event) => setMeeting({ ...meeting, meeting_date: event.target.value })} /></label><label className="psa-field"><span>Meeting time</span><input type="time" value={meeting.meeting_time} onChange={(event) => setMeeting({ ...meeting, meeting_time: event.target.value })} /></label><label className="psa-field"><span>Format</span><select value={meeting.meeting_format} onChange={(event) => setMeeting({ ...meeting, meeting_format: event.target.value })}><option value="">Select…</option><option>In person</option><option>Video call</option><option>Telephone</option></select></label></div><div className="psa-row2"><label className="psa-field"><span>Meeting location / connection</span><input value={meeting.meeting_location} onChange={(event) => setMeeting({ ...meeting, meeting_location: event.target.value })} /></label><label className="psa-field"><span>Support person arrangement</span><input value={meeting.support_person} onChange={(event) => setMeeting({ ...meeting, support_person: event.target.value })} placeholder="Name, offered/declined, or other arrangement" /></label></div><label className="psa-field"><span>Attendees (one name per line)</span><textarea rows={3} value={meeting.meeting_attendees} onChange={(event) => setMeeting({ ...meeting, meeting_attendees: event.target.value })} /></label><label className="psa-field"><span>Meeting outcomes and agreed actions</span><textarea rows={4} value={meeting.meeting_outcomes} onChange={(event) => setMeeting({ ...meeting, meeting_outcomes: event.target.value })} /></label><label className="psa-field"><span>Matters not agreed and resolution path</span><textarea rows={2} value={meeting.matters_not_agreed} onChange={(event) => setMeeting({ ...meeting, matters_not_agreed: event.target.value })} /></label><div className="psa-row2"><label className="psa-field"><span>Follow-up review date</span><input type="date" value={meeting.follow_up_review_date} onChange={(event) => setMeeting({ ...meeting, follow_up_review_date: event.target.value })} /></label><label className="psa-field"><span>Next assessment due</span><input type="date" value={meeting.next_assessment_due} onChange={(event) => setMeeting({ ...meeting, next_assessment_due: event.target.value })} /></label></div><div className="psa-row2"><label className="psa-field"><span>Escalation outcome</span><select value={meeting.escalation_status} onChange={(event) => setMeeting({ ...meeting, escalation_status: event.target.value })}><option value="">Select…</option><option>Not required</option><option>Escalated to leadership</option><option>External support / referral</option></select></label><label className="psa-field"><span>Escalation / referral details</span><textarea rows={2} value={meeting.escalation_details} onChange={(event) => setMeeting({ ...meeting, escalation_details: event.target.value })} /></label></div><button type="button" className="psa-btn" disabled={saving} onClick={() => request({ id: assessment.id, action: "record_meeting", ...meeting, meeting_attendees: meeting.meeting_attendees.split("\n").map((value) => value.trim()).filter(Boolean) }, "Consultation meeting recorded. The worker can now provide their final signature.")}>Record completed meeting</button></div></section>}

      {assessment && stage === "consultation_completed" && !isAdmin && <section className="psa-section" aria-labelledby="psa-final-worker"><h3 id="psa-final-worker">Stage 5 · Final worker signature</h3><div className="psa-body"><div className="psa-readonly"><strong>Meeting held:</strong> {displayDate(assessment.meeting_date)} · {assessment.meeting_location}<br /><strong>Outcomes:</strong> {assessment.meeting_outcomes}</div><label className="psa-inline-check"><input type="checkbox" checked={finalSignature.confirmed} onChange={(event) => setFinalSignature({ ...finalSignature, confirmed: event.target.checked })} />I confirm that I have participated in, or had the opportunity to participate in, the consultation and have received the recorded outcomes.</label><label className="psa-field"><span>Final worker signature (type full name)</span><input value={finalSignature.signature} onChange={(event) => setFinalSignature({ ...finalSignature, signature: event.target.value })} autoComplete="name" /></label><button type="button" className="psa-btn" disabled={saving} onClick={() => request({ id: assessment.id, action: "worker_final_sign", worker_signature_final: finalSignature.signature, worker_final_signature_confirmed: finalSignature.confirmed }, "Final worker signature recorded. The WHS Officer can now close the assessment.")}><CheckCircle2 size={15} aria-hidden="true" />Record final signature</button></div></section>}

      {assessment && stage === "consultation_completed" && isAdmin && <section className="psa-section" aria-labelledby="psa-close"><h3 id="psa-close">Stage 5 · Declaration and close-out</h3><div className="psa-body"><p className="psa-muted">Close-out remains unavailable until the persisted meeting, corrective actions, worker acknowledgement and worker final signature gates are complete.</p><div className="psa-row2"><label className="psa-field"><span>WHS Officer name</span><input value={closeOut.whs_officer_name} onChange={(event) => setCloseOut({ ...closeOut, whs_officer_name: event.target.value })} /></label><label className="psa-field"><span>WHS Officer review date</span><input type="date" value={closeOut.whs_officer_review_date} onChange={(event) => setCloseOut({ ...closeOut, whs_officer_review_date: event.target.value })} /></label></div><div className="psa-row2"><label className="psa-field"><span>WHS Officer signature (type full name)</span><input value={closeOut.whs_officer_signature} onChange={(event) => setCloseOut({ ...closeOut, whs_officer_signature: event.target.value })} /></label><label className="psa-field"><span>Project Manager name</span><input value={closeOut.project_manager_name} onChange={(event) => setCloseOut({ ...closeOut, project_manager_name: event.target.value })} /></label></div><label className="psa-field"><span>Project Manager signature (type full name)</span><input value={closeOut.project_manager_signature} onChange={(event) => setCloseOut({ ...closeOut, project_manager_signature: event.target.value })} /></label><button type="button" className="psa-btn danger" disabled={saving} onClick={() => request({ id: assessment.id, action: "close_out", ...closeOut }, "Assessment closed.")}>Close assessment</button></div></section>}

      {assessment && stage === "closed" && <section className="psa-section"><h3>Assessment closed</h3><div className="psa-body"><p className="psa-readonly"><CheckCircle2 size={15} aria-hidden="true" /> Closed on {displayDate(assessment.closed_at?.slice(0, 10))}. Follow-up remains due on {displayDate(assessment.follow_up_review_date)}.</p></div></section>}
    </section>
  );
}
