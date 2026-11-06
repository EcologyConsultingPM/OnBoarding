"use client";

import { useState } from "react";
import { buildGeneralEcologicalSwmsHtml, normaliseGeneralEcologicalSwmsDetails, GENERAL_ECOLOGICAL_SWMS_TEMPLATE_HASH } from "../lib/generalEcologicalSwmsTemplate";

/** Export only the authorised record already returned by the own-history/admin API. */
export default function GeneralEcologicalSwmsRecord({ details }) {
  const [error, setError] = useState("");
  if (details?.templateVersion !== 2 || details.documentCode !== "EC-SWMS00") return null;
  const render = () => {
    if (details.templateHash !== GENERAL_ECOLOGICAL_SWMS_TEMPLATE_HASH) throw new Error("This record uses another controlled revision. Export it using its original template; it has not been changed.");
    const checked = normaliseGeneralEcologicalSwmsDetails(details, { controlledDates: { documentReleaseDate: details.documentReleaseDate, nextReview: details.nextReview } });
    if (checked.errors.length) throw new Error("This saved record is incomplete or cannot be validated for export. The original record remains unchanged.");
    return buildGeneralEcologicalSwmsHtml(checked.details, { controlledDates: { documentReleaseDate: details.documentReleaseDate, nextReview: details.nextReview } });
  };
  const print = async () => {
    setError("");
    try {
      const html = render();
      const popup = window.open("", "_blank");
      if (!popup) throw new Error("Allow pop-ups to open the landscape PDF print document.");
      popup.opener = null;
      popup.document.open(); popup.document.write(html); popup.document.close();
      await Promise.all([...popup.document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })));
      if (popup.document.fonts?.ready) await popup.document.fonts.ready;
      popup.focus(); popup.print();
    } catch (e) { setError(e.message || "The saved SWMS could not be exported."); }
  };
  const download = () => {
    setError("");
    try {
      const url = URL.createObjectURL(new Blob([render()], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "EC-SWMS00-completed.html"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e.message || "The saved SWMS could not be exported."); }
  };
  return <div style={{ marginTop: 12 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" onClick={print} style={{ padding: "8px 12px", background: "#f5f6f1", color: "#174d35", border: "1px solid #cad6c8", borderRadius: 6 }}>Print / Save landscape PDF</button>
      <button type="button" onClick={download} style={{ padding: "8px 12px", background: "#f5f6f1", color: "#174d35", border: "1px solid #cad6c8", borderRadius: 6 }}>Download completed HTML</button>
    </div>
    <p style={{ fontSize: 12, margin: "8px 0" }}>Saved signed record — no editing. For PDF choose A4, Landscape, background graphics on and browser headers/footers off.</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
