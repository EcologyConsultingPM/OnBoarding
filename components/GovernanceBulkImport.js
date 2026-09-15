"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, ShieldCheck, Trash2, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";

// The canonical file-name stems supplied for the initial Ecology Consulting
// controlled-document library. Anything not recognised is still allowed, but
// the administrator must classify it manually rather than guessing its type.
const INTAKE = [
  ["EC-WHS-SOP-001", "procedure", "WHS Standard Operating Procedure", "WHS management system"],
  ["EC-WHS-RCA-5WHY-003", "procedure", "5 Why Root Cause Analysis", "Incident investigation"],
  ["EC-WHS-RCA-PEEPO-004", "procedure", "PEEPO Root Cause Analysis", "Incident investigation"],
  ["EC-WHS-PMC-007", "form", "Plant & Machinery Inspection", "Plant and equipment"],
  ["EC-WHS-PSY-001", "plan", "Psychosocial Hazard Control Plan", "Psychosocial risk"],
  ["EC-WHS-INJ-001", "form", "Injury Register", "Incident management"],
  ["EC-WHS-LIB-001", "plan", "Lithium-Ion Battery Emergency Response Plan", "Emergency response"],
  ["EC-WHS-CAR-001", "form", "Corrective Action Tracking Register", "Continuous improvement"],
  ["EC-WHS-IMS-001", "plan", "WHSMS Implementation Plan", "WHS management system"],
  ["EC-PM-RP-001", "project_control", "Resource Plan", "Project management"],
  ["EC-PM-SS-001", "project_control", "Scope Statement", "Project management"],
  ["EC-PM-PSM-001", "project_control", "Project Schedule Milestones", "Project management"],
  ["EC-PM-PSR-001", "project_control", "Project Status Report", "Project management"],
  ["EC-PM-PCR-001", "project_control", "Project Closure Report", "Project management"],
  ["EC-PM-PRR-001", "project_control", "Project Risk Register", "Project management"],
  ["EC-PM-CR-001", "procedure", "Conflict Resolution Procedure", "Project management"],
  ["EC-PM-LL-001", "project_control", "Lessons Learned Register", "Project management"],
  ["EC-FIN-AST-001", "form", "Asset Register", "Assets and equipment"],
  ["EC-PM-COMM-001", "project_control", "Communication & Stakeholder Plan", "Project management"],
  ["EC-BM-CIR-001", "form", "Continuous Improvement Register", "Business management"],
  ["EC-BM-SWOT-001", "project_control", "SWOT Analysis", "Business management"],
  ["EC-HR-TDP-001", "people_capability", "Training & Development Plan", "People and capability"],
  ["EC-HR-PD-001", "people_capability", "Position Description", "People and capability"],
  ["EC-STD-CTR-002", "contractor_control", "Contractor Pre-Qualification Form", "Contractor management"],
];

function classify(file) {
  const row = INTAKE.find(([prefix]) => file.name.toUpperCase().startsWith(prefix));
  return row ? { code: row[0], doc_type: row[1], title: row[2], category: row[3] } : null;
}

export default function GovernanceBulkImport({ onComplete = () => {} }) {
  const { session } = useAuth();
  const fileInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const classified = useMemo(() => files.map((file) => ({ file, metadata: classify(file) })), [files]);
  const unknown = classified.filter((row) => !row.metadata).length;

  const chooseFiles = (event) => {
    setFiles(Array.from(event.target.files || []));
    setMessage("");
  };
  // A single unrecognised file used to block staging every other file in the
  // batch, with no way to see which one was the problem or drop just that
  // one — the only option was re-choosing the entire file selection from
  // scratch. This lets someone remove just the problem file instead.
  const removeFile = (index) => {
    setFiles((current) => current.filter((_, i) => i !== index));
    if (fileInput.current) fileInput.current.value = "";
  };

  const api = async (body) => {
    const response = await fetch("/api/internal-governance", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The document could not be staged.");
    return data;
  };

  const stageDocuments = async () => {
    const recognised = classified.filter((row) => row.metadata);
    if (!recognised.length) return;
    setBusy(true);
    setMessage("");
    const failures = [];
    for (const { file, metadata } of recognised) {
      try {
        const created = await api({
          action: "create",
          doc_type: metadata.doc_type,
          title: metadata.title,
          category: metadata.category,
          version: "1.0",
          body: `Imported controlled source: ${file.name}. Verify document owner, version, effective date and review date before submitting for approval.`,
          document_link: "",
          requires_ack: false,
          requires_training: false,
        });
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const path = `${metadata.doc_type}s/${created.document.id}/v1.0/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from("governance-documents").upload(path, file, { upsert: false, contentType: file.type });
        if (error) throw error;
        const patch = await fetch("/api/internal-governance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
          body: JSON.stringify({ id: created.document.id, action: "edit_draft", storage_path: path, change_note: `Controlled source uploaded from bulk intake: ${file.name}` }),
        });
        if (!patch.ok) throw new Error("The document record was created but its file could not be linked.");
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    setBusy(false);
    const skipped = files.length - recognised.length;
    const skippedNote = skipped ? ` ${skipped} unrecognised file${skipped === 1 ? "" : "s"} skipped — remove or rename to import.` : "";
    if (failures.length) setMessage(`${recognised.length - failures.length} staged. ${failures.length} require attention: ${failures.join("; ")}.${skippedNote}`);
    else {
      setMessage(`${recognised.length} controlled document${recognised.length === 1 ? "" : "s"} staged as drafts for review and approval.${skippedNote}`);
      setFiles((current) => current.filter((file) => !classify(file)));
      if (!skipped && fileInput.current) fileInput.current.value = "";
      onComplete();
    }
  };

  return <section className="governance-bulk-import" aria-label="Controlled document bulk intake">
    <style>{`
      .governance-bulk-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
      .governance-bulk-row { display: flex; align-items: center; gap: 9px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #eaf1e8; font-size: 12.5px; }
      .governance-bulk-row svg { flex-shrink: 0; color: #8fe0b0; }
      .governance-bulk-row.unknown { background: rgba(212,86,63,.12); border-color: rgba(212,86,63,.32); }
      .governance-bulk-row.unknown svg { color: #ff9b86; }
      .governance-bulk-filename { font-weight: 700; flex-shrink: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .governance-bulk-filestatus { flex: 1; color: rgba(234,241,232,.65); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .governance-bulk-row.unknown .governance-bulk-filestatus { color: #ffcfc2; }
      .governance-bulk-remove { flex-shrink: 0; background: none; border: none; color: rgba(234,241,232,.5); cursor: pointer; padding: 4px; }
      .governance-bulk-remove:hover { color: #ff9b86; }
    `}</style>
    <div className="governance-bulk-copy"><span><ShieldCheck size={14} /> Administrator only</span><h2>Stage approved library records</h2><p>Select the supplied controlled PDFs. Recognised document codes are classified automatically and uploaded to the private governance bucket as <strong>Draft</strong>; they are not staff-visible until an administrator reviews and publishes them.</p></div>
    <div className="governance-bulk-actions"><input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple onChange={chooseFiles} /><button className="governance-primary" disabled={busy || !files.length || unknown === files.length} onClick={stageDocuments}>{busy ? <Loader2 className="spin" size={15} /> : <FileUp size={15} />}{busy ? "Staging controlled documents…" : `Stage ${files.length - unknown || ""} document${files.length - unknown === 1 ? "" : "s"}`}</button></div>
    {files.length ? (
      <div className="governance-bulk-list">
        {classified.map(({ file, metadata }, index) => (
          <div key={`${file.name}-${index}`} className={`governance-bulk-row${metadata ? "" : " unknown"}`}>
            {metadata ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span className="governance-bulk-filename">{file.name}</span>
            <span className="governance-bulk-filestatus">{metadata ? metadata.title : "Not recognised — remove or rename to match an approved document code"}</span>
            <button type="button" className="governance-bulk-remove" onClick={() => removeFile(index)} title={`Remove ${file.name}`}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    ) : null}
    {message ? <p className="governance-bulk-message">{message}</p> : null}
  </section>;
}

export { INTAKE };
