import { useEffect, useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import AdminWhsMonitor from "./AdminWhsMonitor";
import InternalGovernance from "./InternalGovernance";
import BiologicalHazardRegister from "./BiologicalHazardRegister";

// WHS & Compliance contains safety monitoring and controlled Internal Governance.
// Regulatory Watch is deliberately a separate Admin Portal domain.
export default function AdminWhsGovernance({ onToast, initialSubdomain = "monitor" }) {
  const [subdomain, setSubdomain] = useState(initialSubdomain);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("whsView") === "biological") setSubdomain("biological");
  }, []);
  return (
    <section className="whs-domain">
      <div className="whs-domain-tabs" role="tablist" aria-label="WHS and compliance areas">
        <button role="tab" aria-selected={subdomain === "monitor"} className={subdomain === "monitor" ? "selected" : ""} onClick={() => setSubdomain("monitor")}><ShieldCheck size={14} /> WHS &amp; Compliance</button>
        <button role="tab" aria-selected={subdomain === "governance"} className={subdomain === "governance" ? "selected" : ""} onClick={() => setSubdomain("governance")}><FileCheck2 size={14} /> Internal Governance</button>
        <button role="tab" aria-selected={subdomain === "biological"} className={subdomain === "biological" ? "selected" : ""} onClick={() => setSubdomain("biological")}><ShieldCheck size={14} /> Biological Register</button>
      </div>
      {subdomain === "biological" ? <BiologicalHazardRegister audience="admin" onToast={onToast} /> : subdomain === "governance" ? <InternalGovernance isAdmin={true} onToast={onToast} /> : <AdminWhsMonitor />}
    </section>
  );
}
