"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Search, AlertCircle, CheckCircle2, Expand, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FLORA_PROFILES } from "../lib/floraData";
import { FAUNA_PROFILES } from "../lib/faunaData";
import { SURVEY_FLORA } from "../lib/surveyFlora";
import { SURVEY_FAUNA } from "../lib/surveyFauna";
import SurveyRequirements from "./SurveyRequirements";
import BioNetWatchlistsPanel from "./BioNetWatchlistsPanel";

const FLORA_LC = {
  "Critically Endangered": { fg: "#a5342a", bg: "rgba(212,86,63,.14)", short: "CE", accent: "#d4563f" },
  "Endangered": { fg: "#a5772b", bg: "rgba(233,201,121,.18)", short: "E", accent: "#c9962a" },
  "Vulnerable": { fg: "#1d6b6b", bg: "rgba(143,214,200,.18)", short: "V", accent: "#5fc9c9" },
};
const FAUNA_LC = {
  "Critically Endangered": { fg: "#a5342a", bg: "rgba(212,86,63,.14)", short: "CE", accent: "#d4563f" },
  "Endangered": { fg: "#a5772b", bg: "rgba(240,163,94,.16)", short: "E", accent: "#e08a4c" },
  "Vulnerable": { fg: "#2a6591", bg: "rgba(143,191,221,.16)", short: "V", accent: "#6fa4c8" },
  "Extinct": { fg: "#6b755f", bg: "rgba(154,164,180,.16)", short: "EX", accent: "#6d7789" },
  "Extinct in the Wild": { fg: "#7d3b5c", bg: "rgba(180,154,212,.16)", short: "EW", accent: "#8b73ad" },
  "Conservation Dependent": { fg: "#1f5a34", bg: "rgba(127,214,196,.16)", short: "CD", accent: "#5fae9e" },
};
function faunaListing(p) { return (p.listing || "").split(" | ")[0]; }

async function responseData(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const fallback = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return { error: fallback || `Request failed (${response.status}).` };
  }
}

export default function AdminSpeciesProfiles({ onToast }) {
  const { session } = useAuth();
  const [kingdom, setKingdom] = useState("flora");
  const [subView, setSubView] = useState("profiles");
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewingId, setReviewingId] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const [preview, setPreview] = useState(null);
  const [q, setQ] = useState("");

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const apiBase = kingdom === "flora" ? "/api/flora-photos" : "/api/fauna-photos";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("GET", apiBase);
      const d = await responseData(res);
      if (!res.ok) throw new Error(d.error || `Couldn't load submissions (${res.status}).`);
      setSubs(d.submissions || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [authFetch, apiBase]);

  useEffect(() => { if (session?.access_token) load(); }, [session, kingdom, load]);

  useEffect(() => {
    if (!preview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreview(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [preview]);

  const decide = async (id, status, review_note) => {
    try {
      const res = await authFetch("PATCH", `${apiBase}/${id}`, { status, review_note: review_note || "" });
      const d = await responseData(res);
      if (!res.ok) throw new Error(d.error || `Couldn't update (${res.status}).`);
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

  const PROFILES = kingdom === "flora" ? FLORA_PROFILES : FAUNA_PROFILES;
  const LC = kingdom === "flora" ? FLORA_LC : FAUNA_LC;
  const nq = q.trim().toLowerCase();
  const browseList = useMemo(() => {
    if (!nq) return [];
    return PROFILES.filter((p) => (p.name + " " + (p.common || "")).toLowerCase().includes(nq)).slice(0, 30);
  }, [nq, PROFILES]);

  const survey = kingdom === "flora" ? SURVEY_FLORA : SURVEY_FAUNA;

  if (subView === "survey") {
    return <SurveyRequirements initialKingdom={kingdom} onBack={() => setSubView("profiles")} />;
  }
  if (subView === "bionet") {
    return <BioNetWatchlistsPanel onBack={() => setSubView("profiles")} />;
  }

  return (
    <div className="afp admin-species-profiles">
      <header className="fp-hero">
        <span>Ecology Consulting · {kingdom === "flora" ? "Flora" : "Fauna"} expert</span>
        <h1>Species Profiles &amp; Survey Requirements</h1>
        <p>Field photos awaiting your verification. Only verified photos are published to the profile and marked with a green tick.</p>
        <div className="fp-hero-stats">
          <div><strong className="fp-stat-gold">{pendingCount}</strong><span>Pending</span></div>
          <div><strong style={{ color: "#4fb583" }}>{verifiedCount}</strong><span>Verified</span></div>
          <div><strong>{PROFILES.length}</strong><span>Profiles in library</span></div>
        </div>
      </header>

      <div className="spk-toggle light">
        <button className={"flora" + (kingdom === "flora" ? " sel" : "")} onClick={() => { setKingdom("flora"); setQ(""); }}>Flora</button>
        <button className={"fauna" + (kingdom === "fauna" ? " sel" : "")} onClick={() => { setKingdom("fauna"); setQ(""); }}>Fauna</button>
        <button className="bionet" onClick={() => setSubView("bionet")}>BioNet watchlists</button>
      </div>

      {error ? <p className="fp-error"><AlertCircle size={15} /> {error}</p> : null}

      <div className="afp-queue">
        <div className="afp-queue-head">{kingdom === "flora" ? "Flora" : "Fauna"} photo approval queue</div>
        {loading ? (
          <p className="fp-empty-title" style={{ padding: "20px 0" }}>Loading submissions…</p>
        ) : queue.length === 0 ? (
          <div className="afp-empty">
            <div className="fp-empty-title">Queue is empty.</div>
            <p>Field photos submitted by staff from the Species Profiles area will arrive here for approval.</p>
          </div>
        ) : (
          <div className="afp-list">
            {queue.map((s) => {
              const c = s.status === "verified" ? "#4fb583" : s.status === "rejected" ? "#d4563f" : "#e7c979";
              return (
                <div key={s.id} className="afp-row" style={{ borderLeftColor: c }}>
                  <button
                    type="button"
                    className="afp-photo-button"
                    onClick={() => setPreview(s)}
                    aria-label={`View full-screen photo of ${s.taxon_name}`}
                    title="Open full-screen photo"
                  >
                    <img src={s.photo_data} alt={`Submitted field photo of ${s.taxon_name}`} />
                    <span className="afp-photo-expand"><Expand size={14} /></span>
                  </button>
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

      {preview ? (
        <div
          className="afp-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="afp-lightbox-title"
          onMouseDown={() => setPreview(null)}
        >
          <div className="afp-lightbox-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header className="afp-lightbox-head">
              <div>
                <span>Expert review · full-screen evidence</span>
                <h2 id="afp-lightbox-title">{preview.taxon_name}</h2>
                <p>{preview.common_name || "No common name recorded"} · {preview.submitted_by_email || "Staff"}</p>
              </div>
              <button type="button" className="afp-lightbox-close" onClick={() => setPreview(null)} aria-label="Close full-screen photo">
                <X size={18} />
              </button>
            </header>
            <div className="afp-lightbox-image-wrap">
              <img src={preview.photo_data} alt={`Full-screen field photo of ${preview.taxon_name}`} />
            </div>
            <div className="afp-lightbox-meta">
              <span>{preview.note || "No field note supplied"}</span>
              <small>Press Escape or select outside the image to close.</small>
            </div>
          </div>
        </div>
      ) : null}

      <div className="afp-browse">
        <div className="fp-section-label" style={{ color: "#1f5a34" }}>Reference library — quick lookup</div>
        <div className="fp-search" style={{ marginBottom: 12, background: "#f5f2ea", border: "1px solid #dce3d5", color: "#7a877d" }}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scientific name or common name" style={{ color: "#23301f" }} />
        </div>
        {nq && browseList.length === 0 && <p className="fp-empty-title">No matches.</p>}
        {browseList.length > 0 && (
          <div className="afp-browse-list">
            {browseList.map((p) => {
              const pl = kingdom === "flora" ? p.listing : faunaListing(p);
              const c = LC[pl] || LC.Vulnerable;
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

      <div className="afp-browse">
        <div className="fp-section-label" style={{ color: "#1f5a34" }}>Targeted survey standards — {kingdom}</div>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#5c6b58", lineHeight: 1.55 }}>{survey.readme["Purpose"]}</p>
        <button className="afp-btn verify" onClick={() => setSubView("survey")}>Open survey requirements →</button>
      </div>
    </div>
  );
}
