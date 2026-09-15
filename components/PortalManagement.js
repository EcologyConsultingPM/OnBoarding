"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  EyeOff,
  FileCheck2,
  Leaf,
  LockKeyhole,
  Scale,
  Send,
  ShieldCheck,
  ShieldPlus,
  User,
  UserPlus,
  Users2,
  X,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import PortalSystemHealth from "./PortalSystemHealth";
import AdminExportCentre from "./AdminExportCentre";
import AdminAuditLog from "./AdminAuditLog";
import AdminRestrictedWorkflows from "./AdminRestrictedWorkflows";
import PortalStaffList from "./PortalStaffList";
import PortalVisibilityManager from "./PortalVisibilityManager";

const ROLE_OPTIONS = [
  {
    key: "fauna_expert",
    label: "Fauna Expert",
    description: "Review and verify fauna profile submissions.",
    Icon: BadgeCheck,
    tone: "fauna",
  },
  {
    key: "flora_expert",
    label: "Flora Expert",
    description: "Review and verify flora profile submissions.",
    Icon: Leaf,
    tone: "flora",
  },
  {
    key: "whs_manager",
    label: "WHS Manager",
    description: "Lead controlled WHS review and compliance workflows.",
    Icon: ShieldCheck,
    tone: "whs",
  },
  {
    key: "report_expert",
    label: "Report Expert",
    description: "Review controlled report templates and professional outputs.",
    Icon: FileCheck2,
    tone: "report",
  },
  {
    key: "module_assessor",
    label: "Module Assessor",
    description: "Assess assigned learning evidence and module submissions.",
    Icon: BookOpenCheck,
    tone: "assessor",
  },
];

const accessLabel = {
  staff: "Staff portal",
  admin: "Admin portal",
  both: "Staff + Admin",
};

const STAFF_DOMAIN_OPTIONS = [
  { key: "staff.notifications", label: "Notifications", description: "Assignments, task briefs and updates" },
  { key: "staff.projects", label: "My Projects", description: "Activities, tracker and requests" },
  { key: "staff.timesheets", label: "Timesheets", description: "Tracker history and official time entry" },
  { key: "staff.forms", label: "WHS & EC Forms", description: "Forms and internal governance" },
  { key: "staff.learning", label: "Learning & Development", description: "Approved training and Core Training" },
  { key: "staff.species", label: "Species Profiles", description: "Flora, fauna and survey reference" },
  { key: "staff.remote_operations", label: "Remote Operations", description: "Remote-work support and handover" },
];
const DEFAULT_STAFF_DOMAINS = STAFF_DOMAIN_OPTIONS.map((option) => option.key);

const ADMIN_DOMAIN_OPTIONS = [
  { key: "admin.projects", label: "Projects & Operations", description: "Project setup, tracker and health reporting" },
  { key: "admin.quote_pipeline", label: "Quote Pipeline", description: "Quote status and operational pipeline" },
  { key: "admin.remote_operations", label: "Remote Operations Oversight", description: "Remote-work oversight and handovers" },
  { key: "admin.whs", label: "WHS & Compliance", description: "WHS monitoring and internal governance" },
  { key: "admin.service_requests", label: "Service Requests", description: "Staff leave, training and equipment requests" },
  { key: "admin.learning", label: "Learning & Development Library", description: "Controlled learning resources and modules" },
  { key: "admin.species", label: "Species Profiles & Survey Requirements", description: "Controlled flora, fauna and survey guidance" },
  { key: "admin.regulatory_watch", label: "Regulatory Watch", description: "Regulatory change monitoring and actions" },
  { key: "admin.portal_management", label: "Portal Management", description: "Staff list, roles and system controls" },
];
const DEFAULT_ADMIN_DOMAINS = ADMIN_DOMAIN_OPTIONS.map((option) => option.key);

function jsonFromResponse(response) {
  return response.json().catch(() => ({}));
}

function getError(data, fallback) {
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

function formatTimestamp(value) {
  if (!value) return "Not yet reviewed";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function TabButton({ active, icon: Icon, label, caption, onClick }) {
  return (
    <button
      type="button"
      className={`pm-domain-card ${active ? "selected" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="pm-domain-card__icon">
        <Icon size={19} />
      </span>
      <span className="pm-domain-card__copy">
        <strong>{label}</strong>
        <small>{caption}</small>
      </span>
      <ChevronRight
        className="pm-domain-card__arrow"
        size={17}
        aria-hidden="true"
      />
    </button>
  );
}

function AccessNotice({ tone = "info", children }) {
  return <div className={`pm-notice ${tone}`}>{children}</div>;
}

export default function PortalManagement({ onboardingContent, onToast }) {
  const { session } = useAuth();
  const [view, setView] = useState("access");
  const [control, setControl] = useState(null);
  const [loadingControl, setLoadingControl] = useState(true);
  const [controlError, setControlError] = useState("");
  const [ecadoViewers, setEcadoViewers] = useState([]);
  const [ecadoLoading, setEcadoLoading] = useState(true);
  const [ecadoError, setEcadoError] = useState("");
  const [ecadoEmail, setEcadoEmail] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    accessLevel: "staff",
    visibleStaffResources: DEFAULT_STAFF_DOMAINS,
    visibleAdminResources: DEFAULT_ADMIN_DOMAINS,
  });
  const [issued, setIssued] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [promotionEmail, setPromotionEmail] = useState("");
  const [requestForm, setRequestForm] = useState({
    targetEmail: "",
    requestType: "grant",
    reason: "",
  });
  const [roleForm, setRoleForm] = useState({
    targetEmail: "",
    roleKey: "fauna_expert",
    moduleScope: "",
  });
  const timerRef = useRef(null);

  const accessToken = session?.access_token || "";
  const isPrimary = Boolean(control?.isPrimary);
  const authoritySchemaReady = Boolean(control?.authoritySchemaReady);
  const staffDirectory = Array.isArray(control?.staff) ? control.staff : [];
  const activeRoles = Array.isArray(control?.roleAssignments)
    ? control.roleAssignments
    : [];
  const adminEmails = Array.isArray(control?.adminEmails)
    ? control.adminEmails
    : [];
  const accessRequests = Array.isArray(control?.accessRequests)
    ? control.accessRequests
    : [];

  const request = async (action, payload = {}) => {
    if (!accessToken)
      throw new Error(
        "Your sign-in session has expired. Please sign in again.",
      );
    const response = await fetch("/api/admin/portal-management", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await jsonFromResponse(response);
    if (!response.ok)
      throw new Error(
        getError(data, "The portal management action could not be completed."),
      );
    return data;
  };

  const refreshControl = async () => {
    if (!accessToken) return;
    setLoadingControl(true);
    setControlError("");
    try {
      const response = await fetch("/api/admin/portal-management", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(
          getError(data, "Could not load portal access controls."),
        );
      setControl(data);
    } catch (fetchError) {
      setControlError(
        fetchError.message || "Could not load portal access controls.",
      );
    } finally {
      setLoadingControl(false);
    }
  };

  const refreshEcadoViewers = async () => {
    if (!accessToken) return;
    setEcadoLoading(true);
    setEcadoError("");
    try {
      const response = await fetch("/api/admin/ecado-viewers", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await jsonFromResponse(response);
      if (!response.ok) throw new Error(getError(data, "Could not load the Ecado viewer register."));
      setEcadoViewers(data.viewers || []);
    } catch (fetchError) {
      // Non-primary admins correctly get a 403 here — that's expected, not
      // an error to surface loudly, since this section only renders for
      // primary admins in the first place.
      setEcadoViewers([]);
    } finally {
      setEcadoLoading(false);
    }
  };

  const grantEcadoAccess = async () => {
    const email = ecadoEmail.trim().toLowerCase();
    if (!email) { setEcadoError("Enter a staff email."); return; }
    setEcadoError("");
    try {
      const response = await fetch("/api/admin/ecado-viewers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok) throw new Error(getError(data, "Could not grant Ecado access."));
      setEcadoEmail("");
      await refreshEcadoViewers();
      onToast?.("Ecado access granted.");
    } catch (grantError) {
      setEcadoError(grantError.message || "Could not grant Ecado access.");
    }
  };

  const revokeEcadoAccess = async (email) => {
    if (!window.confirm(`Remove Ecado access for ${email}?`)) return;
    try {
      const response = await fetch(`/api/admin/ecado-viewers?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await jsonFromResponse(response);
      if (!response.ok) throw new Error(getError(data, "Could not revoke Ecado access."));
      await refreshEcadoViewers();
      onToast?.("Ecado access revoked.");
    } catch (revokeError) {
      setEcadoError(revokeError.message || "Could not revoke Ecado access.");
    }
  };

  useEffect(() => {
    refreshControl();
    refreshEcadoViewers();
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!issued) return undefined;
    setSecondsLeft(120);
    timerRef.current = setInterval(() => {
      setSecondsLeft((remaining) => {
        if (remaining <= 1) {
          clearInterval(timerRef.current);
          setIssued(null);
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [issued]);

  const submitStaffAccess = async () => {
    setError("");
    setCopied(false);
    const email = form.email.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) {
      setError("Email must be an @ecologyconsulting.au address.");
      return;
    }
    if (!form.firstName.trim()) {
      setError("First name is required.");
      return;
    }
    if (!isPrimary && form.accessLevel !== "staff") {
      setError(
        "Only Aaron Dooley or Tony Webster can grant administrator access. Create staff access here, then submit an administrator-access request.",
      );
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/admin/invite-staff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          accessLevel: form.accessLevel,
          visibleStaffResources: isPrimary && form.accessLevel !== "admin" ? form.visibleStaffResources : undefined,
          visibleAdminResources: isPrimary && form.accessLevel !== "staff" ? form.visibleAdminResources : undefined,
          forceChange: true,
        }),
      });
      const data = await jsonFromResponse(response);
      if (!response.ok)
        throw new Error(getError(data, "Could not set up this account."));
      setIssued({
        email: data.email,
        tempPassword: data.tempPassword,
        accessLevel: data.accessLevel,
        name: data.name,
      });
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        accessLevel: "staff",
        visibleStaffResources: DEFAULT_STAFF_DOMAINS,
        visibleAdminResources: DEFAULT_ADMIN_DOMAINS,
      });
      await refreshControl();
    } catch (submitError) {
      setError(submitError.message || "Could not set up this account.");
    } finally {
      setBusy(false);
    }
  };

  const copyPassword = () => {
    if (!issued) return;
    navigator.clipboard?.writeText(issued.tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const grantAdmin = async () => {
    const email = promotionEmail.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) {
      onToast?.("Enter a valid Ecology Consulting email address");
      return;
    }
    try {
      await request("grant_admin", { targetEmail: email });
      setPromotionEmail("");
      onToast?.("Administrator access granted");
      await refreshControl();
    } catch (actionError) {
      onToast?.(actionError.message);
    }
  };

  const removeAdmin = async (email) => {
    if (
      !window.confirm(
        `Remove administrator access for ${email}? This action is limited to Aaron Dooley.`,
      )
    )
      return;
    try {
      await request("remove_admin", { targetEmail: email });
      onToast?.("Administrator access removed");
      await refreshControl();
    } catch (actionError) {
      onToast?.(actionError.message);
    }
  };

  const submitAccessRequest = async () => {
    const email = requestForm.targetEmail.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) {
      onToast?.("Enter the staff member’s Ecology Consulting email address");
      return;
    }
    try {
      await request("request_admin_access", {
        targetEmail: email,
        requestType: requestForm.requestType,
        reason: requestForm.reason.trim(),
      });
      setRequestForm({ targetEmail: "", requestType: "grant", reason: "" });
      onToast?.("Administrator-access request sent to the protected administrators");
      await refreshControl();
    } catch (actionError) {
      onToast?.(actionError.message);
    }
  };

  const assignRole = async () => {
    const email = roleForm.targetEmail.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) {
      onToast?.("Choose a staff member using their Ecology Consulting email");
      return;
    }
    if (
      roleForm.roleKey === "module_assessor" &&
      !roleForm.moduleScope.trim()
    ) {
      onToast?.("Describe the module or programme this assessor can assess");
      return;
    }
    try {
      await request("assign_role", {
        targetEmail: email,
        roleKey: roleForm.roleKey,
        moduleScope:
          roleForm.roleKey === "module_assessor"
            ? roleForm.moduleScope.trim()
            : null,
      });
      setRoleForm((current) => ({
        ...current,
        targetEmail: "",
        moduleScope: "",
      }));
      onToast?.("Specialist role allocated");
      await refreshControl();
    } catch (actionError) {
      onToast?.(actionError.message);
    }
  };

  const removeRole = async (assignment) => {
    if (
      !window.confirm(
        `Withdraw ${assignment.roleLabel || "this specialist"} access from ${assignment.targetEmail}?`,
      )
    )
      return;
    try {
      await request("remove_role", { assignmentId: assignment.id });
      onToast?.("Specialist role withdrawn");
      await refreshControl();
    } catch (actionError) {
      onToast?.(actionError.message);
    }
  };

  const decideAccessRequest = async (accessRequest, decision) => {
    const action = decision === "approved" ? "approve" : "reject";
    if (
      !window.confirm(
        `${action[0].toUpperCase()}${action.slice(1)} this request to ${accessRequest.requestType} administrator access for ${accessRequest.targetEmail}?`,
      )
    )
      return;
    try {
      await request("decide_admin_access_request", {
        requestId: accessRequest.id,
        decision,
      });
      onToast?.(`Administrator-access request ${decision}`);
      await refreshControl();
    } catch (actionError) {
      onToast?.(actionError.message);
    }
  };

  const roleOption =
    ROLE_OPTIONS.find((role) => role.key === roleForm.roleKey) ||
    ROLE_OPTIONS[0];

  return (
    <div className="pm">
      <header className="pm-hero">
        <span>Ecology Consulting · Portal stewardship</span>
        <h1>Portal management</h1>
        <p>
          Set up staff access first. Then allocate specialist accountability and
          controlled onboarding from their own dedicated areas.
        </p>
      </header>

      <nav className="pm-domain-nav" aria-label="Portal Management areas">
        <TabButton
          active={view === "access"}
          icon={LockKeyhole}
          label="Access & administrator control"
          caption="Staff access and administrator authority"
          onClick={() => setView("access")}
        />
        <TabButton
          active={view === "stafflist"}
          icon={Users2}
          label="Staff List"
          caption="Assignment-ready staff directory"
          onClick={() => setView("stafflist")}
        />
        {isPrimary ? (
          <TabButton
            active={view === "visibility"}
            icon={EyeOff}
            label="Portal Visibility"
            caption="Control staff access to each domain and sub-domain"
            onClick={() => setView("visibility")}
          />
        ) : null}
        {isPrimary ? (
          <TabButton
            active={view === "commercial"}
            icon={ShieldCheck}
            label="Quote financial access"
            caption="Control who can view dollar values and pipeline totals"
            onClick={() => setView("commercial")}
          />
        ) : null}
        <TabButton
          active={view === "roles"}
          icon={ShieldPlus}
          label="Specialist roles & assessors"
          caption="Fauna, flora, WHS, reporting and modules"
          onClick={() => setView("roles")}
        />
        <TabButton
          active={view === "onboarding"}
          icon={ClipboardCheck}
          label="Onboarding assignments & progress"
          caption="Draft, lock, assign and monitor progress"
          onClick={() => setView("onboarding")}
        />
        <TabButton
          active={view === "system"}
          icon={Activity}
          label="Backup & system health"
          caption="Private archive status and operational log"
          onClick={() => setView("system")}
        />
        <TabButton
          active={view === "exports"}
          icon={Download}
          label="Export Centre"
          caption="Operational registers for Excel and CSV"
          onClick={() => setView("exports")}
        />
        <TabButton
          active={view === "audit"}
          icon={ClipboardList}
          label="Audit Log"
          caption="Controlled action and permission history"
          onClick={() => setView("audit")}
        />
        <TabButton
          active={view === "restricted"}
          icon={LockKeyhole}
          label="Restricted Workflows"
          caption="Primary administrator confidential controls"
          onClick={() => setView("restricted")}
        />
      </nav>

      {controlError && (
        <AccessNotice tone="error">
          <AlertCircle size={16} />
          <span>{controlError}</span>
        </AccessNotice>
      )}
      {!loadingControl && !controlError && !authoritySchemaReady && (
        <AccessNotice>
          <AlertCircle size={16} />
          <span>
            Specialist allocations and administrator-access requests are
            prepared for review. They become active only after the separate
            database authority controls are formally approved and applied.
          </span>
        </AccessNotice>
      )}

      {view === "access" && (
        <section
          className="pm-workspace"
          aria-label="Access and administrator control"
        >
          <section className="pm-card pm-card--access">
            <div className="pm-section-head">
              <div>
                <span className="pm-kicker">Step 1 · Staff access</span>
                <h2>
                  <UserPlus size={18} /> Set up a staff member
                </h2>
                <p className="pm-sub">
                  Create or reset a staff login. The temporary password is
                  visible for two minutes only and must be shared through an
                  appropriate direct channel.
                </p>
              </div>
              <span className="pm-section-mark">
                <User size={19} />
              </span>
            </div>

            <div className="pm-grid">
              <label className="pm-field">
                <span>First name</span>
                <input
                  value={form.firstName}
                  onChange={(event) =>
                    setForm({ ...form, firstName: event.target.value })
                  }
                  autoComplete="given-name"
                />
              </label>
              <label className="pm-field">
                <span>Last name</span>
                <input
                  value={form.lastName}
                  onChange={(event) =>
                    setForm({ ...form, lastName: event.target.value })
                  }
                  autoComplete="family-name"
                />
              </label>
              <label className="pm-field pm-full">
                <span>Email (@ecologyconsulting.au)</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  placeholder="first.last@ecologyconsulting.au"
                  autoComplete="email"
                />
              </label>
              <label className="pm-field pm-full">
                <span>Phone (optional)</span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                  placeholder="e.g. 04xx xxx xxx"
                  autoComplete="tel"
                />
              </label>
            </div>

            <div className="pm-access">
              <span className="pm-access-label">Portal access</span>
              <div className="pm-access-opts">
                {[
                  {
                    value: "staff",
                    Icon: User,
                    label: "Staff portal",
                    description: "Onboarding, forms, learning and operations",
                  },
                  {
                    value: "admin",
                    Icon: ShieldCheck,
                    label: "Admin portal",
                    description: "Management and oversight",
                  },
                  {
                    value: "both",
                    Icon: Users2,
                    label: "Staff + Admin",
                    description: "Both portal experiences",
                  },
                ].map(({ value, Icon, label, description }) => {
                  const restricted = !isPrimary && value !== "staff";
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`pm-access-opt ${form.accessLevel === value ? "sel" : ""}`}
                      onClick={() =>
                        !restricted && setForm({ ...form, accessLevel: value })
                      }
                      disabled={restricted}
                      aria-describedby={
                        restricted ? "pm-primary-only" : undefined
                      }
                    >
                      <Icon size={16} />
                      <span className="pm-access-opt-t">{label}</span>
                      <span className="pm-access-opt-d">
                        {restricted ? "Aaron or Tony only" : description}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!isPrimary && (
                <p id="pm-primary-only" className="pm-primary-only">
                  <LockKeyhole size={13} /> Administrator access can only be
                  granted by Aaron Dooley or Tony Webster.
                </p>
              )}
            </div>

            {isPrimary && form.accessLevel !== "admin" && (
              <div className="pm-access pm-staff-domain-access">
                <span className="pm-access-label">Staff workspace access</span>
                <p className="pm-staff-domain-access__intro">
                  Choose what this person can see on their first Staff Portal sign-in. You can refine any choice later using the domain eye controls.
                </p>
                <div className="pm-staff-domain-access__grid">
                  {STAFF_DOMAIN_OPTIONS.map((option) => {
                    const selected = form.visibleStaffResources.includes(option.key);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={`pm-staff-domain-option ${selected ? "sel" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setForm({
                          ...form,
                          visibleStaffResources: selected
                            ? form.visibleStaffResources.filter((key) => key !== option.key)
                            : [...form.visibleStaffResources, option.key],
                        })}
                      >
                        <span className="pm-staff-domain-option__check"><Check size={14} /></span>
                        <span><strong>{option.label}</strong><small>{option.description}</small></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isPrimary && form.accessLevel !== "staff" && (
              <div className="pm-access pm-staff-domain-access">
                <span className="pm-access-label">Admin workspace access</span>
                <p className="pm-staff-domain-access__intro">
                  Choose the Admin Portal domains this administrator can see at first sign-in. Quote financial values remain separately restricted and are not granted by this selection.
                </p>
                <div className="pm-staff-domain-access__grid">
                  {ADMIN_DOMAIN_OPTIONS.map((option) => {
                    const selected = form.visibleAdminResources.includes(option.key);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={`pm-staff-domain-option ${selected ? "sel" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setForm({
                          ...form,
                          visibleAdminResources: selected
                            ? form.visibleAdminResources.filter((key) => key !== option.key)
                            : [...form.visibleAdminResources, option.key],
                        })}
                      >
                        <span className="pm-staff-domain-option__check"><Check size={14} /></span>
                        <span><strong>{option.label}</strong><small>{option.description}</small></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <AccessNotice tone="error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </AccessNotice>
            )}

            <button
              className="pm-submit"
              type="button"
              onClick={submitStaffAccess}
              disabled={busy}
            >
              <UserPlus size={15} />{" "}
              {busy ? "Setting up…" : "Create access & generate password"}
            </button>

            {issued && (
              <div className="pm-issued" role="status">
                <div className="pm-issued-head">
                  <span>
                    Access created — copy the password now. It hides in{" "}
                    {Math.floor(secondsLeft / 60)}:
                    {String(secondsLeft % 60).padStart(2, "0")}.
                  </span>
                  <button type="button" onClick={() => setIssued(null)}>
                    <EyeOff size={13} /> Hide now
                  </button>
                </div>
                <div className="pm-issued-row">
                  <strong>{issued.name || issued.email}</strong> ·{" "}
                  {accessLabel[issued.accessLevel] || "Staff portal"}
                </div>
                <div className="pm-issued-email">{issued.email}</div>
                <div className="pm-issued-pw">
                  <code>{issued.tempPassword}</code>
                  <button type="button" onClick={copyPassword}>
                    {copied ? (
                      <>
                        <Check size={13} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={13} /> Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="pm-issued-bar">
                  <div style={{ width: `${(secondsLeft / 120) * 100}%` }} />
                </div>
              </div>
            )}
          </section>

          <section className="pm-card pm-card--admin-control">
            <div className="pm-section-head">
              <div>
                <span className="pm-kicker">Step 2 · Controlled authority</span>
                <h2>
                  <ShieldCheck size={18} /> Administrator access
                </h2>
                <p className="pm-sub">
                  Administrator access is separately controlled. Aaron Dooley
                  and Tony Webster can grant, amend or remove it.
                </p>
              </div>
              <span className="pm-section-mark pm-section-mark--gold">
                <ShieldCheck size={19} />
              </span>
            </div>

            {loadingControl ? (
              <p className="pm-muted">Loading controlled access register…</p>
            ) : isPrimary ? (
              <>
                <div className="pm-primary-banner">
                  <BadgeCheck size={17} />
                  <span>
                    <strong>Protected administrator</strong> — you are one of the
                    authorised controllers for administrator access changes.
                  </span>
                </div>
                <div className="pm-inline-form">
                  <label className="pm-field">
                    <span>Staff email</span>
                    <input
                      list="pm-staff-directory"
                      type="email"
                      value={promotionEmail}
                      onChange={(event) =>
                        setPromotionEmail(event.target.value)
                      }
                      placeholder="staff.member@ecologyconsulting.au"
                    />
                  </label>
                  <button
                    className="pm-submit pm-submit--compact"
                    type="button"
                    onClick={grantAdmin}
                    disabled={!authoritySchemaReady}
                  >
                    <ShieldPlus size={15} /> Grant administrator access
                  </button>
                </div>
                <AdminRegister
                  emails={adminEmails}
                  primaryEmails={control?.primaryEmails || []}
                  removable
                  onRemove={removeAdmin}
                />
                <RequestRegister
                  requests={accessRequests}
                  primary
                  onDecide={decideAccessRequest}
                />
              </>
            ) : (
              <>
                <AccessNotice>
                  <LockKeyhole size={16} />
                  <span>
                    Your administrator account can manage staff setup and
                    specialist roles. Administrator access changes require review
                    by Aaron Dooley or Tony Webster.
                  </span>
                </AccessNotice>
                <div className="pm-request-form">
                  <label className="pm-field">
                    <span>Staff email</span>
                    <input
                      list="pm-staff-directory"
                      type="email"
                      value={requestForm.targetEmail}
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          targetEmail: event.target.value,
                        })
                      }
                      placeholder="staff.member@ecologyconsulting.au"
                    />
                  </label>
                  <label className="pm-field">
                    <span>Request</span>
                    <select
                      value={requestForm.requestType}
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          requestType: event.target.value,
                        })
                      }
                    >
                      <option value="grant">Grant administrator access</option>
                      <option value="remove">
                        Remove administrator access
                      </option>
                    </select>
                  </label>
                  <label className="pm-field pm-request-form__reason">
                    <span>Reason (optional)</span>
                    <input
                      value={requestForm.reason}
                      onChange={(event) =>
                        setRequestForm({
                          ...requestForm,
                          reason: event.target.value,
                        })
                      }
                      placeholder="Context for protected-administrator review"
                    />
                  </label>
                  <button
                    className="pm-submit pm-submit--compact"
                    type="button"
                    onClick={submitAccessRequest}
                    disabled={!authoritySchemaReady}
                  >
                    <Send size={15} /> Send request for review
                  </button>
                </div>
                <RequestRegister requests={accessRequests} />
              </>
            )}
          </section>

          {isPrimary ? (
            <section className="pm-card pm-card--admin-control">
              <div className="pm-section-head">
                <div>
                  <span className="pm-kicker">Restricted · Primary only</span>
                  <h2>
                    <Scale size={18} /> Ecado visibility
                  </h2>
                  <p className="pm-sub">
                    Ecado is hidden from every account not on this list — no
                    request flow, no delegation. Only Aaron Dooley or Tony
                    Webster can grant or revoke it.
                  </p>
                </div>
                <span className="pm-section-mark pm-section-mark--gold">
                  <Scale size={19} />
                </span>
              </div>

              {ecadoError ? <p className="pm-muted" style={{ color: "#a5342a" }}>{ecadoError}</p> : null}

              <div className="pm-inline-form">
                <label className="pm-field">
                  <span>Staff email</span>
                  <input
                    list="pm-staff-directory"
                    type="email"
                    value={ecadoEmail}
                    onChange={(event) => setEcadoEmail(event.target.value)}
                    placeholder="staff.member@ecologyconsulting.au"
                  />
                </label>
                <button className="pm-submit pm-submit--compact" type="button" onClick={grantEcadoAccess}>
                  <ShieldPlus size={15} /> Grant Ecado access
                </button>
              </div>

              <div className="pm-register pm-admin-register">
                <div className="pm-register-head">
                  <span>Ecado viewer register</span>
                  <b>{ecadoViewers.length}</b>
                </div>
                {ecadoLoading ? (
                  <p className="pm-muted">Loading Ecado viewer register…</p>
                ) : ecadoViewers.length === 0 ? (
                  <p className="pm-muted">No one has Ecado access yet.</p>
                ) : (
                  ecadoViewers.map((viewer) => (
                    <div className="pm-register-row" key={viewer.email}>
                      <span className="pm-register-row__identity">
                        <Scale size={15} />
                        <span>{viewer.email}</span>
                      </span>
                      <button
                        type="button"
                        className="pm-icon-btn pm-icon-btn--danger"
                        onClick={() => revokeEcadoAccess(viewer.email)}
                        aria-label={`Remove Ecado access for ${viewer.email}`}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </section>
      )}

      {view === "stafflist" && (
        <PortalStaffList
          onAddStaff={() => {
            setIssued(null);
            setError("");
            setView("access");
          }}
        />
      )}

      {view === "visibility" && isPrimary ? (
        <PortalVisibilityManager
          resourceKey="staff.projects"
          showAll
          onClose={() => setView("access")}
        />
      ) : null}

      {view === "commercial" && isPrimary ? (
        <PortalVisibilityManager
          resourceKey="admin.quote_pipeline"
          onClose={() => setView("access")}
        />
      ) : null}

      {view === "roles" && (
        <section
          className="pm-workspace"
          aria-label="Specialist roles and assessors"
        >
          <section className="pm-card pm-card--role-hero">
            <span className="pm-kicker">Specialist allocation</span>
            <h2>
              <ShieldPlus size={18} /> Assign a defined review role
            </h2>
            <p className="pm-sub">
              Specialist roles distinguish responsibility from administrator
              access. They are recorded for review and withdrawn here when
              accountability changes.
            </p>
            <div className="pm-role-cards">
              {ROLE_OPTIONS.map(({ key, label, description, Icon, tone }) => (
                <button
                  key={key}
                  type="button"
                  className={`pm-role-card pm-role-card--${tone} ${roleForm.roleKey === key ? "selected" : ""}`}
                  onClick={() =>
                    setRoleForm({
                      ...roleForm,
                      roleKey: key,
                      moduleScope:
                        key === "module_assessor" ? roleForm.moduleScope : "",
                    })
                  }
                >
                  <Icon size={19} />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="pm-role-form">
              <label className="pm-field">
                <span>Staff member</span>
                <input
                  list="pm-staff-directory"
                  type="email"
                  value={roleForm.targetEmail}
                  onChange={(event) =>
                    setRoleForm({
                      ...roleForm,
                      targetEmail: event.target.value,
                    })
                  }
                  placeholder="staff.member@ecologyconsulting.au"
                />
              </label>
              <div className="pm-selected-role">
                <roleOption.Icon size={17} />
                <span>
                  <strong>{roleOption.label}</strong>
                  <small>{roleOption.description}</small>
                </span>
              </div>
              {roleForm.roleKey === "module_assessor" && (
                <label className="pm-field pm-role-form__scope">
                  <span>Module or programme scope</span>
                  <input
                    value={roleForm.moduleScope}
                    onChange={(event) =>
                      setRoleForm({
                        ...roleForm,
                        moduleScope: event.target.value,
                      })
                    }
                    placeholder="e.g. All core onboarding modules"
                  />
                </label>
              )}
              <button
                className="pm-submit pm-submit--compact"
                type="button"
                onClick={assignRole}
                disabled={!authoritySchemaReady}
              >
                <ShieldPlus size={15} /> Allocate role
              </button>
            </div>
          </section>

          <section className="pm-card">
            <div className="pm-section-head pm-section-head--simple">
              <div>
                <span className="pm-kicker">Current accountabilities</span>
                <h2>
                  <Users2 size={18} /> Active specialist roles
                </h2>
              </div>
              <span className="pm-count">{activeRoles.length}</span>
            </div>
            {loadingControl ? (
              <p className="pm-muted">Loading role register…</p>
            ) : activeRoles.length === 0 ? (
              <p className="pm-muted">
                No specialist roles have been allocated yet.
              </p>
            ) : (
              <div className="pm-register pm-role-register">
                {activeRoles.map((assignment) => (
                  <RoleRow
                    key={assignment.id}
                    assignment={assignment}
                    onRemove={removeRole}
                  />
                ))}
              </div>
            )}
          </section>
        </section>
      )}

      {view === "onboarding" && (
        <section
          className="pm-workspace pm-workspace--onboarding"
          aria-label="Onboarding assignments and progress"
        >
          <div className="pm-onboarding-intro">
            <span className="pm-kicker">Controlled onboarding</span>
            <h2>
              <ClipboardCheck size={20} /> Onboarding assignments & progress
            </h2>
            <p>
              Draft the pathway, lock and assign it to a person, then monitor
              their progress from one dedicated workspace.
            </p>
          </div>
          {onboardingContent || (
            <AccessNotice>
              <AlertCircle size={16} />
              <span>
                Onboarding controls are not available in this portal view.
              </span>
            </AccessNotice>
          )}
        </section>
      )}

      {view === "system" && <PortalSystemHealth />}
      {view === "exports" && <AdminExportCentre />}
      {view === "audit" && <AdminAuditLog />}
      {view === "restricted" && <AdminRestrictedWorkflows />}

      <datalist id="pm-staff-directory">
        {staffDirectory.map((person) => (
          <option key={person.id || person.email} value={person.email}>
            {person.name || person.email}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function AdminRegister({ emails, primaryEmails = [], removable, onRemove }) {
  return (
    <div className="pm-register pm-admin-register">
      <div className="pm-register-head">
        <span>Administrator register</span>
        <b>{emails.length}</b>
      </div>
      {emails.length === 0 ? (
        <p className="pm-muted">No administrator records found.</p>
      ) : (
        emails.map((email) => {
          const isPrimary = primaryEmails.includes(email);
          return (
            <div className="pm-register-row" key={email}>
              <span className="pm-register-row__identity">
                <ShieldCheck size={15} />
                <span>
                  {email}
                  {isPrimary && <small>Primary authority</small>}
                </span>
              </span>
              {isPrimary ? (
                <span className="pm-protected">Protected</span>
              ) : removable ? (
                <button
                  type="button"
                  className="pm-icon-btn pm-icon-btn--danger"
                  onClick={() => onRemove(email)}
                  aria-label={`Remove administrator access for ${email}`}
                >
                  <X size={15} />
                </button>
              ) : (
                <span className="pm-protected">Request required</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function RequestRegister({ requests, primary = false, onDecide }) {
  const pending = requests.filter((request) => request.status === "pending");
  if (pending.length === 0) return null;
  return (
    <div className="pm-request-register">
      <div className="pm-register-head">
        <span>
          {primary
            ? "Requests awaiting your review"
            : "Your open administrator-access requests"}
        </span>
        <b>{pending.length}</b>
      </div>
      {pending.map((request) => (
        <div key={request.id} className="pm-request-row">
          <span>
            <strong>
              {request.requestType === "remove" ? "Remove" : "Grant"}{" "}
              administrator access
            </strong>
            <small>
              {request.targetEmail} · requested{" "}
              {formatTimestamp(request.createdAt)}
            </small>
            {request.reason && <em>{request.reason}</em>}
          </span>
          {primary ? (
            <span className="pm-request-actions">
              <button
                type="button"
                className="pm-request-approve"
                onClick={() => onDecide?.(request, "approved")}
              >
                Approve
              </button>
              <button
                type="button"
                className="pm-request-reject"
                onClick={() => onDecide?.(request, "rejected")}
              >
                Reject
              </button>
            </span>
          ) : (
            <span className="pm-status">Awaiting review</span>
          )}
        </div>
      ))}
    </div>
  );
}

function RoleRow({ assignment, onRemove }) {
  const role = ROLE_OPTIONS.find((option) => option.key === assignment.roleKey);
  const Icon = role?.Icon || ShieldPlus;
  return (
    <div className="pm-register-row pm-role-row">
      <span className="pm-register-row__identity">
        <span className={`pm-role-token ${role?.tone || "default"}`}>
          <Icon size={14} />
        </span>
        <span>
          <strong>{assignment.targetName || assignment.targetEmail}</strong>
          <small>
            {role?.label || assignment.roleKey}
            {assignment.moduleScope ? ` · ${assignment.moduleScope}` : ""}
          </small>
        </span>
      </span>
      <button
        type="button"
        className="pm-icon-btn"
        onClick={() => onRemove({ ...assignment, roleLabel: role?.label })}
        aria-label={`Withdraw ${role?.label || "specialist"} role`}
      >
        <X size={15} />
      </button>
    </div>
  );
}
