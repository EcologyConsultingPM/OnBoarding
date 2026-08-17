"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import NumberedSwmsRows, { blankRow } from "./NumberedSwmsRows";

const initialForm = {
  title: "",
  projectName: "",
  siteLocation: "",
  workActivity: "",
  teamAndRoles: "",
  emergencyArrangements: "",
  consultationNotes: "",
  reviewDate: "",
};

function optional(value) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export default function SwmsDraftWorkspace() {
  const { session, loading } = useAuth();
  const [documentType, setDocumentType] = useState("swms");
  const [form, setForm] = useState(initialForm);
  const [rows, setRows] = useState([blankRow("hazard", 1)]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeHazards = useMemo(() => rows.filter((row) => row.rowType === "hazard" && row.description.trim()), [rows]);
  const activePsychosocial = useMemo(() => rows.filter((row) => row.rowType === "psychosocial" && row.description.trim()), [rows]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!session?.access_token) {
      setError("Your sign-in session has expired. Please sign in again.");
      return;
    }
    if (form.title.trim().length < 3 || form.workActivity.trim().length < 3) {
      setError("Provide a draft title and the work activity before saving.");
      return;
    }
    if (documentType === "swms" && !activeHazards.length) {
      setError("Add at least one known hazard for a SWMS draft.");
      return;
    }
    if (documentType === "psychosocial" && !activePsychosocial.length) {
      setError("Add at least one psychosocial factor for this assessment.");
      return;
    }

    setSaving(true);
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      };
      const draftResponse = await fetch("/api/whs-drafts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          documentType,
          title: form.title.trim(),
          projectName: optional(form.projectName),
          siteLocation: optional(form.siteLocation),
          workActivity: form.workActivity.trim(),
          teamAndRoles: optional(form.teamAndRoles),
          emergencyArrangements: optional(form.emergencyArrangements),
          consultationNotes: optional(form.consultationNotes),
          reviewDate: optional(form.reviewDate),
        }),
      });
      const draftPayload = await draftResponse.json();
      if (!draftResponse.ok) throw new Error(draftPayload.error || "Could not create the draft.");

      const rowResponse = await fetch(`/api/whs-drafts/${draftPayload.draft.id}/risk-rows`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ rows }),
      });
      const rowPayload = await rowResponse.json();
      if (!rowResponse.ok) throw new Error(rowPayload.error || "Could not save the numbered rows.");

      setMessage(`Working draft saved with ${rowPayload.saved} numbered row${rowPayload.saved === 1 ? "" : "s"}. It requires competent review before use.`);
      setForm(initialForm);
      setRows([blankRow("hazard", 1)]);
    } catch (requestError) {
      setError(requestError.message || "Could not save the working draft.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="swms-page"><p>Loading your workspace…</p></main>;

  return (
    <main className="swms-page">
      <header className="swms-hero">
        <span><ShieldCheck size={18} /> Ecology Consulting · WHS working draft</span>
        <h1>Draft a numbered SWMS or psychosocial assessment</h1>
        <p>Each hazard or psychosocial factor is recorded in an individual numbered row. This creates a working draft only and does not approve work or confirm safety.</p>
      </header>
      <div className="swms-safety-notice"><AlertCircle size={20} /><p>All information must be field-verified, consulted on and competently reviewed before the document is used.</p></div>
      <form className="swms-form" onSubmit={submit}>
        <div className="swms-tabs" role="tablist">
          <button type="button" className={documentType === "swms" ? "active" : ""} onClick={() => setDocumentType("swms")}>SWMS</button>
          <button type="button" className={documentType === "psychosocial" ? "active" : ""} onClick={() => setDocumentType("psychosocial")}>Psychosocial assessment</button>
        </div>
        <div className="swms-two-fields">
          <label>Draft title<input value={form.title} onChange={(event) => setField("title", event.target.value)} required /></label>
          <label>Project name<input value={form.projectName} onChange={(event) => setField("projectName", event.target.value)} /></label>
        </div>
        <div className="swms-two-fields">
          <label>Site or workplace location<input value={form.siteLocation} onChange={(event) => setField("siteLocation", event.target.value)} /></label>
          <label>Review date<input value={form.reviewDate} onChange={(event) => setField("reviewDate", event.target.value)} placeholder="Before mobilisation / date" /></label>
        </div>
        <label>Work activity or assessment context<textarea value={form.workActivity} onChange={(event) => setField("workActivity", event.target.value)} required /></label>
        <label>People, team and roles<textarea value={form.teamAndRoles} onChange={(event) => setField("teamAndRoles", event.target.value)} /></label>
        <NumberedSwmsRows rowType="hazard" rows={rows} onChange={setRows} />
        <NumberedSwmsRows rowType="psychosocial" rows={rows} onChange={setRows} />
        <div className="swms-two-fields">
          <label>Emergency arrangements<textarea value={form.emergencyArrangements} onChange={(event) => setField("emergencyArrangements", event.target.value)} /></label>
          <label>Consultation notes<textarea value={form.consultationNotes} onChange={(event) => setField("consultationNotes", event.target.value)} /></label>
        </div>
        {error ? <p className="swms-error" role="alert">{error}</p> : null}
        {message ? <p className="swms-success" role="status"><CheckCircle2 size={18} /> {message}</p> : null}
        <button className="swms-submit" disabled={saving} type="submit"><ClipboardList size={17} /> {saving ? "Saving working draft…" : "Save working draft"}</button>
      </form>
    </main>
  );
}
