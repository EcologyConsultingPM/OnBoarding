"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  LifeBuoy,
  Loader2,
  Package,
  Send,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const TYPES = {
  leave: {
    label: "Leave request",
    Icon: CalendarDays,
    hint: "Dates, leave type and any relevant handover information.",
  },
  training: {
    label: "Training request",
    Icon: GraduationCap,
    hint: "Course, provider, timing, cost and business benefit.",
  },
  equipment: {
    label: "Equipment request",
    Icon: Package,
    hint: "Required equipment, project/use case, priority and delivery details.",
  },
};
const STATUS = {
  submitted: "submitted",
  approved: "approved",
  declined: "declined",
  cancelled: "cancelled",
  reviewed: "reviewed",
  actioned: "actioned",
  archived: "archived",
};

export default function StaffServiceRequests({ embedded = false }) {
  const { session } = useAuth();
  const [requests, setRequests] = useState([]);
  const [type, setType] = useState("leave");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    }),
    [session?.access_token],
  );
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/service-requests", { headers: headers() });
      const body = await res.json();
      if (!res.ok)
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

  const submit = async () => {
    if (title.trim().length < 2 || details.trim().length < 2) {
      setError(
        "Add a short request title and the information needed for review.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          request_type: type,
          title: `${TYPES[type].label}: ${title.trim()}`,
          details: { note: details.trim() },
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.error || "Could not submit the request.");
      setTitle("");
      setDetails("");
      setMessage("Service request submitted for administrator review.");
      setTimeout(() => setMessage(""), 3200);
      await load();
    } catch (submitError) {
      setError(submitError.message || "Could not submit the request.");
    } finally {
      setSaving(false);
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
            Submit leave, training or equipment requests and follow their review
            status.
          </p>
        </div>
      </div>
      {error ? (
        <p className="ssr-error">
          <AlertCircle size={16} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="ssr-success">
          <CheckCircle2 size={16} /> {message}
        </p>
      ) : null}
      <div className="ssr-grid">
        <section className="ssr-card">
          <h3>New request</h3>
          <div className="ssr-type-row">
            {Object.entries(TYPES).map(([key, meta]) => (
              <button
                type="button"
                key={key}
                className={type === key ? "selected" : ""}
                onClick={() => setType(key)}
              >
                <meta.Icon size={15} /> {meta.label.replace(" request", "")}
              </button>
            ))}
          </div>
          <label>
            Request title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                type === "leave"
                  ? "e.g. Annual leave, 14–18 October"
                  : type === "training"
                    ? "e.g. BAM accreditation refresher"
                    : "e.g. Replacement field GPS"
              }
            />
          </label>
          <label>
            Information
            <textarea
              rows={5}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder={TYPES[type].hint}
            />
          </label>
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
                <Send size={15} /> Submit request
              </>
            )}
          </button>
        </section>
        <section className="ssr-card">
          <h3>My request history</h3>
          {loading ? (
            <p className="ssr-empty">
              <Loader2 size={16} className="spin" /> Loading requests…
            </p>
          ) : requests.length ? (
            <div className="ssr-list">
              {requests.slice(0, 20).map((request) => (
                <article key={request.id}>
                  <div>
                    <strong>{request.title}</strong>
                    <small>
                      {new Date(request.created_at).toLocaleDateString("en-AU")}
                      {request.admin_note ? ` · ${request.admin_note}` : ""}
                    </small>
                  </div>
                  <span
                    className={`ssr-status ${STATUS[request.status] || "submitted"}`}
                  >
                    {(request.status || "submitted").replaceAll("_", " ")}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="ssr-empty">No service requests yet.</p>
          )}
        </section>
      </div>
    </section>
  );
}
