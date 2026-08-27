import { useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import StaffForms from "./StaffForms";
import InternalGovernance from "./InternalGovernance";

// Keeps Internal Governance subordinate to WHS & EC Forms. Staff see only the
// approved library and the consultation documents expressly made available to them.
export default function WhsEcFormsDomain({ onToast, initialSubdomain = "forms" }) {
  const [subdomain, setSubdomain] = useState(initialSubdomain === "governance" ? "governance" : "forms");
  return (
    <section className="whs-domain">
      <div className="whs-domain-tabs" role="tablist" aria-label="WHS and EC Forms areas">
        <button role="tab" aria-selected={subdomain === "forms"} className={subdomain === "forms" ? "selected" : ""} onClick={() => setSubdomain("forms")}><ShieldCheck size={14} /> WHS &amp; EC Forms</button>
        <button role="tab" aria-selected={subdomain === "governance"} className={subdomain === "governance" ? "selected" : ""} onClick={() => setSubdomain("governance")}><FileCheck2 size={14} /> Internal Governance</button>
      </div>
      {subdomain === "forms" ? <StaffForms /> : <InternalGovernance isAdmin={false} onToast={onToast} />}
    </section>
  );
}
