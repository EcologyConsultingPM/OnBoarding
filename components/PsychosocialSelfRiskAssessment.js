"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HeartHandshake,
  Lock,
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

const LIKELIHOOD = ["Rare (1)", "Unlikely (2)", "Possible (3)", "Likely (4)", "Almost Certain (5)"];
const CONSEQUENCE = ["Minor (1)", "Moderate (2)", "Major (3)", "Catastrophic (4)"];

function ratingBand(likelihoodIndex, consequenceIndex) {
  if (likelihoodIndex < 0 || consequenceIndex < 0) return null;
  const score = (likelihoodIndex + 1) * (consequenceIndex + 1);
  if (score >= 15) return { label: "Extreme", score, band: "extreme" };
  if (score >= 8) return { label: "High", score, band: "high" };
  if (score >= 4) return { label: "Medium", score, band: "medium" };
  return { label: "Low", score, band: "low" };
}
const BAND_COLOR = { extreme: "#a5342a", high: "#c9702d", medium: "#c98a1e", low: "#2c6a34" };

function blankRegisterRow() {
  return { activity: "", hazard_category: "", hazard_detail: "", exposure: "", controls: "", effectiveness: "", likelihood: "", consequence: "" };
}

const STAGE_LABEL = {
  draft: "Draft — not yet submitted",
  submitted: "Submitted — awaiting WHS Officer review",
  whs_review: "Reviewed — findings being prepared",
  returned_to_worker: "Findings returned — awaiting your acknowledgement",
  consultation_scheduled: "Consultation meeting recorded",
  closed: "Closed",
};

export default function PsychosocialSelfRiskAssessment({ assessmentId = null }) {
  const { session, isAdmin } = useAuth();
  const [assessment, setAssessment] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const headers = useCallback(() => ({ "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);

  const [form, setForm] = useState({
    position: "", assessment_date: "", workplace_location: "", scope: "",
    assessment_methods: [], hazard_categories: [], hazard_register: [blankRegisterRow()],
    additional_notes: "", discuss_in_person: false, submitted_to: "Tony Webster — WHS Officer",
    worker_declaration_signature: "",
  });
  const [reviewForm, setReviewForm] = useState({
    root_cause_analysis: "", corrective_action_plan: [], risk_ratings_validated: "", controls_reviewed_finding: "",
    additional_actions_identified: "", individual_action_plan_required: "", highest_residual_risk: "",
  });
  const [meetingForm, setMeetingForm] = useState({
    meeting_date: "", meeting_time: "", meeting_format: "", meeting_location: "", support_person: "",
    meeting_attendees: [], meeting_items: [], matters_not_agreed: "", follow_up_review_date: "",
    next_assessment_due: "", escalated_to_leadership: "",
  });
  const [closeForm, setCloseForm] = useState({
    worker_signature_final: "", whs_officer_name: "", whs_officer_review_date: "", project_manager_name: "",
  });

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      if (assessmentId) {
        const res = await fetch(`/api/psychosocial-assessments?id=${assessmentId}`, { headers: headers() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAssessment(data.assessment);
      } else {
        const res = await fetch("/api/psychosocial-assessments", { headers: headers() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setList(data.assessments || []);
        const openOne = (data.assessments || []).find((a) => a.stage !== "closed");
        setAssessment(openOne || null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, headers, assessmentId]);
  useEffect(() => { load(); }, [load]);

  const setRow = (index, patch) => setForm((f) => ({ ...f, hazard_register: f.hazard_register.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  const addRow = () => setForm((f) => ({ ...f, hazard_register: [...f.hazard_register, blankRegisterRow()] }));
  const toggleMethod = (method) => setForm((f) => ({ ...f, assessment_methods: f.assessment_methods.includes(method) ? f.assessment_methods.filter((m) => m !== method) : [...f.assessment_methods, method] }));
  const toggleCategory = (cat) => setForm((f) => ({ ...f, hazard_categories: f.hazard_categories.includes(cat) ? f.hazard_categories.filter((c) => c !== cat) : [...f.hazard_categories, cat] }));

  const registerWithRatings = () => form.hazard_register.map((r) => {
    const band = ratingBand(LIKELIHOOD.indexOf(r.likelihood), CONSEQUENCE.indexOf(r.consequence));
    return { ...r, rating_band: band?.band || null, rating_score: band?.score || null };
  });

  const saveDraft = async (submit) => {
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, hazard_register: registerWithRatings() };
      const body = assessment?.id
        ? { id: assessment.id, action: submit ? "submit" : "save_draft", ...payload }
        : { ...payload, submit };
      const res = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssessment(data.assessment);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitReview = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify({ id: assessment.id, action: "whs_review", ...reviewForm }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssessment(data.assessment);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const returnToWorker = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify({ id: assessment.id, action: "return_to_worker", returned_by: reviewForm.whs_officer_name || "WHS Officer", return_method: "Portal notification" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssessment(data.assessment);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const acknowledge = async (signature, response) => {
    setSaving(true);
    try {
      const res = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify({ id: assessment.id, action: "worker_acknowledge", worker_acknowledgement_signature: signature, worker_response_before_meeting: response }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssessment(data.assessment);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const recordMeeting = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify({ id: assessment.id, action: "record_meeting", ...meetingForm }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssessment(data.assessment);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const closeOut = async () => {
    if (!window.confirm("Close this assessment? This is the final step and cannot be undone.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/psychosocial-assessments", { method: "POST", headers: headers(), body: JSON.stringify({ id: assessment.id, action: "close_out", meeting_date: assessment.meeting_date, ...closeForm }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssessment(data.assessment);
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  if (loading) return <p className="psa-loading">Loading…</p>;

  const stage = assessment?.stage || "draft";

  return (
    <div className="psa">
      <style>{`
        .psa { max-width: 900px; }
        .psa-header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
        .psa-header h2 { margin: 0; font-size: 20px; }
        .psa-stage { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 20px; background: #eef6ea; color: #1f5a34; margin-bottom: 16px; }
        .psa-critical { background: #fde2e1; color: #a5342a; padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; display: flex; gap: 8px; align-items: center; }
        .psa-restricted { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #6b7280; margin-bottom: 16px; }
        .psa-section { border: 1px solid #e3ded2; border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
        .psa-section-head { background: #f7f8f2; padding: 10px 16px; font-weight: 700; font-size: 13.5px; border-bottom: 1px solid #e3ded2; }
        .psa-section-body { padding: 14px 16px; }
        .psa-field { margin-bottom: 12px; }
        .psa-field label { display: block; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 4px; }
        .psa-field input, .psa-field select, .psa-field textarea { width: 100%; padding: 8px 10px; border: 1px solid #d9d3c6; border-radius: 6px; font-size: 13.5px; box-sizing: border-box; font-family: inherit; }
        .psa-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .psa-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        .psa-checks { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .psa-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 6px 10px; border-radius: 6px; border: 1px solid #d9d3c6; cursor: pointer; }
        .psa-check.active { background: #1f5a34; color: #fff; border-color: #1f5a34; }
        .psa-register-row { border: 1px solid #e3ded2; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
        .psa-rating { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 10px; color: #fff; }
        .psa-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 8px; border: none; background: #1f5a34; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer; }
        .psa-btn.secondary { background: #fff; color: #1f5a34; border: 1px solid #1f5a34; }
        .psa-btn:disabled { opacity: .5; cursor: not-allowed; }
        .psa-error { background: #fde2e1; color: #a5342a; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 13px; }
        .psa-readonly { background: #f7f8f2; border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: #374151; margin-bottom: 10px; }
        @media (max-width: 480px) {
          .psa-row2 { grid-template-columns: 1fr; }
          .psa-row3 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="psa-header"><HeartHandshake size={20} /><h2>Psychosocial Self Risk Assessment</h2></div>
      <div className="psa-restricted"><Lock size={12} /> Restricted Psychosocial Register — visible only to you, the WHS Officer/Director, and the Project Manager.</div>
      {assessment ? <div className="psa-stage"><ShieldAlert size={13} /> {STAGE_LABEL[stage]}</div> : null}
      {assessment?.is_critical ? <div className="psa-critical"><AlertCircle size={16} /> Critical Psychosocial Risk flagged — the WHS Officer has been notified immediately.</div> : null}
      {error ? <p className="psa-error">{error}</p> : null}

      {/* STAGE 1 — worker draft/submit */}
      {(!assessment || stage === "draft") ? (
        <>
          <div className="psa-section">
            <div className="psa-section-head">2. Assessment details</div>
            <div className="psa-section-body">
              <div className="psa-row3">
                <label className="psa-field"><span>Position / role</span>
                  <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                    <option value="">Select…</option>
                    <option>Ecologist</option><option>GIS Lead</option><option>Senior Ecologist</option>
                    <option>Administration</option><option>Project Manager</option><option>Managing Director</option>
                  </select>
                </label>
                <label className="psa-field"><span>Assessment date</span><input type="date" value={form.assessment_date} onChange={(e) => setForm({ ...form, assessment_date: e.target.value })} /></label>
                <label className="psa-field"><span>Main workplace / location</span><input value={form.workplace_location} onChange={(e) => setForm({ ...form, workplace_location: e.target.value })} placeholder="Office, site, home-based or hybrid" /></label>
              </div>
              <label className="psa-field"><span>Scope of assessment</span><input value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="e.g. Psychosocial hazard and risk assessment — Q3 2026" /></label>
              <label className="psa-field"><span>Assessment method — select all that apply</span></label>
              <div className="psa-checks">
                {["Worker self-assessment", "Focus group / consultation", "Incident review", "Worksite observation", "Meeting / interview"].map((m) => (
                  <div key={m} className={`psa-check ${form.assessment_methods.includes(m) ? "active" : ""}`} onClick={() => toggleMethod(m)}>{m}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="psa-section">
            <div className="psa-section-head">3. Psychosocial hazard categories present</div>
            <div className="psa-section-body">
              <div className="psa-checks">
                {HAZARD_CATEGORIES.map((c) => (
                  <div key={c} className={`psa-check ${form.hazard_categories.includes(c) ? "active" : ""}`} onClick={() => toggleCategory(c)}>{c}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="psa-section">
            <div className="psa-section-head">5. Hazard identification and risk assessment register</div>
            <div className="psa-section-body">
              <p style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 10 }}>Assess at least three to five work activities.</p>
              {form.hazard_register.map((row, i) => {
                const band = ratingBand(LIKELIHOOD.indexOf(row.likelihood), CONSEQUENCE.indexOf(row.consequence));
                return (
                  <div key={i} className="psa-register-row">
                    <div className="psa-row2">
                      <label className="psa-field"><span>Activity / task</span><input value={row.activity} onChange={(e) => setRow(i, { activity: e.target.value })} placeholder="e.g. Remote reporting" /></label>
                      <label className="psa-field"><span>Hazard category</span>
                        <select value={row.hazard_category} onChange={(e) => setRow(i, { hazard_category: e.target.value })}>
                          <option value="">Select hazard…</option>
                          {HAZARD_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="psa-field"><span>Specific hazard &amp; source</span><textarea rows={2} value={row.hazard_detail} onChange={(e) => setRow(i, { hazard_detail: e.target.value })} /></label>
                    <label className="psa-field"><span>Existing controls — are they working?</span><textarea rows={2} value={row.controls} onChange={(e) => setRow(i, { controls: e.target.value })} /></label>
                    <div className="psa-row3">
                      <label className="psa-field"><span>Likelihood</span>
                        <select value={row.likelihood} onChange={(e) => setRow(i, { likelihood: e.target.value })}>
                          <option value="">Select…</option>{LIKELIHOOD.map((l) => <option key={l}>{l}</option>)}
                        </select>
                      </label>
                      <label className="psa-field"><span>Consequence</span>
                        <select value={row.consequence} onChange={(e) => setRow(i, { consequence: e.target.value })}>
                          <option value="">Select…</option>{CONSEQUENCE.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </label>
                      <label className="psa-field"><span>Rating</span>
                        {band ? <span className="psa-rating" style={{ background: BAND_COLOR[band.band] }}>{band.score} {band.label}</span> : <span style={{ color: "#9ca3af" }}>—</span>}
                      </label>
                    </div>
                  </div>
                );
              })}
              <button type="button" className="psa-btn secondary" onClick={addRow}>+ Add activity</button>
            </div>
          </div>

          <div className="psa-section">
            <div className="psa-section-head">5B. Submit to the WHS Officer</div>
            <div className="psa-section-body">
              <label className="psa-field"><span>Anything else you want the WHS Officer to know</span><textarea rows={3} value={form.additional_notes} onChange={(e) => setForm({ ...form, additional_notes: e.target.value })} /></label>
              <div className="psa-check" style={{ display: "inline-flex", marginBottom: 12 }} onClick={() => setForm({ ...form, discuss_in_person: !form.discuss_in_person })}>
                <input type="checkbox" checked={form.discuss_in_person} readOnly /> Please contact me before reviewing this assessment
              </div>
              <br />
              <button type="button" className="psa-btn secondary" onClick={() => saveDraft(false)} disabled={saving} style={{ marginRight: 8 }}>Save draft</button>
              <button type="button" className="psa-btn" onClick={() => saveDraft(true)} disabled={saving}><Send size={14} /> {saving ? "Submitting…" : "Submit to WHS Officer"}</button>
            </div>
          </div>
        </>
      ) : null}

      {/* Read-only recap once submitted, for the worker */}
      {assessment && stage !== "draft" && !isAdmin ? (
        <div className="psa-readonly">
          Submitted {assessment.submitted_at ? new Date(assessment.submitted_at).toLocaleDateString("en-AU") : ""} to {assessment.submitted_to}.
          {stage === "returned_to_worker" ? " The WHS Officer has completed their review — read the findings below and acknowledge before your consultation meeting." : " You'll be notified once the WHS Officer has reviewed this."}
        </div>
      ) : null}

      {/* STAGE 2 — WHS review (admin) */}
      {assessment && stage === "submitted" && isAdmin ? (
        <div className="psa-section">
          <div className="psa-section-head">7–8. WHS Officer review</div>
          <div className="psa-section-body">
            <label className="psa-field"><span>Root cause analysis</span><textarea rows={3} value={reviewForm.root_cause_analysis} onChange={(e) => setReviewForm({ ...reviewForm, root_cause_analysis: e.target.value })} /></label>
            <div className="psa-row2">
              <label className="psa-field"><span>Risk ratings validated</span>
                <select value={reviewForm.risk_ratings_validated} onChange={(e) => setReviewForm({ ...reviewForm, risk_ratings_validated: e.target.value })}>
                  <option value="">Select outcome…</option><option>Confirmed as submitted</option><option>Amended — raised</option><option>Amended — lowered</option>
                </select>
              </label>
              <label className="psa-field"><span>Highest residual risk after controls</span>
                <select value={reviewForm.highest_residual_risk} onChange={(e) => setReviewForm({ ...reviewForm, highest_residual_risk: e.target.value })}>
                  <option value="">Select…</option><option>Low</option><option>Medium</option><option>High</option><option>Extreme</option>
                </select>
              </label>
            </div>
            <button type="button" className="psa-btn" onClick={submitReview} disabled={saving}>Save review</button>
            <button type="button" className="psa-btn secondary" style={{ marginLeft: 8 }} onClick={returnToWorker} disabled={saving || !reviewForm.root_cause_analysis}>Return findings to worker</button>
          </div>
        </div>
      ) : null}

      {/* Worker acknowledgement */}
      {assessment && stage === "returned_to_worker" && !isAdmin ? (
        <div className="psa-section">
          <div className="psa-section-head">Acknowledge findings</div>
          <div className="psa-section-body">
            <p style={{ fontSize: 13, marginBottom: 10 }}>{assessment.root_cause_analysis}</p>
            <label className="psa-field"><span>Anything you disagree with or want raised at the meeting (optional)</span><textarea rows={2} onChange={(e) => setForm({ ...form, worker_response_before_meeting: e.target.value })} /></label>
            <button type="button" className="psa-btn" onClick={() => acknowledge("acknowledged", form.worker_response_before_meeting)} disabled={saving}><CheckCircle2 size={14} /> Acknowledge receipt</button>
          </div>
        </div>
      ) : null}

      {/* STAGE 4 — consultation meeting (admin) */}
      {assessment && (stage === "returned_to_worker" || stage === "consultation_scheduled") && isAdmin ? (
        <div className="psa-section">
          <div className="psa-section-head"><Users size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />9. Consultation meeting</div>
          <div className="psa-section-body">
            <div className="psa-row3">
              <label className="psa-field"><span>Meeting date</span><input type="date" value={meetingForm.meeting_date} onChange={(e) => setMeetingForm({ ...meetingForm, meeting_date: e.target.value })} /></label>
              <label className="psa-field"><span>Meeting time</span><input type="time" value={meetingForm.meeting_time} onChange={(e) => setMeetingForm({ ...meetingForm, meeting_time: e.target.value })} /></label>
              <label className="psa-field"><span>Format</span>
                <select value={meetingForm.meeting_format} onChange={(e) => setMeetingForm({ ...meetingForm, meeting_format: e.target.value })}>
                  <option value="">Select…</option><option>In person</option><option>Video call</option><option>Telephone</option>
                </select>
              </label>
            </div>
            <label className="psa-field"><span>Matters not agreed, and how they will be resolved</span><textarea rows={2} value={meetingForm.matters_not_agreed} onChange={(e) => setMeetingForm({ ...meetingForm, matters_not_agreed: e.target.value })} /></label>
            <div className="psa-row2">
              <label className="psa-field"><span>Follow-up review date</span><input type="date" value={meetingForm.follow_up_review_date} onChange={(e) => setMeetingForm({ ...meetingForm, follow_up_review_date: e.target.value })} /></label>
              <label className="psa-field"><span>Next assessment due</span><input type="date" value={meetingForm.next_assessment_due} onChange={(e) => setMeetingForm({ ...meetingForm, next_assessment_due: e.target.value })} /></label>
            </div>
            <button type="button" className="psa-btn" onClick={recordMeeting} disabled={saving || !meetingForm.meeting_date}>Record meeting</button>
          </div>
        </div>
      ) : null}

      {/* STAGE 5 — close-out (admin) */}
      {assessment && stage === "consultation_scheduled" && isAdmin ? (
        <div className="psa-section">
          <div className="psa-section-head">10. Declaration and close-out</div>
          <div className="psa-section-body">
            <div className="psa-row2">
              <label className="psa-field"><span>WHS Officer name</span><input value={closeForm.whs_officer_name} onChange={(e) => setCloseForm({ ...closeForm, whs_officer_name: e.target.value })} /></label>
              <label className="psa-field"><span>Review date</span><input type="date" value={closeForm.whs_officer_review_date} onChange={(e) => setCloseForm({ ...closeForm, whs_officer_review_date: e.target.value })} /></label>
            </div>
            <label className="psa-field"><span>Project Manager (root cause analysis)</span><input value={closeForm.project_manager_name} onChange={(e) => setCloseForm({ ...closeForm, project_manager_name: e.target.value })} /></label>
            <button type="button" className="psa-btn" onClick={closeOut} disabled={saving}>Close assessment</button>
          </div>
        </div>
      ) : null}

      {assessment && stage === "closed" ? <div className="psa-readonly"><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />Closed {assessment.closed_at ? new Date(assessment.closed_at).toLocaleDateString("en-AU") : ""}.</div> : null}

      {!isAdmin && list.length > 1 ? (
        <button type="button" className="psa-btn secondary" onClick={() => setExpanded(!expanded)} style={{ marginTop: 10 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Previous assessments ({list.length - 1})
        </button>
      ) : null}
    </div>
  );
}
