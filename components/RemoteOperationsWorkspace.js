"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  Clock,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Plus,
  ChevronLeft,
  Home,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "../lib/AuthProvider";
import PsychosocialSupportCard from "./PsychosocialSupportCard";

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
  const [issueForm, setIssueForm] = useState({
    issueType: "question",
    title: "",
    detail: "",
  });

  const reload = async () => {
    try {
      const [profileResponse, issueResponse] = await Promise.all([
        api(session, "profiles"),
        api(session, "issues"),
      ]);
      setProfiles(profileResponse.records || []);
      setIssues(issueResponse.records || []);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (session?.access_token) reload(); // eslint-disable-line react-hooks/exhaustive-deps
  }, [session]);

  const notify = (nextMessage) => {
    setMessage(nextMessage);
    setError("");
    setTimeout(() => setMessage(""), 2500);
  };

  const saveProfile = async () => {
    if (!profileForm.staffName.trim() && !profileForm.timeZone.trim()) {
      setError(
        "Add your name or time zone before submitting your remote-work context.",
      );
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
      notify("Remote-work context submitted for administrator review.");
    } catch (e) {
      setError(e.message || "The remote-work context could not be submitted.");
    }
  };

  const saveIssue = async () => {
    if (!issueForm.title.trim()) {
      setError("Add a clear title before submitting this item.");
      return;
    }
    try {
      await api(session, "issues", "POST", issueForm);
      setIssueForm({ issueType: "question", title: "", detail: "" });
      await reload();
      notify("Your item has been sent to the delivery team.");
    } catch (e) {
      setError(e.message || "The item could not be sent.");
    }
  };

  if (loading) {
    return (
      <main className="ro-page">
        <p>Loading…</p>
      </main>
    );
  }

  const openItems = issues.filter((item) => item.status !== "resolved");
  const handovers = issues.filter((item) => item.issue_type === "handover");

  return (
    <main className="ro-page ro-page--staff">
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
          <Globe size={17} /> Remote work &amp; delivery support
        </span>
        <h1>Remote operations</h1>
        <p>
          Keep your approved work context, delivery questions and handovers
          visible to the Ecology Consulting delivery team. Commercial records
          and task allocation remain controlled in the Admin Portal.
        </p>
      </header>

      <div className="ro-stats">
        <StatCard label="My remote profiles" value={profiles.length} />
        <StatCard label="Open items" value={openItems.length} />
        <StatCard label="Handovers" value={handovers.length} />
        <StatCard
          label="Questions raised"
          value={issues.filter((item) => item.issue_type === "question").length}
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
        <section className="ro-card">
          <div className="ro-card-head">
            <span className="ro-eyebrow">
              <Clock size={13} /> My work context
            </span>
            <h2>Remote-work profile</h2>
          </div>
          {profiles.length ? (
            <div className="ro-list">
              {profiles.map((profile) => (
                <div key={profile.id} className="ro-item">
                  <strong>{profile.staff_name || "Remote-work profile"}</strong>
                  <span>
                    {[profile.base_location, profile.time_zone]
                      .filter(Boolean)
                      .join(" · ") || "Location to be confirmed"}
                  </span>
                  {profile.overlap_hours ? (
                    <span className="ro-muted">
                      Overlap: {profile.overlap_hours}
                    </span>
                  ) : null}
                  {profile.admin_note ? (
                    <span className="ro-admin-note">
                      Admin: {profile.admin_note}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="ro-empty">
              No remote-work context has been submitted yet. Add your work
              location, time zone and usual availability for administrator
              review.
            </p>
          )}
          <div className="ro-form">
            <input
              placeholder="Your name"
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
              <Plus size={13} /> Submit remote-work context
            </button>
          </div>
        </section>

        <section className="ro-card">
          <div className="ro-card-head">
            <span className="ro-eyebrow">
              <MessageSquare size={13} /> Delivery support
            </span>
            <h2>Questions, issues &amp; handovers</h2>
          </div>
          <p className="ro-empty ro-empty--intro">
            Use this space for delivery support. Accepted task briefs and
            project activities remain in My Projects.
          </p>
          <div className="ro-issue-form ro-issue-form--stacked">
            <select
              value={issueForm.issueType}
              onChange={(e) =>
                setIssueForm({ ...issueForm, issueType: e.target.value })
              }
            >
              <option value="question">Question</option>
              <option value="issue">Issue</option>
              <option value="handover">Handover</option>
            </select>
            <input
              placeholder="Short title"
              value={issueForm.title}
              onChange={(e) =>
                setIssueForm({ ...issueForm, title: e.target.value })
              }
            />
            <textarea
              placeholder="Context, decision needed or handover detail"
              value={issueForm.detail}
              onChange={(e) =>
                setIssueForm({ ...issueForm, detail: e.target.value })
              }
            />
            <button className="ro-save" onClick={saveIssue}>
              <Plus size={13} /> Send to delivery team
            </button>
          </div>
        </section>
      </div>

      <PsychosocialSupportCard />

      <section className="ro-followup">
        <div className="ro-card-head">
          <span className="ro-eyebrow">
            <MessageSquare size={13} /> My delivery support history
          </span>
          <h2>Submitted questions, issues &amp; handovers</h2>
        </div>
        {issues.length ? (
          <div className="ro-list">
            {issues.map((item) => (
              <div key={item.id} className="ro-item ro-issue">
                <div>
                  <strong>{item.title}</strong>
                  <span className="ro-muted">
                    {` · ${item.issue_type} · ${item.status.replace("_", " ")}`}
                  </span>
                </div>
                {item.detail ? <span>{item.detail}</span> : null}
                {item.admin_response ? (
                  <span className="ro-admin-note">
                    Response: {item.admin_response}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="ro-empty">
            Your submitted questions, issues and handovers will appear here.
          </p>
        )}
      </section>
    </main>
  );
}
