"use client";

import { PRE_FIELDWORK_BIOLOGICAL_SECTION } from "../lib/preMobilisationChecklist";

const OUTCOME_LABELS = { yes: "Yes", no: "No", na: "N/A" };

export default function PreMobilisationBiologicalRecord({ details }) {
  if (!Array.isArray(details?.biologicalChecks)) return null;
  const rows = new Map(details.biologicalChecks.map((row) => [row?.id, row]));
  const counts = { yes: 0, no: 0, na: 0 };
  for (const definition of PRE_FIELDWORK_BIOLOGICAL_SECTION.rows) {
    const outcome = rows.get(definition.id)?.outcome;
    if (Object.hasOwn(counts, outcome)) counts[outcome] += 1;
  }
  return (
    <details className="whs-bio-record">
      <summary>Pre-fieldwork biological hazard checklist — {counts.yes} Yes · {counts.no} No · {counts.na} N/A</summary>
      <p>Stored staff responses and comments/actions. A No response identifies an uncompleted check or control; review the Office action record before proceeding.</p>
      <div className="whs-bio-record-scroll" tabIndex={0} aria-label="Biological hazard checklist responses">
        <table>
          <caption>Pre-fieldwork biological hazard checklist</caption>
          <thead><tr><th scope="col">Check</th><th scope="col">Yes / No / N/A</th><th scope="col">Comments / action</th></tr></thead>
          <tbody>{PRE_FIELDWORK_BIOLOGICAL_SECTION.rows.map((definition) => {
            const row = rows.get(definition.id);
            return <tr key={definition.id}><th scope="row">{definition.check}</th><td>{OUTCOME_LABELS[row?.outcome] || "Not recorded"}</td><td>{typeof row?.action === "string" && row.action.trim() ? row.action : "—"}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {typeof details.approval?.failedItemsAction === "string" && details.approval.failedItemsAction.trim() ? <p><strong>Office action record:</strong> {details.approval.failedItemsAction}</p> : null}
      <style>{`
        .whs-bio-record{margin:12px 0;padding:12px;border:1px solid #bdccc0;border-radius:8px;background:#fafbf7;color:#193d2b;min-width:0}
        .whs-bio-record summary{font-weight:700;cursor:pointer;line-height:1.45}
        .whs-bio-record p{font-size:13px;line-height:1.5;overflow-wrap:anywhere}
        .whs-bio-record-scroll{max-width:100%;overflow-x:auto}
        .whs-bio-record table{width:100%;min-width:580px;border-collapse:collapse;font-size:13px;color:#193d2b}
        .whs-bio-record caption{text-align:left;font-weight:700;padding:8px 0}
        .whs-bio-record th,.whs-bio-record td{padding:9px;text-align:left;vertical-align:top;border:1px solid #d4ded4;white-space:pre-wrap;overflow-wrap:anywhere}
        .whs-bio-record thead th{background:#e6eee3;color:#193d2b}
        .whs-bio-record tbody th{font-weight:500;width:50%}
        .whs-bio-record summary:focus-visible,.whs-bio-record-scroll:focus-visible{outline:2px solid #235c3a;outline-offset:3px}
      `}</style>
    </details>
  );
}
