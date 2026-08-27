import { useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import AdminWhsMonitor from "./AdminWhsMonitor";
import InternalGovernance from "./InternalGovernance";

// Administrators retain their existing WHS oversight and gain governance controls
// in the same safety/compliance domain rather than as a standalone admin dashboard.
export default function AdminWhsGovernance({ onToast }) {
  const [subdomain, setSubdomain] = useState("monitor");
  return (
    <section className="whs-domain">
      <div className="whs-domain-tabs" role="tablist" aria-label="WHS and compliance areas">
        <button role="tab" aria-selected={subdomain === "monitor"} className={subdomain === "monitor" ? "selected" : ""} onClick={() => setSubdomain("monitor")}><ShieldCheck size={14} /> WHS &amp; Compliance</button>
        <button role="tab" aria-selected={subdomain === "governance"} className={subdomain === "governance" ? "selected" : ""} onClick={() => setSubdomain("governance")}><FileCheck2 size={14} /> Internal Governance</button>
      </div>
      {subdomain === "monitor" ? <AdminWhsMonitor /> : <InternalGovernance isAdmin={true} onToast={onToast} />}
    </section>
  );
}
