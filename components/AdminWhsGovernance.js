import { useState } from "react";
import { BellRing, FileCheck2, ShieldCheck } from "lucide-react";
import AdminWhsMonitor from "./AdminWhsMonitor";
import InternalGovernance from "./InternalGovernance";
import AdminRegulatoryWatch from "./AdminRegulatoryWatch";

// Administrators retain their existing WHS oversight and gain governance controls
// in the same safety/compliance domain rather than as a standalone admin dashboard.
export default function AdminWhsGovernance({ onToast, initialSubdomain = "monitor" }) {
  const [subdomain, setSubdomain] = useState(initialSubdomain);
  return (
    <section className="whs-domain">
      <div className="whs-domain-tabs" role="tablist" aria-label="WHS and compliance areas">
        <button role="tab" aria-selected={subdomain === "monitor"} className={subdomain === "monitor" ? "selected" : ""} onClick={() => setSubdomain("monitor")}><ShieldCheck size={14} /> WHS &amp; Compliance</button>
        <button role="tab" aria-selected={subdomain === "governance"} className={subdomain === "governance" ? "selected" : ""} onClick={() => setSubdomain("governance")}><FileCheck2 size={14} /> Internal Governance</button>
        <button role="tab" aria-selected={subdomain === "regulatory"} className={subdomain === "regulatory" ? "selected" : ""} onClick={() => setSubdomain("regulatory")}><BellRing size={14} /> Regulatory Watch</button>
      </div>
      {subdomain === "monitor" ? <AdminWhsMonitor /> : subdomain === "governance" ? <InternalGovernance isAdmin={true} onToast={onToast} /> : <AdminRegulatoryWatch onToast={onToast} />}
    </section>
  );
}
