"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  LifeBuoy,
  Loader2,
  Package,
  ListTodo,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import PsychosocialSupportCard from "./PsychosocialSupportCard";

const TYPES = {
  leave: {
    label: "Leave request",
    Icon: CalendarDays,
    hint: "Provide the dates and handover detail so your manager can assess the request quickly.",
    fields: [
      {
        id: "leave_type",
        label: "Leave type",
        type: "select",
        required: true,
        options: [
          "Annual leave",
          "Personal / carer’s leave",
          "Long service leave",
          "Other",
        ],
      },
      {
        id: "start_date",
        label: "First day of leave",
        type: "date",
        required: true,
      },
      {
        id: "end_date",
        label: "Last day of leave",
        type: "date",
        required: true,
      },
      {
        id: "total_days",
        label: "Working days requested",
        type: "number",
        step: "0.5",
      },
      {
        id: "handover",
        label: "Handover or project coverage",
        type: "textarea",
        full: true,
        placeholder:
          "List affected work, deadlines and any handover arrangements.",
      },
    ],
  },
  training: {
    label: "Training request",
    Icon: GraduationCap,
    hint: "Describe the proposed learning activity, timing, cost and expected benefit to Ecology Consulting.",
    fields: [
      { id: "course", label: "Course or accreditation", required: true },
      { id: "provider", label: "Provider" },
      { id: "preferred_date", label: "Preferred date", type: "date" },
      {
        id: "estimated_cost",
        label: "Estimated cost (AUD)",
        type: "number",
        step: "0.01",
      },
      { id: "project_or_client", label: "Related project or client" },
      {
        id: "business_benefit",
        label: "Business benefit and application",
        type: "textarea",
        full: true,
        required: true,
        placeholder:
          "Explain how the training supports your role, a competency requirement or current work.",
      },
    ],
  },
  task: {
    label: "Task request",
    Icon: ListTodo,
    hint: "Describe the task, project connection, priority and delivery date. Task requests are not assigned until approved.",
    fields: [
      { id: "project_related", label: "Is this project related?", type: "select", required: true, options: ["Yes", "No"] },
      { id: "project", label: "Project" },
      { id: "category", label: "Task category", required: true },
      { id: "estimated_hours", label: "Estimated hours", type: "number", step: "0.25", required: true },
      { id: "due_date", label: "Required completion date", type: "date" },
      { id: "priority", label: "Priority", type: "select", required: true, options: ["Low", "Normal", "High", "Urgent"] },
      { id: "preferred_assignee", label: "Preferred assignee (optional)" },
      { id: "task_details", label: "Task details, deliverable and dependencies", type: "textarea", full: true, required: true, placeholder: "Describe the task, expected output, relevant files and any dependencies." },
    ],
  },
  other: {
    label: "Other request",
    Icon: LifeBuoy,
    hint: "Use this for a support request that does not fit the leave, training, equipment or task categories.",
    fields: [
      { id: "priority", label: "Priority", type: "select", required: true, options: ["Low", "Normal", "High", "Urgent"] },
      { id: "required_by", label: "Required by", type: "date" },
      { id: "request_details", label: "Request details", type: "textarea", full: true, required: true, placeholder: "Explain what support is needed and any relevant context." },
    ],
  },
  equipment: {
    label: "Equipment request",
    Icon: Package,
    hint: "Include the specific item, use case and timing needed for a safe and effective review.",
    fields: [
      { id: "item", label: "Equipment required", required: true },
      {
        id: "project_or_use",
        label: "Project or intended use",
        required: true,
      },
      {
        id: "priority",
        label: "Priority",
        type: "select",
        required: true,
        options: ["Routine", "Required soon", "Urgent safety or delivery need"],
      },
      { id: "required_by", label: "Required by", type: "date" },
      {
        id: "estimated_cost",
        label: "Estimated cost (AUD)",
        type: "number",
        step: "0.01",
      },
      {
        id: "specification",
        label: "Specification, delivery details or alternatives",
        type: "textarea",
        full: true,
        placeholder:
          "Include model, sizing, supplier link, location or other useful review information.",
      },
    ],
  },
};

const STATUS = {
  draft: "draft",
  submitted: "submitted",
  returned: "returned",
  assigned: "assigned",
  in_progress: "in_progress",
  approved: "approved",
  declined: "declined",
  cancelled: "cancelled",
  reviewed: "reviewed",
  actioned: "actioned",
  closed: "closed",
  archived: "archived",
};

const labelFor = (key) =>
  String(key || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const detailSummary = (details) =>
  Object.entries(details || {})
    .filter(
      ([, value]) =>
        value !== null && value !== undefined && String(value).trim(),
    )
    .slice(0, 4)
    .map(([key, value]) => `${labelFor(key)}: ${value}`)
    .join(" · ");

export default function StaffServiceRequests({ embedded = false }) {
  const { session } = useAuth();
  const [requests, setRequests] = useState([]);
  const [type, setType] = useState("leave");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [submissionKey, setSubmissionKey] = useState("");
  const draftKey = session?.user?.id
    ? `ec-service-request-draft:${session.user.id}`
    : "";

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    }),
    [session?.access_token],
  );
  const typeMeta = TYPES[type];
  const requiredFields = useMemo(
    () => typeMeta.fields.filter((field) => field.required),
    [typeMeta],
  );

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/service-requests", {
        headers: headers(),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not load service requests.");
      setRequests(body.requests || []);
    } catch (loadError) {
      setError(loadError.message || "Could not load service requests.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!draftKey) return;
    try {
      const draft = JSON.parse(window.localStorage.getItem(draftKey) || "null");
      if (draft && TYPES[draft.type]) {
        setType(draft.type);
        setTitle(typeof draft.title === "string" ? draft.title : "");
        setDetails(draft.details && typeof draft.details === "object" ? draft.details : {});
        setSubmissionKey(typeof draft.submissionKey === "string" ? draft.submissionKey : "");
      }
    } catch {
      // A malformed local draft must not block the staff member's form.
    } finally {
      setDraftReady(true);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady || !draftKey) return;
    const hasDraft = title.trim() || Object.values(details).some((value) =>
      String(value || "").trim(),
    );
    if (!hasDraft) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          draftKey,
            JSON.stringify({ type, title, details, submissionKey, updatedAt: new Date().toISOString() }),
        );
      } catch {
        // Browser storage is a resilience layer only; nothing is submitted automatically.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [details, draftKey, draftReady, submissionKey, title, type]);

  const clearDraft = () => {
    setTitle("");
    setDetails({});
    setSubmissionKey("");
    if (draftKey) window.localStorage.removeItem(draftKey);
    setMessage("Unsubmitted request draft cleared from this browser.");
  };

  const changeType = (nextType) => {
    setType(nextType);
    setDetails({});
    setSubmissionKey("");
    setError("");
    setMessage("");
  };
  const setDetail = (id, value) =>
    setDetails((current) => ({ ...current, [id]: value }));

  const submit = async () => {
    const missing = requiredFields.find(
      (field) => !String(details[field.id] || "").trim(),
    );
    if (title.trim().length < 2 || missing) {
      setError(
        missing
          ? `Add ${missing.label.toLowerCase()} before submitting.`
          : "Add a short request title before submitting.",
      );
      return;
    }
    setSaving(true);
    setError("");
    const requestKey = submissionKey || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    setSubmissionKey(requestKey);
    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          request_type: type,
          title: `${typeMeta.label}: ${title.trim()}`,
          details: Object.fromEntries(
            Object.entries(details).filter(([, value]) =>
              String(value || "").trim(),
            ),
          ),
          submissionKey: requestKey,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not submit the request.");
      setTitle("");
      setDetails({});
      setSubmissionKey("");
      if (draftKey) window.localStorage.removeItem(draftKey);
      setMessage("Request submitted for administrator review.");
      window.setTimeout(() => setMessage(""), 3200);
      await load();
    } catch (submitError) {
      setError(submitError.message || "Could not submit the request.");
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (requestId) => {
    if (!window.confirm("Withdraw this request? It cannot be restored."))
      return;
    setWithdrawingId(requestId);
    setError("");
    try {
      const response = await fetch(`/api/service-requests/${requestId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ action: "cancel" }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not withdraw the request.");
      setMessage("Request withdrawn.");
      window.setTimeout(() => setMessage(""), 3200);
      await load();
    } catch (withdrawError) {
      setError(withdrawError.message || "Could not withdraw the request.");
    } finally {
      setWithdrawingId("");
    }
  };

  return (
    <section
      className={`staff-service-requests${embedded ? " embedded" : ""}`}
      aria-labelledby="service-request-heading"
    >
      <div className="my-projects-section-head">
        <div>
          <span>Staff support</span>
          <h2 id="service-request-heading">
            <LifeBuoy size={18} /> Service requests
          </h2>
          <p>
              Submit a structured leave, training, equipment, task or other request and track
              the administrator’s decision here.
          </p>
        </div>
      </div>
      {error ? (
        <p className="ssr-error" role="alert">
          <AlertCircle size={16} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="ssr-success" role="status">
          <CheckCircle2 size={16} /> {message}
        </p>
      ) : null}
      <div className="ssr-grid">
        <section className="ssr-card ssr-compose-card">
          <div className="ssr-card-heading">
            <div>
              <span>New submission</span>
              <h3>Request support</h3>
            </div>
            <typeMeta.Icon size={22} aria-hidden="true" />
          </div>
          <div
            className="ssr-type-row"
            role="tablist"
            aria-label="Request type"
          >
            {Object.entries(TYPES).map(([key, meta]) => (
              <button
                type="button"
                key={key}
                role="tab"
                aria-selected={type === key}
                className={type === key ? "selected" : ""}
                onClick={() => changeType(key)}
              >
                <meta.Icon size={15} /> {meta.label.replace(" request", "")}
              </button>
            ))}
          </div>
          <p className="ssr-help">{typeMeta.hint}</p>
          <p className="ssr-autosave">
            <Save size={14} /> Unsubmitted details are automatically saved in
            this browser only. They are not sent for review until you select
            Submit for review.
          </p>
          <div className="ssr-form-grid">
            <label className="ssr-field ssr-field--full">
              <span>
                Request title <b aria-hidden="true">*</b>
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  type === "leave"
                    ? "e.g. October annual leave"
                    : type === "training"
                      ? "e.g. BAM accreditation refresher"
                      : "e.g. Replacement field GPS"
                }
              />
            </label>
            {typeMeta.fields.map((field) => (
              <label
                className={`ssr-field${field.full ? " ssr-field--full" : ""}`}
                key={field.id}
              >
                <span>
                  {field.label}{" "}
                  {field.required ? <b aria-hidden="true">*</b> : null}
                </span>
                {field.type === "textarea" ? (
                  <textarea
                    rows={4}
                    value={details[field.id] || ""}
                    placeholder={field.placeholder || ""}
                    onChange={(event) =>
                      setDetail(field.id, event.target.value)
                    }
                  />
                ) : field.type === "select" ? (
                  <select
                    value={details[field.id] || ""}
                    onChange={(event) =>
                      setDetail(field.id, event.target.value)
                    }
                  >
                    <option value="">Select…</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type || "text"}
                    step={field.step}
                    min={field.type === "number" ? "0" : undefined}
                    value={details[field.id] || ""}
                    onChange={(event) =>
                      setDetail(field.id, event.target.value)
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <div className="ssr-compose-actions">
            <button
              type="button"
              className="ssr-clear-draft"
              disabled={saving}
              onClick={clearDraft}
            >
              <Trash2 size={14} /> Clear draft
            </button>
            <button
              type="button"
              className="ssr-submit"
              disabled={saving}
              onClick={submit}
            >
            {saving ? (
              <>
                <Loader2 size={15} className="spin" /> Submitting…
              </>
            ) : (
              <>
                <Send size={15} /> Submit for review
              </>
            )}
            </button>
          </div>
        </section>
        <section className="ssr-card ssr-history-card">
          <div className="ssr-card-heading">
            <div>
              <span>Your requests</span>
              <h3>Decision history</h3>
            </div>
            <LifeBuoy size={22} aria-hidden="true" />
          </div>
          {loading ? (
            <p className="ssr-empty">
              <Loader2 size={16} className="spin" /> Loading requests…
            </p>
          ) : requests.length ? (
            <div className="ssr-list">
              {requests.slice(0, 20).map((request) => (
                <article key={request.id}>
                  <div className="ssr-list-copy">
                    <strong>{request.title}</strong>
                    <small>
                      {new Date(request.created_at).toLocaleDateString("en-AU")}
                    </small>
                    {detailSummary(request.details) ? (
                      <p>{detailSummary(request.details)}</p>
                    ) : null}
                    {request.admin_note ? (
                      <em>Administrator note: {request.admin_note}</em>
                    ) : null}
                  </div>
                  <div className="ssr-list-actions">
                    <span
                      className={`ssr-status ${STATUS[request.status] || "submitted"}`}
                    >
                      {(request.status || "submitted").replaceAll("_", " ")}
                    </span>
                    {request.status === "submitted" ? (
                      <button
                        type="button"
                        className="ssr-withdraw"
                        disabled={withdrawingId === request.id}
                        onClick={() => withdraw(request.id)}
                      >
                        {withdrawingId === request.id ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <XCircle size={13} />
                        )}{" "}
                        Withdraw
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="ssr-empty">
              No service requests yet. Start with the form on the left.
            </p>
          )}
        </section>
      </div>

      <PsychosocialSupportCard />
    </section>
  );
}
