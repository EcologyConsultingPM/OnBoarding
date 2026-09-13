"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, ClipboardCheck, Package } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const KIT_A = [
  { ref: "A1", name: 'AEROPLAST Plastic Fabric Plasters 72mm × 19mm', qty: "25" },
  { ref: "A2", name: 'AEROPLAST Plastic Plasters 72mm × 19mm', qty: "25" },
  { ref: "A3", name: 'AEROAID Antiseptic Spray 50ml', qty: "1" },
  { ref: "A4", name: 'AEROWIPE Cleansing Wipe', qty: "10" },
  { ref: "A5", name: 'AEROSWAB Gauze Swabs 7.5cm × 7.5cm, 3s', qty: "10" },
  { ref: "A6", name: 'AEROPAD™ Low Adherent Dressings 5cm × 5cm', qty: "1" },
  { ref: "A7", name: 'AEROPAD™ Low Adherent Dressings 10cm × 10cm', qty: "1" },
  { ref: "A8", name: 'AEROFORM Conforming Bandage 7.5cm × 4M', qty: "1" },
  { ref: "A9", name: 'AEROPORE Microporous Tape 2.5cm × 5M', qty: "1" },
  { ref: "A10", name: 'AEROGLOVE Nitrile Examination Gloves', qty: "1 pair" },
  { ref: "A11", name: 'AEROINSTRUMENTS Scissor 10cm', qty: "1" },
  { ref: "A12", name: 'AEROINSTRUMENTS Tweezer 12cm', qty: "1" },
  { ref: "A13", name: 'AEROPROBE Splinter Probes 3.7cm', qty: "1" },
  { ref: "A14", name: 'AEROPINS Safety Pins', qty: "12" },
  { ref: "A15", name: 'AEROSUPPLIES Notebook & Pen', qty: "1" },
  { ref: "A16", name: 'First Aid Leaflet', qty: "1" },
  { ref: "A17", name: 'AEROFORM™ Heavyweight Conforming Bandage 10cm × 4m', qty: "1 roll" },
  { ref: "A18", name: 'AEROBAND™ Triangular Bandage 110 × 110 × 155cm', qty: "1" },
  { ref: "A19", name: 'AEROPAD™ Low Adherent Dressings 5cm × 5cm', qty: "3" },
  { ref: "A20", name: 'AEROWOUND™ BPC Wound Dressing #15', qty: "1" },
  { ref: "A21", name: 'AEROWOUND™ Combine Dressing 10cm × 20cm', qty: "1" },
  { ref: "A22", name: 'AEROSWAB™ Gauze Swabs 7.5 × 7.5cm, 3s', qty: "1" },
  { ref: "A23", name: 'AERORESCUE™ Emergency Rescue Blanket (silver)', qty: "1" },
  { ref: "A24", name: 'AEROPLAST™ Instant Ice Pack 80g', qty: "1" },
  { ref: "A25", name: 'AEROPLAST™ Amputated Parts Bag', qty: "1" },
  { ref: "A26", name: 'AEROSHIELD™ CPR Face Shield', qty: "1" },
  { ref: "A27", name: 'AEROGLOVE™ Nitrile Examination Gloves', qty: "1 pair" },
  { ref: "A28", name: 'AEROBURN™ Burn Gel Sachets 3.5g', qty: "8" },
  { ref: "A29", name: 'AEROBURN™ Burn Dressing 10cm × 10cm', qty: "1" },
  { ref: "A30", name: 'AEROBURN™ PE Burn Sheet 10cm × 10cm', qty: "1" },
  { ref: "A31", name: 'AEROBURN™ PE Burn Sheet 20cm × 20cm', qty: "1" },
  { ref: "A32", name: 'AEROBURN™ PE Burn Sheet 60cm × 90cm', qty: "1" },
  { ref: "A33", name: 'AEROFORM™ Conforming Bandage 7.5cm × 4m', qty: "1" },
  { ref: "A34", name: 'AEROGLOVE™ Nitrile Examination Gloves', qty: "1 pair" },
  { ref: "A35", name: 'AEROGUIDE Burns First Aid Card', qty: "1" },
  { ref: "A36", name: 'AEROWASH™ Eye Wash Ampoule', qty: "10" },
  { ref: "A37", name: 'AEROPAD™ Eye Pads', qty: "6" },
  { ref: "A38", name: 'AEROFORM™ Conforming Bandage', qty: "1 roll" },
  { ref: "A39", name: 'AEROPORE™ Microporous Tape', qty: "1" },
  { ref: "A40", name: 'AEROGLOVE™ Nitrile Examination Gloves', qty: "1 pair" },
  { ref: "A41", name: 'Eye Wound Treatment Card', qty: "1" },
  { ref: "A42", name: 'AEROFORM Indicator Bandage', qty: "1 roll" },
  { ref: "A43", name: 'AEROBAND™ Triangular Bandage 110 × 110 × 155cm', qty: "1" },
  { ref: "A44", name: 'AEROPAD™ Low Adherent Dressings 5cm × 5cm', qty: "1" },
  { ref: "A45", name: 'AEROPAD™ Low Adherent Dressings 7.5cm × 10cm', qty: "1" },
  { ref: "A46", name: 'AEROGLOVE™ Nitrile Examination Gloves', qty: "1 pair" },
  { ref: "A47", name: 'Snake Bite Treatment Leaflet', qty: "1" },
  { ref: "A48", name: 'AEROFORM™ Conforming Bandage', qty: "2 rolls" },
  { ref: "A49", name: 'AEROFORM™ Conforming Bandage', qty: "1 roll" },
  { ref: "A50", name: 'AEROPAD™ Low Adherent Dressings', qty: "2" },
  { ref: "A51", name: 'AEROPAD™ Low Adherent Dressings', qty: "3" },
  { ref: "A52", name: 'AEROPAD™ Low Adherent Dressings', qty: "1" },
  { ref: "A53", name: 'AEROSWAB™ Gauze Swabs 7.5 × 7.5cm', qty: "3" },
  { ref: "A54", name: 'AEROWOUND™ BPC Wound Dressing', qty: "1" },
];
const KIT_B = [
  { ref: "B1", name: 'Adhesive Plasters, plastic, 72 × 19mm', qty: "50" },
  { ref: "B2", name: 'Wound Wipe, alcohol swab', qty: "6" },
  { ref: "B3", name: 'Wound Wipe, povidone iodine swab', qty: "6" },
  { ref: "B4", name: 'Wound Wipe, non-sting wipe', qty: "2" },
  { ref: "B5", name: 'Gauze Swabs, 7.5 × 7.5cm, 5pk', qty: "1" },
  { ref: "B6", name: 'Non-Adherent Dressing, 5 × 5cm', qty: "2" },
  { ref: "B7", name: 'Wound Dressing, No.13', qty: "1" },
  { ref: "B8", name: 'Conforming Bandage, 7.5cm', qty: "1" },
  { ref: "B9", name: 'Triangular Bandage, disposable', qty: "1" },
  { ref: "B10", name: 'Paper Tape, hypoallergenic, 1.25cm', qty: "1" },
  { ref: "B11", name: 'Assorted Safety Pins', qty: "12" },
  { ref: "B12", name: 'Eye Pads, non-adherent', qty: "2" },
  { ref: "B13", name: 'Eye Wash, 15ml ampoule', qty: "2" },
  { ref: "B14", name: 'Hydrogel Burn Gel, 3.5g sachet', qty: "1" },
  { ref: "B15", name: 'Cotton Tip Applicators', qty: "20" },
  { ref: "B16", name: 'Disposable Splinter Probes', qty: "10" },
  { ref: "B17", name: 'Tweezers, 9cm steel', qty: "1" },
  { ref: "B18", name: 'Scissors, 9cm steel', qty: "1" },
  { ref: "B19", name: 'Nitrile Disposable Gloves, large', qty: "1 pair" },
  { ref: "B20", name: 'Resuscitation Face Shield, disposable, with valve', qty: "1" },
  { ref: "B21", name: 'Plastic Bag, resealable, medium', qty: "1" },
  { ref: "B22", name: 'Plastic Bag, resealable, small', qty: "1" },
  { ref: "B23", name: 'Emergency First Aid Information Booklet', qty: "1" },
];
const KIT_C = [
  { ref: "C1", name: 'Heavy Crepe Bandage, 10cm', qty: "2" },
  { ref: "C2", name: 'Triangular Bandage, cotton', qty: "1" },
  { ref: "C3", name: 'Instant Cold Pack, small', qty: "1" },
  { ref: "C4", name: 'Emergency First Aid Information Booklet', qty: "1" },
  { ref: "C5", name: 'Snake and Spider Bite Guide', qty: "1" },
];

const OUTCOME_OPTIONS = ["Pass — no action", "Restocked on the spot", "Items ordered — kit still serviceable", "Failed — kit removed from service"];

function blankItemState(items) {
  return items.map((item) => ({ ref: item.ref, qty_in_kit: "", batch_no: "", expiry_date: "", ok: false }));
}
function blankRestockRow() {
  return { kit: "", item: "", issue: "", qty_needed: "", ordered_by: "", date_required: "" };
}

function KitTable({ title, hint, items, values, onChange }) {
  return (
    <div className="fak-kit-table">
      <div className="fak-kit-hint"><b>How to complete</b>{hint}</div>
      <div className="fak-table-scroll">
        <table>
          <thead><tr><th>Ref</th><th>Kit contents</th><th>Qty required</th><th>Qty in kit</th><th>Batch no</th><th>Expiry</th><th>OK</th></tr></thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.ref} className={i % 2 ? "alt" : ""}>
                <td className="ref">{item.ref}</td>
                <td className="desc">{item.name}</td>
                <td className="desc" style={{ textAlign: "center" }}>{item.qty}</td>
                <td><input type="text" value={values[i]?.qty_in_kit || ""} onChange={(e) => onChange(i, { qty_in_kit: e.target.value })} /></td>
                <td><input type="text" placeholder="If applicable" value={values[i]?.batch_no || ""} onChange={(e) => onChange(i, { batch_no: e.target.value })} /></td>
                <td><input type="text" placeholder="mm/yyyy" value={values[i]?.expiry_date || ""} onChange={(e) => onChange(i, { expiry_date: e.target.value })} /></td>
                <td className="c"><input type="checkbox" checked={values[i]?.ok || false} onChange={(e) => onChange(i, { ok: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FirstAidKitChecks() {
  const { session } = useAuth();
  const [kitA, setKitA] = useState(blankItemState(KIT_A));
  const [kitB, setKitB] = useState(blankItemState(KIT_B));
  const [kitC, setKitC] = useState(blankItemState(KIT_C));
  const [outcomeA, setOutcomeA] = useState("");
  const [outcomeB, setOutcomeB] = useState("");
  const [outcomeBNotes, setOutcomeBNotes] = useState("");
  const [outcomeC, setOutcomeC] = useState("");
  const [restock, setRestock] = useState([blankRestockRow()]);
  const [usageNotes, setUsageNotes] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [checkDate, setCheckDate] = useState("");
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const patchItem = (setFn) => (index, patch) => setFn((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const patchRestock = (index, patch) => setRestock((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!checkDate) { setError("Check date is required."); return; }
    if (!signature.trim()) { setError("Sign to confirm you physically checked each kit."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/first-aid-kit-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer \${session?.access_token || ""}` },
        body: JSON.stringify({
          check_date: checkDate,
          kit_a_items: kitA, kit_a_outcome: outcomeA,
          kit_b_items: kitB, kit_b_outcome: outcomeB, kit_b_notes: outcomeBNotes,
          kit_c_items: kitC, kit_c_outcome: outcomeC,
          restock_register: restock.filter((r) => r.item.trim()),
          usage_notes: usageNotes,
          signature: signature.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="fak-done">
        <CheckCircle2 size={28} />
        <h3>First aid kit check submitted</h3>
        <p>Thank you — recorded {checkDate}.</p>
      </div>
    );
  }

  return (
    <div className="fak">
      <style>{`
        .fak { max-width: 950px; }
        .fak-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .fak-header h2 { margin: 0; font-size: 20px; }
        .fak-section { border: 1px solid #e3ded2; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
        .fak-section-head { background: #f7f8f2; padding: 10px 16px; font-weight: 700; font-size: 13.5px; border-bottom: 1px solid #e3ded2; }
        .fak-kit-table { padding: 14px 16px; }
        .fak-kit-hint { background: #fbf6e6; border: 1px solid #ece0bc; border-left: 3px solid #c9962a; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; color: #6e5e33; }
        .fak-kit-hint b { display: block; font-size: 10px; text-transform: uppercase; color: #8a6a1c; margin-bottom: 2px; }
        .fak-table-scroll { overflow-x: auto; border: 1px solid #e3ded2; border-radius: 6px; }
        .fak table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .fak th { background: #14261a; color: #fff; padding: 8px 9px; font-size: 11.5px; text-align: left; white-space: nowrap; }
        .fak td { border: 1px solid #eaeff5; padding: 3px; }
        .fak td.ref { font-weight: 700; color: #1f5a34; padding: 7px 8px; white-space: nowrap; }
        .fak td.desc { padding: 7px 8px; }
        .fak td.c { text-align: center; }
        .fak td input[type=text] { border: none; padding: 6px 8px; font-size: 11.5px; width: 100%; box-sizing: border-box; }
        .fak tr.alt td { background: #faf7f0; }
        .fak-outcome-row { padding: 0 16px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .fak-field { margin-bottom: 12px; }
        .fak-field label { display: block; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
        .fak-field input, .fak-field select, .fak-field textarea { width: 100%; padding: 8px 10px; border: 1px solid #d9d3c6; border-radius: 6px; font-size: 13.5px; box-sizing: border-box; font-family: inherit; }
        .fak-restock-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 8px; }
        .fak-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 8px; border: none; background: #1f5a34; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer; }
        .fak-btn.secondary { background: #fff; color: #1f5a34; border: 1px solid #1f5a34; }
        .fak-btn:disabled { opacity: .5; }
        .fak-error { background: #fde2e1; color: #a5342a; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 13px; }
        .fak-done { text-align: center; padding: 40px 20px; color: #1f5a34; }
        @media (max-width: 480px) {
          .fak-outcome-row { grid-template-columns: 1fr; }
          .fak-restock-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="fak-header"><Package size={20} /><h2>First Aid Kit Checks</h2></div>
      {error ? <p className="fak-error">{error}</p> : null}

      <div className="fak-section">
        <div className="fak-section-head">2. Kit A — Modulator First Aid Kit</div>
        <KitTable hint="Six modules — cuts &amp; grazes, trauma, burns, eye wound, snake bite, dressing &amp; bandage. Check every module. Record the batch number where the item carries one." items={KIT_A} values={kitA} onChange={patchItem(setKitA)} />
        <div className="fak-outcome-row">
          <label className="fak-field"><span>Kit A outcome</span>
            <select value={outcomeA} onChange={(e) => setOutcomeA(e.target.value)}>
              <option value="">Select…</option>{OUTCOME_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="fak-section">
        <div className="fak-section-head">3. Kit B — FastAid Family Soft Pack</div>
        <KitTable hint="Soft-pack kit carried with the crew. 23 line items — record quantity held, batch number where applicable, and the earliest expiry." items={KIT_B} values={kitB} onChange={patchItem(setKitB)} />
        <div className="fak-outcome-row">
          <label className="fak-field"><span>Kit B outcome</span>
            <select value={outcomeB} onChange={(e) => setOutcomeB(e.target.value)}>
              <option value="">Select…</option>{OUTCOME_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="fak-field"><span>Notes</span><input value={outcomeBNotes} onChange={(e) => setOutcomeBNotes(e.target.value)} placeholder="Anything the Administration Officer needs to replenish" /></label>
        </div>
      </div>

      <div className="fak-section">
        <div className="fak-section-head">4. Kit C — FastAid Compact Snake Bite Kit</div>
        <KitTable hint="Compact pressure-immobilisation kit. Five line items — small, but the bandage expiry is the one that matters." items={KIT_C} values={kitC} onChange={patchItem(setKitC)} />
        <div className="fak-outcome-row">
          <label className="fak-field"><span>Kit C outcome</span>
            <select value={outcomeC} onChange={(e) => setOutcomeC(e.target.value)}>
              <option value="">Select…</option>{OUTCOME_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="fak-section">
        <div className="fak-section-head">5. Items expired, missing or used</div>
        <div style={{ padding: "14px 16px" }}>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>Anything ticked off above without an OK goes here, with who is replacing it and by when.</p>
          {restock.map((row, i) => (
            <div key={i} className="fak-restock-row">
              <input placeholder="Kit" value={row.kit} onChange={(e) => patchRestock(i, { kit: e.target.value })} />
              <input placeholder="Item" value={row.item} onChange={(e) => patchRestock(i, { item: e.target.value })} />
              <input placeholder="Issue" value={row.issue} onChange={(e) => patchRestock(i, { issue: e.target.value })} />
              <input placeholder="Qty needed" value={row.qty_needed} onChange={(e) => patchRestock(i, { qty_needed: e.target.value })} />
              <input placeholder="Ordered by" value={row.ordered_by} onChange={(e) => patchRestock(i, { ordered_by: e.target.value })} />
              <input placeholder="Date required" value={row.date_required} onChange={(e) => patchRestock(i, { date_required: e.target.value })} />
            </div>
          ))}
          <button type="button" className="fak-btn secondary" onClick={() => setRestock([...restock, blankRestockRow()])}>+ Add row</button>
          <div className="fak-field" style={{ marginTop: 12 }}>
            <label>Notes — recent first aid use, incidents linked to these kits</label>
            <textarea rows={2} value={usageNotes} onChange={(e) => setUsageNotes(e.target.value)} placeholder="If an item was used, cross-reference the incident report number." />
          </div>
        </div>
      </div>

      <div className="fak-section">
        <div className="fak-section-head"><ClipboardCheck size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />6. Sign-off</div>
        <div style={{ padding: "14px 16px" }}>
          <div className="fak-outcome-row">
            <label className="fak-field"><span>Checked by — name</span><input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} placeholder="Full name" /></label>
            <label className="fak-field"><span>Date</span><input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} /></label>
          </div>
          <label className="fak-field"><span>Signature</span><input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Type your name to sign" /></label>
          <button type="button" className="fak-btn" onClick={submit} disabled={saving}>{saving ? "Submitting…" : "Submit check"}</button>
        </div>
      </div>
    </div>
  );
}
