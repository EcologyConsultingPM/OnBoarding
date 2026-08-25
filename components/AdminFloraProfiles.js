"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Search, AlertCircle, CheckCircle2, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FLORA_PROFILES } from "../lib/floraData";

const LISTING_STYLE = {
  "Critically Endangered": { fg: "#a5342a", bg: "rgba(212,86,63,.14)", short: "CE", accent: "#d4563f" },
  "Endangered": { fg: "#a5772b", bg: "rgba(233,201,121,.18)", short: "E", accent: "#c9962a" },
  "Vulnerable": { fg: "#1d6b6b", bg: "rgba(143,214,200,.18)", short: "V", accent: "#5fc9c9" },
};

export default function AdminFloraProfiles({ onToast }) {
  const { session } = useAuth();
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewingId, setReviewingId] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const [q, setQ] = useState("");

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("GET", "/api/flora-photos");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't load submissions");
      setSubs(d.submissions || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  const decide = async (id, status, review_note) => {
    try {
      const res = await authFetch("PATCH", `/api/flora-photos/${id}`, { status, review_note: review_note || "" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't update");
      setReviewingId(null); setRejectNote("");
      await load();
      onToast && onToast(status === "verified" ? "Photo verified." : "Photo rejected.");
    } catch (e) { setError(e.message); }
  };

  const queue = useMemo(() => subs.slice().sort((a, b) => {
    const rank = (s) => (s === "pending" ? 0 : s === "verified" ? 1 : 2);
    return rank(a.status) - rank(b.status) || new Date(b.created_at) - new Date(a.created_at);
  }), [subs]);
  const pendingCount = subs.filter((s) => s.status === "pending").length;
  const verifiedCount = subs.filter((s) => s.status === "verified").length;

  const nq = q.trim().toLowerCase();
  const browseList = useMemo(() => {
    if (!nq) return [];
    return FLORA_PROFILES.filter((p) => (p.name + " " + (p.common || "") + " " + (p.family || "")).toLowerCase().includes(nq)).slice(0, 30);
  }, [nq]);

  return (
    <div className="afp">
      <header className="fp-hero">
        <span>Ecology Consulting · Flora expert</span>
        <h1>Flora &amp; Fauna Profiles</h1>
        <p>Field photos awaiting your verification. Only verified photos are published to the flora profile and marked with a green tick. Fauna profiles will join this domain next.</p>
        <div className="fp-hero-stats">
          <div><strong className="fp-stat-gold">{pendingCount}</strong><span>Pending</span></div>
          <div><strong style={{ color: "#4fb583" }}>{verifiedCount}</strong><span>Verified</span></div>
          <div><strong>{FLORA_PROFILES.length}</strong><span>Profiles in library</span></div>
        </div>
      </header>

      {error ? <p className="fp-error"><AlertCircle size={15} /> {error}</p> : null}

      <div className="afp-queue">
        <div className="afp-queue-head">Photo approval queue</div>
        {loading ? (
          <p className="fp-empty-title" style={{ padding: "20px 0" }}>Loading submissions…</p>
        ) : queue.length === 0 ? (
          <div className="afp-empty">
            <div className="fp-empty-title">Queue is empty.</div>
            <p>Field photos submitted by staff from the Flora &amp; Fauna Profiles area will arrive here for approval.</p>
          </div>
        ) : (
          <div className="afp-list">
            {queue.map((s) => {
              const c = s.status === "verified" ? "#4fb583" : s.status === "rejected" ? "#d4563f" : "#e7c979";
              return (
                <div key={s.id} className="afp-row" style={{ borderLeftColor: c }}>
                  <img src={s.photo_data} alt="Submitted field photo" />
                  <div className="afp-row-main">
                    <div className="afp-row-top">
                      <span className={"fp-status-pill " + s.status}>{s.status === "verified" ? "✓ Verified" : s.status === "rejected" ? "Rejected" : "Pending review"}</span>
                      <span className="afp-row-who">{s.submitted_by_email || "Staff"} · {new Date(s.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}</span>
                    </div>
                    <div className="afp-row-taxon">{s.taxon_name}</div>
                    <div className="afp-row-common">{s.common_name || "No common name recorded"}</div>
                    <div className="afp-row-note">{s.note || "No field note supplied"}</div>
                    {s.reviewed_at && (
                      <div className="afp-row-reviewed">{s.reviewed_by_email || "Reviewer"} · {new Date(s.reviewed_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}{s.review_note ? ` — ${s.review_note}` : ""}</div>
                    )}
                    {reviewingId === s.id && (
                      <div className="afp-reject-form">
                        <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Reason for rejection (shown to the submitter)" />
                        <button className="afp-btn reject-confirm" onClick={() => decide(s.id, "rejected", rejectNote)}>Confirm reject</button>
                        <button className="afp-btn cancel" onClick={() => { setReviewingId(null); setRejectNote(""); }}>Cancel</button>
                      </div>
                    )}
                  </div>
                  {s.status === "pending" && reviewingId !== s.id && (
                    <div className="afp-actions">
                      <button className="afp-btn verify" onClick={() => decide(s.id, "verified")}><CheckCircle2 size={13} /> Verify photo</button>
                      <button className="afp-btn reject" onClick={() => setReviewingId(s.id)}>Reject</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="afp-browse">
        <div className="fp-section-label">Reference library — quick lookup</div>
        <div className="fp-search" style={{ marginBottom: 12 }}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scientific name, common name or family" />
        </div>
        {nq && browseList.length === 0 && <p className="fp-empty-title">No matches.</p>}
        {browseList.length > 0 && (
          <div className="afp-browse-list">
            {browseList.map((p) => {
              const c = LISTING_STYLE[p.listing] || LISTING_STYLE.Vulnerable;
              const verified = subs.some((s) => s.taxon_name === p.name && s.status === "verified");
              return (
                <div key={p.name} className="afp-browse-row" style={{ borderLeftColor: c.accent }}>
                  <div>
                    <span className="afp-browse-name">{p.name}</span>
                    <span className="afp-browse-common">{p.common || "No common name recorded"}</span>
                  </div>
                  <div className="afp-browse-tags">
                    <span className="fp-badge" style={{ background: c.bg, color: c.fg }}>{c.short}</span>
                    {verified && <span className="fp-verified">✓ verified</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
