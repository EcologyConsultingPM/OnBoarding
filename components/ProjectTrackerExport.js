"use client";

import { useState } from "react";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, FileText, FileType2, Loader2, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

function money(value) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function safeName(value) {
  return String(value || "project-tracker").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function flattenAllocations(project) {
  return (project.sources || []).flatMap((source) => (source.allocations || []).map((allocation) => ({
    Source: `${source.source_code} · ${source.source_name}`,
    Allocation: `${allocation.allocation_code} · ${allocation.allocation_name}`,
    "Approved Budget (AUD)": Number(allocation.allocation_value || 0),
    "Charge-out Spend (AUD)": Number(allocation.charge_out_spend || 0),
    "Internal Cost (AUD)": Number(allocation.internal_cost || 0),
    "Approved Hours": Number(allocation.allocation_hours || 0),
    "Hours Consumed": Number(allocation.hours_consumed || 0),
    Threshold: `${allocation.threshold_percent || 80}%`,
    Status: allocation.health?.replace("_", " ") || "On track",
  })));
}
function overviewRows(projects) {
  return projects.map((project) => ({
    Client: project.clientName,
    Project: project.name,
    Status: project.status,
    Health: project.health,
    "Task Completion": `${project.taskCompletion}%`,
    "Original Budget (AUD)": Number(project.financials?.originalBudget || 0),
    "Approved Variations (AUD)": Number(project.financials?.variationBudget || 0),
    "Overall Budget (AUD)": Number(project.financials?.overallBudget || 0),
    "Charge-out Spend (AUD)": Number(project.financials?.chargeOutSpend || 0),
    "Internal Cost (AUD)": Number(project.financials?.internalCost || 0),
    "Estimated Profit (AUD)": Number(project.financials?.estimatedProfit || 0),
    "Remaining Hours": project.financials?.remainingHours ?? "",
    "Remaining Budget (AUD)": project.financials?.remainingBudget ?? "",
  }));
}
async function createExcel(projects, fileStem) {
  const workbook = XLSX.utils.book_new();
  const overview = XLSX.utils.json_to_sheet(overviewRows(projects));
  XLSX.utils.book_append_sheet(workbook, overview, "Portfolio health");
  projects.forEach((project, index) => {
    const data = flattenAllocations(project);
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: "No budget allocations are configured for this project." }]);
    XLSX.utils.book_append_sheet(workbook, sheet, `${String(index + 1).padStart(2, "0")} ${safeName(project.name).slice(0, 24)}`.slice(0, 31));
  });
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  download(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileStem}.xlsx`);
}
function cell(text, bold = false) {
  return new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ""), bold, size: 18 })] })] });
}
async function createWord(projects, fileStem) {
  const children = [
    new Paragraph({ text: "Ecology Consulting", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: projects.length === 1 ? `Project Tracker · ${projects[0].name}` : "Project Health Report · Active Project Portfolio", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `Generated ${new Date().toLocaleDateString("en-AU")}. Financial values are controlled tracker entries and do not replace the official finance system.` }),
    new Paragraph({ text: "Portfolio overview", heading: HeadingLevel.HEADING_1 }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell("Project", true), cell("Health", true), cell("Completion", true), cell("Budget", true)] }),
      ...projects.map((project) => new TableRow({ children: [cell(project.name), cell(project.health), cell(`${project.taskCompletion}%`), cell(money(project.financials?.overallBudget))] })),
    ] }),
  ];
  projects.forEach((project) => {
    children.push(new Paragraph({ text: project.name, heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ text: `${project.clientName} · ${project.health} · ${project.taskCompletion}% task completion` }));
    children.push(new Paragraph({ text: `Original budget ${money(project.financials?.originalBudget)} · Approved variations ${money(project.financials?.variationBudget)} · Charge-out spend ${money(project.financials?.chargeOutSpend)} · Estimated profit ${money(project.financials?.estimatedProfit)}` }));
    const allocations = flattenAllocations(project);
    if (allocations.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [cell("Allocation", true), cell("Approved", true), cell("Spend", true), cell("Hours", true)] }), ...allocations.map((allocation) => new TableRow({ children: [cell(allocation.Allocation), cell(money(allocation["Approved Budget (AUD)"])), cell(money(allocation["Charge-out Spend (AUD)"])), cell(`${allocation["Hours Consumed"]} / ${allocation["Approved Hours"]}`)] }))] }));
  });
  const document = new Document({ sections: [{ properties: {}, children }] });
  download(await Packer.toBlob(document), `${fileStem}.docx`);
}
async function createPdf(projects, fileStem) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.06, 0.20, 0.12); const gold = rgb(0.82, 0.66, 0.27); const ink = rgb(0.10, 0.18, 0.13);
  let page; let y; let width; let height;
  const newPage = (continued = false) => {
    page = pdf.addPage([842, 595]); ({ width, height } = page.getSize()); y = height - 118;
    page.drawRectangle({ x: 0, y: height - 88, width, height: 88, color: dark });
    page.drawText("ECOLOGY CONSULTING", { x: 42, y: height - 33, size: 10, font: bold, color: gold });
    page.drawText(continued ? "Project Tracker · continued" : projects.length === 1 ? "Project Tracker" : "Project Health Report", { x: 42, y: height - 66, size: 24, font: bold, color: rgb(1, 1, .95) });
    page.drawText(`Generated ${new Date().toLocaleDateString("en-AU")}`, { x: width - 162, y: height - 32, size: 8, font: regular, color: rgb(.83, .9, .8) });
    page.drawText("Controlled internal report · Entries remain subject to project and finance review.", { x: 42, y: 24, size: 7, font: regular, color: rgb(.4, .48, .4) });
  };
  newPage();
  const line = (text, font = regular, size = 10, colour = ink) => { if (y < 48) newPage(true); page.drawText(String(text).slice(0, 125), { x: 42, y, size, font, color: colour }); y -= size + 8; };
  projects.forEach((project) => {
    if (y < 105) newPage(true);
    line(project.name, bold, 14, dark);
    line(`${project.clientName} · ${project.health} · ${project.taskCompletion}% task completion`, regular, 9, rgb(.25, .34, .26));
    line(`Original ${money(project.financials?.originalBudget)}    Variations ${money(project.financials?.variationBudget)}    Overall ${money(project.financials?.overallBudget)}    Spend ${money(project.financials?.chargeOutSpend)}    Profit ${money(project.financials?.estimatedProfit)}`, regular, 9);
    flattenAllocations(project).forEach((allocation) => line(`• ${allocation.Allocation}: ${money(allocation["Approved Budget (AUD)"])} approved · ${money(allocation["Charge-out Spend (AUD)"])} spend · ${allocation["Hours Consumed"]}/${allocation["Approved Hours"]}h · ${allocation.Status}`, regular, 8, rgb(.20, .30, .22)));
    y -= 8;
  });
  download(new Blob([await pdf.save()], { type: "application/pdf" }), `${fileStem}.pdf`);
}

export default function ProjectTrackerExport({ scope = "portfolio", projectId = "", projectName = "", compact = false }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = scope === "project" ? "Export project" : "Export report";

  const exportReport = async () => {
    if (!session?.access_token) return;
    setBusy(true); setError("");
    try {
      const endpoint = scope === "project" ? `/api/admin/project-tracker?projectId=${encodeURIComponent(projectId)}` : "/api/admin/project-tracker";
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not prepare the report export.");
      const projects = scope === "project" ? [body.project] : body.projects || [];
      if (!projects.length) throw new Error("There are no active project records to export.");
      const fileStem = scope === "project" ? `ec-project-tracker-${safeName(projectName)}` : "ec-project-health-report";
      if (format === "xlsx") await createExcel(projects, fileStem);
      else if (format === "docx") await createWord(projects, fileStem);
      else await createPdf(projects, fileStem);
      setOpen(false);
    } catch (exportError) { setError(exportError.message || "Could not export the report."); } finally { setBusy(false); }
  };

  return <><button type="button" className={compact ? "apt-export-project" : "apt-export"} onClick={() => setOpen(true)}><Download size={compact ? 14 : 15} /> {label}</button>{open ? <div className="apt-modal-backdrop" role="presentation"><section className="apt-export-dialog" role="dialog" aria-modal="true" aria-label="Export Project Tracker report"><button type="button" className="apt-export-close" onClick={() => setOpen(false)} aria-label="Close export dialog"><X size={17} /></button><span className="apt-kicker">Report export</span><h3>{scope === "project" ? projectName : "Project Health Report"}</h3><p>Choose a downloadable report format. Exports are generated from the current controlled Project Tracker data.</p><div className="apt-format-options"><button type="button" className={format === "pdf" ? "selected" : ""} onClick={() => setFormat("pdf")}><FileText size={18} /> PDF<span>Printable summary</span></button><button type="button" className={format === "docx" ? "selected" : ""} onClick={() => setFormat("docx")}><FileType2 size={18} /> Word<span>Editable .docx report</span></button><button type="button" className={format === "xlsx" ? "selected" : ""} onClick={() => setFormat("xlsx")}><FileSpreadsheet size={18} /> Excel<span>Workbook with allocations</span></button></div>{error ? <p className="apt-export-error">{error}</p> : null}<button type="button" className="apt-save" onClick={exportReport} disabled={busy}>{busy ? <><Loader2 size={15} className="spin" /> Preparing download…</> : <><Download size={15} /> Export {format.toUpperCase()}</>}</button></section></div> : null}</>;
}
