import { useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import AdminWhsMonitor from "./AdminWhsMonitor";
import InternalGovernance from "./InternalGovernance";

// WHS & Compliance contains safety monitoring and controlled Internal Governance.
// Regulatory Watch is deliberately a separate Admin Portal domain.
export default function AdminWhsGovernance({ onToast, initialSubdomain = "monitor" }) {
  const [subdomain, setSubdomain] = useState(initialSubdomain);
  return (
    <section className="whs-domain">
      <div className="whs-domain-tabs" role="tablist" aria-label="WHS and compliance areas">
        <button role="tab" aria-selected={subdomain === "monitor"} className={subdomain === "monitor" ? "selected" : ""} onClick={() => setSubdomain("monitor")}><ShieldCheck size={14} /> WHS &amp; Compliance</button>
        <button role="tab" aria-selected={subdomain === "governance"} className={subdomain === "governance" ? "selected" : ""} onClick={() => setSubdomain("governance")}><FileCheck2 size={14} /> Internal Governance</button>
      </div>
      {subdomain === "governance" ? <InternalGovernance isAdmin={true} onToast={onToast} /> : <AdminWhsMonitor />}
    </section>
  );
}
