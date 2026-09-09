"use client";

import { BarChart3, CheckCircle2, CircleDollarSign, ClipboardCheck, FilePlus2, ShieldCheck, Target, UsersRound } from "lucide-react";

const FLOW = [
  { step: "1", title: "Enquiry received", text: "Admin records the client request in Quotes to be Drafted.", tone: "slate" },
  { step: "2", title: "Senior review", text: "Allocate an active Senior Ecologist from the Staff List.", tone: "amber" },
  { step: "3", title: "Client contact", text: "Record direct contact, notes and confirmed scope before generation.", tone: "gold" },
  { step: "4", title: "Quote drafting", text: "Generate controlled project and quote numbers, then attach the issued PDF.", tone: "forest" },
  { step: "5", title: "Issued pipeline", text: "Once sent, transfer the quote as Pending for commercial outcome tracking.", tone: "moss" },
];

export default function QuotePipelineImprovements({ quotes, summary, onOpenDrafts }) {
  const rows = Array.isArray(quotes) ? quotes : [];
  const active = rows.filter((quote) => !quote.superseded);
  const pending = active.filter((quote) => quote.status === "pending").length;
  const successful = active.filter((quote) => quote.status === "successful").length;
  const unsuccessful = active.filter((quote) => quote.status === "unsuccessful").length;
  const superseded = rows.filter((quote) => quote.superseded).length;

  return <div className="qpi">
    <header className="qpi-hero"><span><Target size={17} /> Delivery & commercial · controlled improvement plan</span><h1>Quote Pipeline improvements</h1><p>Keep enquiries separate from issued quotes, make client contact accountable, and retain a traceable path from initial request to commercial outcome.</p></header>
    <section className="qpi-metrics" aria-label="Issued Quote Pipeline summary">
      <Metric icon={FilePlus2} label="Issued quotes" value={summary?.sent ?? rows.filter((quote) => quote.initial_sent).length} />
      <Metric icon={ClipboardCheck} label="Pending" value={pending} tone="amber" />
      <Metric icon={CheckCircle2} label="Successful" value={successful} tone="moss" />
      <Metric icon={BarChart3} label="Unsuccessful" value={unsuccessful} tone="rose" />
      <Metric icon={ShieldCheck} label="Superseded" value={superseded} tone="slate" />
    </section>
    <section className="qpi-panel qpi-panel--workflow"><div className="qpi-panel__heading"><div><span>Improved commercial control</span><h2>Enquiry to issued quote</h2></div><button type="button" onClick={onOpenDrafts}><FilePlus2 size={16} /> Open Quotes to be Drafted</button></div><div className="qpi-flow">{FLOW.map((item) => <article className={`qpi-flow__item qpi-flow__item--${item.tone}`} key={item.step}><span>{item.step}</span><div><strong>{item.title}</strong><p>{item.text}</p></div></article>)}</div></section>
    <section className="qpi-grid"><article className="qpi-panel"><div className="qpi-icon"><UsersRound size={19} /></div><h2>Allocation and accountability</h2><p>Assignments come from the active Staff List. An allocation creates an in-portal notification for the nominated Senior Ecologist, directing them to review the enquiry and contact the client.</p></article><article className="qpi-panel"><div className="qpi-icon"><ShieldCheck size={19} /></div><h2>Required client contact</h2><p>Project and quote number generation remains unavailable until the direct contact tick, date, contact notes and confirmed scope have been recorded.</p></article><article className="qpi-panel"><div className="qpi-icon"><CircleDollarSign size={19} /></div><h2>Commercial confidentiality</h2><p>Financial totals remain separately protected. The intake workspace contains no quote-value fields, and issued Pipeline financial values are visible only to people with the controlled financial permission.</p></article></section>
    <section className="qpi-panel qpi-panel--statuses"><div><span>Issued Quote Pipeline statuses</span><h2>Keep the formal Pipeline focused on quotes already sent</h2></div><div className="qpi-statuses"><Status label="Pending" tone="amber"/><Status label="Successful" tone="moss"/><Status label="Unsuccessful" tone="rose"/><Status label="Withdrawn" tone="slate"/><Status label="Superseded" tone="purple"/></div></section>
  </div>;
}

function Metric({ icon: Icon, label, value, tone = "forest" }) { return <article className={`qpi-metric qpi-metric--${tone}`}><Icon size={17} /><strong>{value}</strong><span>{label}</span></article>; }
function Status({ label, tone }) { return <span className={`qpi-status qpi-status--${tone}`}>{label}</span>; }
