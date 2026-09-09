import { useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import StaffForms from "./StaffForms";
import InternalGovernance from "./InternalGovernance";
import WorkspaceNav from "./WorkspaceNav";

// WHS & EC Forms is a normal, device-adaptive staff workspace. It deliberately
// follows the actual browser width and the portal-wide display preference rather
// than placing operational forms inside a simulated desktop/tablet/mobile frame.
export default function WhsEcFormsDomain({
  onToast,
  initialSubdomain = "forms",
}) {
  const [subdomain, setSubdomain] = useState(
    initialSubdomain === "governance" ? "governance" : "forms",
  );

  return (
    <section className="whs-domain">
      <div
        className="whs-domain-tabs"
        role="tablist"
        aria-label="WHS and EC Forms areas"
      >
        <button
          type="button"
          role="tab"
          aria-selected={subdomain === "forms"}
          aria-controls="whs-content-forms"
          className={subdomain === "forms" ? "selected" : ""}
          onClick={() => setSubdomain("forms")}
        >
          <ShieldCheck size={14} /> WHS &amp; EC Forms
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subdomain === "governance"}
          aria-controls="whs-content-governance"
          className={subdomain === "governance" ? "selected" : ""}
          onClick={() => setSubdomain("governance")}
        >
          <FileCheck2 size={14} /> Internal Governance
        </button>
      </div>

      {subdomain === "governance" ? (
        <WorkspaceNav
          audience="staff"
          onBack={() => setSubdomain("forms")}
          backLabel="WHS & EC Forms"
          className="whs-domain__workspace-nav"
        />
      ) : null}

      <div
        id={`whs-content-${subdomain}`}
        role="tabpanel"
        className="whs-domain__content"
      >
        {subdomain === "forms" ? (
          <StaffForms />
        ) : (
          <InternalGovernance isAdmin={false} onToast={onToast} />
        )}
      </div>
    </section>
  );
}
