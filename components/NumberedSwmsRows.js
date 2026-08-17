"use client";

import { Plus, Trash2 } from "lucide-react";

const ROW_TYPES = {
  hazard: "Known hazards",
  psychosocial: "Psychosocial factors",
};

export function blankRow(rowType, rowNumber) {
  return {
    rowNumber,
    rowType,
    description: "",
    peopleAtRisk: "",
    existingControls: "",
    proposedControls: "",
    residualRisk: "",
  };
}

export default function NumberedSwmsRows({ rowType, rows, onChange }) {
  const visibleRows = rows.filter((row) => row.rowType === rowType);
  const update = (rowNumber, field, value) => {
    onChange(rows.map((row) => (
      row.rowType === rowType && row.rowNumber === rowNumber
        ? { ...row, [field]: value }
        : row
    )));
  };
  const add = () => onChange([...rows, blankRow(rowType, visibleRows.length + 1)]);
  const remove = (rowNumber) => {
    const retained = rows.filter((row) => !(row.rowType === rowType && row.rowNumber === rowNumber));
    const renumbered = retained
      .filter((row) => row.rowType === rowType)
      .map((row, index) => ({ ...row, rowNumber: index + 1 }));
    onChange([...retained.filter((row) => row.rowType !== rowType), ...renumbered]);
  };

  return (
    <section className="swms-numbered-rows" aria-labelledby={`${rowType}-rows-title`}>
      <div className="swms-row-heading">
        <div>
          <p>Controlled draft input</p>
          <h2 id={`${rowType}-rows-title`}>{ROW_TYPES[rowType]}</h2>
          <span>Add one factor per numbered row. Information remains subject to competent review.</span>
        </div>
      </div>
      {visibleRows.map((row) => (
        <article className="swms-row-card" key={`${rowType}-${row.rowNumber}`}>
          <div className="swms-row-number">{row.rowNumber}</div>
          <div className="swms-row-fields">
            <label>Description
              <textarea value={row.description} onChange={(event) => update(row.rowNumber, "description", event.target.value)} required placeholder={rowType === "hazard" ? "Describe one hazard." : "Describe one psychosocial factor."} />
            </label>
            <div className="swms-two-fields">
              <label>People at risk
                <input value={row.peopleAtRisk} onChange={(event) => update(row.rowNumber, "peopleAtRisk", event.target.value)} />
              </label>
              <label>Residual-risk review
                <input value={row.residualRisk} onChange={(event) => update(row.rowNumber, "residualRisk", event.target.value)} placeholder="To be confirmed" />
              </label>
            </div>
            <label>Existing verified controls
              <textarea value={row.existingControls} onChange={(event) => update(row.rowNumber, "existingControls", event.target.value)} />
            </label>
            <label>Proposed controls for review
              <textarea value={row.proposedControls} onChange={(event) => update(row.rowNumber, "proposedControls", event.target.value)} />
            </label>
            <button type="button" className="swms-remove-row" onClick={() => remove(row.rowNumber)}>
              <Trash2 size={15} /> Remove row {row.rowNumber}
            </button>
          </div>
        </article>
      ))}
      <button type="button" className="swms-add-row" onClick={add}>
        <Plus size={16} /> Add {rowType === "hazard" ? "hazard" : "psychosocial factor"} row
      </button>
    </section>
  );
}
