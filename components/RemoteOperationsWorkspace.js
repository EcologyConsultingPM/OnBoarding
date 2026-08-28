"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  Clock,
  MessageSquare,
  FileText,
  AlertCircle,
  CheckCircle2,
  Plus,
  ChevronLeft,
  Home,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "../lib/AuthProvider";

async function api(session, type, method = "GET", body, id) {
  const url = `/api/remote-ops?type=${type}${id ? `&id=${id}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function StatCard({ label, value }) {
  return (
    <div className="ro-stat">
      <div className="ro-stat-value">{value}</div>
      <div className="ro-stat-label">{label}</div>
    </div>
  );
}

export default function RemoteOperationsWorkspace() {
  const { session, loading } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [clientRecords, setClientRecords] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [profileForm, setProfileForm] = useState({
    staffName: "",
    baseLocation: "",
    timeZone: "",
    overlapHours: "",
    availability: "",
    arrangementNotes: "",
  });
  const [clientTab, setClientTab] = useState("meeting");
  const [clientForm, setClientForm] = useState({
    title: "",
    recordDetail: "",
    startDate: "",
    followUpDate: "",
  });
  const [quoteForm, setQuoteForm] = useState({
    quoteReference: "",
    quoteStage: "draft",
    quoteValueAud: "",
    quoteDate: "",
    commercialNotes: "",
  });
  const [issueForm, setIssueForm] = useState({
    issueType: "question",
    title: "",
    detail: "",
  });

  const reload = async () => {
    try {
      const [p, c, q, i] = await Promise.all([
        api(session, "profiles"),
        api(session, "client-records"),
        api(session, "quotes"),
        api(session, "issues"),
      ]);
      setProfiles(p.records);
      setClientRecords(c.records);
      setQuotes(q.records);
      setIssues(i.records);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (session?.access_token) reload(); /* eslint-disable-next-line */
  }, [session]);

  const notify = (msg) => {
    setMessage(msg);
    setError("");
    setTimeout(() => setMessage(""), 2500);
  };
  const fail = (e) => setError(e.message || "Something went wrong.");

  const saveProfile = async () => {
    if (!profileForm.staffName.trim() && !profileForm.timeZone.trim()) {
      setError("Add at least a name or time zone.");
      return;
    }
    try {
      await api(session, "profiles", "POST", profileForm);
      setProfileForm({
        staffName: "",
        baseLocation: "",
        timeZone: "",
        overlapHours: "",
        availability: "",
        arrangementNotes: "",
      });
      await reload();
      notify("Remote-work profile saved.");
    } catch (e) {
      fail(e);
    }
  };
  const saveClient = async () => {
    if (!clientForm.title.trim()) {
      setError("A meeting or question title is required.");
      return;
    }
    try {
      await api(session, "client-records", "POST", {
        ...clientForm,
        kind: clientTab,
      });
      setClientForm({
        title: "",
        recordDetail: "",
        startDate: "",
        followUpDate: "",
      });
      await reload();
      notify("Client record saved.");
    } catch (e) {
      fail(e);
    }
  };
  const saveQuote = async () => {
    try {
      await api(session, "quotes", "POST", quoteForm);
      setQuoteForm({
        quoteReference: "",
        quoteStage: "draft",
        quoteValueAud: "",
        quoteDate: "",
        commercialNotes: "",
      });
      await reload();
      notify("Quote saved.");
    } catch (e) {
      fail(e);
    }
  };
  const saveIssue = async () => {
    if (!issueForm.title.trim()) {
      setError("A title is required.");
      return;
    }
    try {
      await api(session, "issues", "POST", issueForm);
      setIssueForm({ issueType: "question", title: "", detail: "" });
      await reload();
      notify("Item saved for follow-up.");
    } catch (e) {
      fail(e);
    }
  };

  if (loading)
    return (
      <main className="ro-page">
        <p>Loading…</p>
      </main>
    );

  const openItems = [
    ...clientRecords.filter((c) => c.status !== "closed"),
    ...issues.filter((i) => i.status !== "resolved"),
  ];

  return (
    <main className="ro-page">
      <div className="ro-nav">
        <button className="ro-nav-btn" onClick={() => window.history.back()}>
          <ChevronLeft size={15} /> Back
        </button>
        <Link href="/" className="ro-nav-btn">
          <Home size={14} /> Home
        </Link>
      </div>
      <header className="ro-hero">
        <span>
          <Globe size={17} /> International delivery oversight
        </span>
        <h1>Remote operations</h1>
        <p>
          Keep the Philippines and Australia/Sydney work context, handovers,
          client follow-up and project issues visible without collecting
          unnecessary personal information.
        </p>
      </header>

      <div className="ro-stats">
        <StatCard
          label="Active profiles"
          value={profiles.filter((p) => p.status === "active").length}
        />
        <StatCard label="Open communications" value={openItems.length} />
        <StatCard
          label="Recent handovers"
          value={issues.filter((i) => i.issue_type === "handover").length}
        />
        <StatCard
          label="Active quotes"
          value={
            quotes.filter(
              (q) => q.quote_stage === "draft" || q.quote_stage === "sent",
            ).length
          }
        />
      </div>

      {error ? (
        <p className="ro-error" role="alert">
          <AlertCircle size={15} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="ro-success" role="status">
          <CheckCircle2 size={15} /> {message}
        </p>
      ) : null}

      <div className="ro-columns">
        {/* Profiles */}
        <section className="ro-card">
          <div className="ro-card-head">
            <span className="ro-eyebrow">
              <Clock size={13} /> Time-zone context
            </span>
            <h2>Approved remote-work profiles</h2>
          </div>
          {profiles.length ? (
            <div className="ro-list">
              {profiles.map((p) => (
                <div key={p.id} className="ro-item">
                  <strong>{p.staff_name || "Profile"}</strong>
                  <span>
                    {[p.base_location, p.time_zone]
                      .filter(Boolean)
                      .join(" · ") || "No location set"}
                  </span>
                  {p.overlap_hours ? (
                    <span className="ro-muted">Overlap: {p.overlap_hours}</span>
                  ) : null}
                  {p.admin_note ? (
                    <span className="ro-admin-note">Admin: {p.admin_note}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="ro-empty">
              No remote-work profiles yet. Create an approved time-zone context
              when an international arrangement is confirmed.
            </p>
          )}
          <div className="ro-form">
            <input
              placeholder="Staff name"
              value={profileForm.staffName}
              onChange={(e) =>
                setProfileForm({ ...profileForm, staffName: e.target.value })
              }
            />
            <div className="ro-two">
              <input
                placeholder="Base location"
                value={profileForm.baseLocation}
                onChange={(e) =>
                  setProfileForm({
                    ...profileForm,
                    baseLocation: e.target.value,
                  })
                }
              />
              <input
                placeholder="Time zone"
                value={profileForm.timeZone}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, timeZone: e.target.value })
                }
              />
            </div>
            <div className="ro-two">
              <input
                placeholder="Overlap hours"
                value={profileForm.overlapHours}
                onChange={(e) =>
                  setProfileForm({
                    ...profileForm,
                    overlapHours: e.target.value,
                  })
                }
              />
              <input
                placeholder="Availability"
                value={profileForm.availability}
                onChange={(e) =>
                  setProfileForm({
                    ...profileForm,
                    availability: e.target.value,
                  })
                }
              />
            </div>
            <textarea
              placeholder="Arrangement notes"
              value={profileForm.arrangementNotes}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  arrangementNotes: e.target.value,
                })
              }
            />
            <button className="ro-save" onClick={saveProfile}>
              <Plus size={13} /> Save profile
            </button>
          </div>
        </section>

        {/* Client records */}
        <section className="ro-card">
          <div className="ro-card-head">
            <span className="ro-eyebrow">
              <MessageSquare size={13} /> Client coordination
            </span>
            <h2>Meetings and client questions</h2>
          </div>
          <div className="ro-tabs">
            <button
              className={clientTab === "meeting" ? "active" : ""}
              onClick={() => setClientTab("meeting")}
            >
              Client meeting
            </button>
            <button
              className={clientTab === "question" ? "active" : ""}
              onClick={() => setClientTab("question")}
            >
              Client question
            </button>
          </div>
          {clientRecords.length ? (
            <div className="ro-list">
              {clientRecords.slice(0, 5).map((c) => (
                <div key={c.id} className="ro-item">
                  <strong>{c.title}</strong>
                  <span className="ro-muted">
                    {c.kind === "meeting" ? "Meeting" : "Question"}
                    {c.follow_up_date ? ` · follow-up ${c.follow_up_date}` : ""}
                  </span>
                  {c.admin_response ? (
                    <span className="ro-admin-note">
                      Response: {c.admin_response}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="ro-form">
            <input
              placeholder={
                clientTab === "meeting" ? "Meeting title" : "Question title"
              }
              value={clientForm.title}
              onChange={(e) =>
                setClientForm({ ...clientForm, title: e.target.value })
              }
            />
            <textarea
              placeholder="Decision, follow-up or communication record"
              value={clientForm.recordDetail}
              onChange={(e) =>
                setClientForm({ ...clientForm, recordDetail: e.target.value })
              }
            />
            <div className="ro-two">
              <input
                type="date"
                value={clientForm.startDate}
                onChange={(e) =>
                  setClientForm({ ...clientForm, startDate: e.target.value })
                }
              />
              <input
                type="date"
                value={clientForm.followUpDate}
                onChange={(e) =>
                  setClientForm({ ...clientForm, followUpDate: e.target.value })
                }
              />
            </div>
            <button className="ro-save" onClick={saveClient}>
              <Plus size={13} /> Save client record
            </button>
          </div>
        </section>

        {/* Quotes */}
        <section className="ro-card">
          <div className="ro-card-head">
            <span className="ro-eyebrow">
              <FileText size={13} /> Commercial pipeline
            </span>
            <h2>Project quotes</h2>
          </div>
          {quotes.length ? (
            <div className="ro-list">
              {quotes.slice(0, 5).map((q) => (
                <div key={q.id} className="ro-item">
                  <strong>{q.quote_reference || "Quote"}</strong>
                  <span className="ro-muted">
                    {q.quote_stage}
                    {q.quote_value_aud != null
                      ? ` · $${Number(q.quote_value_aud).toLocaleString("en-AU")}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="ro-form">
            <div className="ro-two">
              <input
                placeholder="Quote reference"
                value={quoteForm.quoteReference}
                onChange={(e) =>
                  setQuoteForm({ ...quoteForm, quoteReference: e.target.value })
                }
              />
              <select
                value={quoteForm.quoteStage}
                onChange={(e) =>
                  setQuoteForm({ ...quoteForm, quoteStage: e.target.value })
                }
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
              </select>
            </div>
            <div className="ro-two">
              <input
                placeholder="Quote value (AUD)"
                value={quoteForm.quoteValueAud}
                onChange={(e) =>
                  setQuoteForm({ ...quoteForm, quoteValueAud: e.target.value })
                }
              />
              <input
                type="date"
                value={quoteForm.quoteDate}
                onChange={(e) =>
                  setQuoteForm({ ...quoteForm, quoteDate: e.target.value })
                }
              />
            </div>
            <textarea
              placeholder="Commercial notes and next action"
              value={quoteForm.commercialNotes}
              onChange={(e) =>
                setQuoteForm({ ...quoteForm, commercialNotes: e.target.value })
              }
            />
            <button className="ro-save" onClick={saveQuote}>
              <Plus size={13} /> Save quote
            </button>
          </div>
        </section>
      </div>

      {/* Management follow-up */}
      <section className="ro-followup">
        <div className="ro-card-head">
          <span className="ro-eyebrow">
            <MessageSquare size={13} /> Management follow-up
          </span>
          <h2>Open questions, issues and client records</h2>
        </div>
        <div className="ro-issue-form">
          <select
            value={issueForm.issueType}
            onChange={(e) =>
              setIssueForm({ ...issueForm, issueType: e.target.value })
            }
          >
            <option value="question">Question</option>
            <option value="issue">Issue</option>
            <option value="handover">Handover</option>
            <option value="client">Client</option>
          </select>
          <input
            placeholder="Title"
            value={issueForm.title}
            onChange={(e) =>
              setIssueForm({ ...issueForm, title: e.target.value })
            }
          />
          <input
            placeholder="Detail"
            value={issueForm.detail}
            onChange={(e) =>
              setIssueForm({ ...issueForm, detail: e.target.value })
            }
          />
          <button className="ro-save" onClick={saveIssue}>
            <Plus size={13} /> Add
          </button>
        </div>
        {issues.length ? (
          <div className="ro-list">
            {issues.map((i) => (
              <div key={i.id} className="ro-item ro-issue">
                <div>
                  <strong>{i.title}</strong>
                  <span className="ro-muted">
                    {" "}
                    · {i.issue_type} · {i.status.replace("_", " ")}
                  </span>
                </div>
                {i.detail ? <span>{i.detail}</span> : null}
                {i.admin_response ? (
                  <span className="ro-admin-note">
                    Response: {i.admin_response}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="ro-empty">
            No open remote-operations records. Staff questions, project issues
            and client records appear here for management follow-up.
          </p>
        )}
      </section>
    </main>
  );
}
