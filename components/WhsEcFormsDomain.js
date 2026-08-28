import { useState } from "react";
import {
  FileCheck2,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
} from "lucide-react";
import StaffForms from "./StaffForms";
import InternalGovernance from "./InternalGovernance";
import WorkspaceNav from "./WorkspaceNav";

const DEVICE_VIEWS = [
  { id: "desktop", label: "Desktop", Icon: Monitor },
  { id: "tablet", label: "Tablet", Icon: Tablet },
  { id: "mobile", label: "Mobile", Icon: Smartphone },
];

// Internal Governance remains subordinate to WHS & EC Forms. The device selector
// is a deliberate preview frame: it does not change the user's browser/device or
// persist a personal setting, and it keeps the normal forms workflow intact.
export default function WhsEcFormsDomain({
  onToast,
  initialSubdomain = "forms",
}) {
  const [subdomain, setSubdomain] = useState(
    initialSubdomain === "governance" ? "governance" : "forms",
  );
  const [device, setDevice] = useState("desktop");

  const contentId = `whs-preview-${subdomain}`;

  return (
    <section className="whs-domain">
      <div className="whs-domain-toolbar">
        <div
          className="whs-domain-tabs"
          role="tablist"
          aria-label="WHS and EC Forms areas"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subdomain === "forms"}
            aria-controls="whs-preview-forms"
            className={subdomain === "forms" ? "selected" : ""}
            onClick={() => setSubdomain("forms")}
          >
            <ShieldCheck size={14} /> WHS &amp; EC Forms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subdomain === "governance"}
            aria-controls="whs-preview-governance"
            className={subdomain === "governance" ? "selected" : ""}
            onClick={() => setSubdomain("governance")}
          >
            <FileCheck2 size={14} /> Internal Governance
          </button>
        </div>

        <div
          className="whs-device-selector"
          role="group"
          aria-label="WHS and EC Forms device preview"
        >
          <span className="whs-device-selector__label">Preview</span>
          <div
            className="whs-device-selector__options"
            role="radiogroup"
            aria-label="Choose device size"
          >
            {DEVICE_VIEWS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={device === id}
                className={device === id ? "selected" : ""}
                onClick={() => setDevice(id)}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {subdomain === "governance" ? (
        <WorkspaceNav
          audience="staff"
          onBack={() => setSubdomain("forms")}
          backLabel="WHS & EC Forms"
          className="whs-domain__workspace-nav"
        />
      ) : null}

      <div className="whs-device-preview-shell">
        <div
          className={`whs-device-frame whs-device-frame--${device}`}
          data-device={device}
        >
          <div
            id={contentId}
            role="tabpanel"
            className="whs-device-frame__screen"
          >
            {subdomain === "forms" ? (
              <StaffForms />
            ) : (
              <InternalGovernance isAdmin={false} onToast={onToast} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
