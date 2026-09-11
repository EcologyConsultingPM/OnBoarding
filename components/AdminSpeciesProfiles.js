"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Search, AlertCircle, CheckCircle2, Expand, X, Pencil, Lock, Unlock, Save, Trash2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FLORA_PROFILES } from "../lib/floraData";
import { FAUNA_PROFILES } from "../lib/faunaData";
import { SURVEY_FLORA } from "../lib/surveyFlora";
import { SURVEY_FAUNA } from "../lib/surveyFauna";
import { mergeOverrides } from "../lib/mergeSpeciesOverrides";
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
  const [overrides, setOverrides] = useState([]);
  const [editing, setEditing] = useState(null);   // profile being edited (merged copy)
  const [draft, setDraft] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session?.access_token]);

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

  const loadOverrides = useCallback(async () => {
    try {
      const res = await authFetch("GET", `/api/species-overrides?kingdom=${kingdom}`);
      const d = await res.json();
      if (res.ok) setOverrides(d.overrides || []);
    } catch { /* non-fatal */ }
  }, [authFetch, kingdom]);
  useEffect(() => { if (session?.access_token) loadOverrides(); }, [session, kingdom, loadOverrides]);

  const overrideFor = (name) => overrides.find((o) => o.taxon_name === name) || null;

  const openEdit = (profile) => {
    setEditing(profile);
    setDraft({
      name: profile.name || "",
      common: profile.common || "",
      listing: profile.listing || "",
      family: profile.family || "",
      form: profile.form || "",
      habitat: profile.habitat || "",
      diag: profile.diag || "",
      hidden: new Set((overrideFor(profile.name)?.hidden_photos || []).map(Number)),
    });
  };
  const togglePhoto = (n) => setDraft((d) => {
    const hidden = new Set(d.hidden); hidden.has(n) ? hidden.delete(n) : hidden.add(n);
    return { ...d, hidden };
  });
  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true); setError("");
    try {
      const fields = {
        name: draft.name, common: draft.common, listing: draft.listing,
        family: draft.family, form: draft.form, habitat: draft.habitat, diag: draft.diag,
      };
      const res = await authFetch("POST", "/api/species-overrides", {
        kingdom, taxon_name: editing.name, fields, hidden_photos: Array.from(draft.hidden || []),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't save the profile edit.");
      setEditing(null); await loadOverrides();
      onToast && onToast("Profile updated.");
    } catch (e) { setError(e.message); } finally { setSavingEdit(false); }
  };
  const toggleLock = async (profile, lock) => {
    setError("");
    try {
      const res = await authFetch("PATCH", "/api/species-overrides", { kingdom, taxon_name: profile.name, locked: lock });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't change the lock state.");
      await loadOverrides();
      onToast && onToast(lock ? "Profile locked (published)." : "Profile unlocked for editing.");
    } catch (e) { setError(e.message); }
  };

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

  const PROFILES = useMemo(
    () => mergeOverrides(kingdom === "flora" ? FLORA_PROFILES : FAUNA_PROFILES, overrides),
    [kingdom, overrides],
  );
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
              const locked = p._locked === true;
              return (
                <div key={p.name} className="afp-browse-row" style={{ borderLeftColor: c.accent }}>
                  <div>
                    <span className="afp-browse-name">{p.name}</span>
                    <span className="afp-browse-common">{p.common || "No common name recorded"}</span>
                  </div>
                  <div className="afp-browse-tags">
                    <span className="fp-badge" style={{ background: c.bg, color: c.fg }}>{c.short}</span>
                    {p._edited && !locked && <span className="afp-edited-tag">edited</span>}
                    {locked && <span className="afp-locked-tag"><Lock size={10} /> published</span>}
                    {verified && <span className="fp-verified">✓ verified</span>}
                    <button className="afp-edit-btn" onClick={() => openEdit(p)} disabled={locked} title={locked ? "Unlock to edit" : "Edit profile"}><Pencil size={13} /></button>
                    <button className={`afp-lock-btn ${locked ? "locked" : ""}`} onClick={() => toggleLock(p, !locked)} title={locked ? "Unlock (allow edits)" : "Lock (publish / protect)"}>{locked ? <Unlock size={13} /> : <Lock size={13} />}</button>
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

      {editing ? (
        <div className="spe-modal-bg" onMouseDown={() => setEditing(null)}>
          <div className="spe-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="spe-modal-head">
              <div>
                <span className="spe-kicker">Edit species profile · {kingdom}</span>
                <h2>{editing.name}</h2>
              </div>
              <button className="spe-close" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            </div>
            {error ? <p className="spe-error"><AlertCircle size={14} /> {error}</p> : null}
            <div className="spe-grid">
              <label>Scientific name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label>Common name<input value={draft.common} onChange={(e) => setDraft({ ...draft, common: e.target.value })} /></label>
              <label>Listing status<input value={draft.listing} onChange={(e) => setDraft({ ...draft, listing: e.target.value })} placeholder="e.g. Endangered" /></label>
              <label>{kingdom === "flora" ? "Family" : "Group / family"}<input value={draft.family} onChange={(e) => setDraft({ ...draft, family: e.target.value })} /></label>
              <label>Form<input value={draft.form} onChange={(e) => setDraft({ ...draft, form: e.target.value })} /></label>
              <label className="spe-wide">Habitat<textarea rows={2} value={draft.habitat} onChange={(e) => setDraft({ ...draft, habitat: e.target.value })} /></label>
              <label className="spe-wide">Diagnostic / description<textarea rows={4} value={draft.diag} onChange={(e) => setDraft({ ...draft, diag: e.target.value })} /></label>
            </div>

            {Array.isArray(editing.atts) && editing.atts.length ? (
              <div className="spe-photos">
                <span className="spe-photos-label">Photos — tick to delete from this profile</span>
                <div className="spe-photo-list">
                  {editing.atts.map((a) => {
                    const hidden = draft.hidden?.has(Number(a.n));
                    return (
                      <label key={a.n} className={`spe-photo ${hidden ? "removing" : ""}`}>
                        <input type="checkbox" checked={!!hidden} onChange={() => togglePhoto(Number(a.n))} />
                        <span className="spe-photo-meta"><strong>Photo {a.n}</strong><small>{a.creator || "Unknown"} · {a.provider || ""}</small></span>
                        {hidden ? <Trash2 size={13} className="spe-photo-x" /> : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="spe-modal-actions">
              <button className="spe-save" onClick={saveEdit} disabled={savingEdit}><Save size={14} /> {savingEdit ? "Saving…" : "Save changes"}</button>
              <button className="spe-cancel" onClick={() => setEditing(null)}>Cancel</button>
              <span className="spe-lock-hint">Lock the profile from the list to publish and protect it from further edits.</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
