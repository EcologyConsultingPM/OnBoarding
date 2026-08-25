"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Search, X, ChevronLeft, ChevronRight, Camera, AlertCircle, CheckCircle2,
  ExternalLink, ShieldAlert,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FLORA_PROFILES } from "../lib/floraData";

const LISTING_STYLE = {
  "Critically Endangered": { fg: "#ff9b86", bg: "rgba(212,86,63,.16)", short: "CE", accent: "#d4563f" },
  "Endangered": { fg: "#e7c979", bg: "rgba(233,201,121,.16)", short: "E", accent: "#e7c979" },
  "Vulnerable": { fg: "#8fd6c8", bg: "rgba(143,214,200,.14)", short: "V", accent: "#5fc9c9" },
};
const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const PAGE = 24;

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function FloraProfiles({ onToast }) {
  const { session } = useAuth();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 150);
  const [sort, setSort] = useState("sci"); // sci | com
  const [letter, setLetter] = useState("All");
  const [listing, setListing] = useState("All");
  const [family, setFamily] = useState("All");
  const [limit, setLimit] = useState(PAGE);
  const [openIdx, setOpenIdx] = useState(-1);

  const [mySubs, setMySubs] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const loadMine = useCallback(async () => {
    try {
      const res = await authFetch("GET", "/api/flora-photos");
      const d = await res.json();
      if (res.ok) setMySubs(d.submissions || []);
    } catch { /* non-fatal */ }
  }, [authFetch]);

  useEffect(() => { if (session?.access_token) loadMine(); }, [session, loadMine]);

  const families = useMemo(() => {
    const counts = {};
    FLORA_PROFILES.forEach((p) => { if (p.family) counts[p.family] = (counts[p.family] || 0) + 1; });
    return Object.keys(counts).sort().map((f) => ({ value: f, label: `${f} (${counts[f]})` }));
  }, []);

  const filtered = useMemo(() => {
    const n = dq.trim().toLowerCase();
    let list = FLORA_PROFILES.filter((p) => {
      if (listing !== "All" && p.listing !== listing) return false;
      if (family !== "All" && p.family !== family) return false;
      if (letter !== "All") {
        const key = sort === "com" ? (p.common || "") : (p.name || "");
        if ((key.charAt(0) || "").toUpperCase() !== letter) return false;
      }
      if (!n) return true;
      return (p.name + " " + (p.common || "") + " " + (p.family || "") + " " + (p.form || "")).toLowerCase().includes(n);
    });
    list = list.slice().sort((a, b) => {
      if (sort === "com") {
        const ac = a.common || "\uffff", bc = b.common || "\uffff";
        return ac.localeCompare(bc) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [dq, listing, family, letter, sort]);

  const shown = filtered.slice(0, limit);
  const availableLetters = useMemo(() => {
    const base = FLORA_PROFILES.filter((p) => {
      if (listing !== "All" && p.listing !== listing) return false;
      if (family !== "All" && p.family !== family) return false;
      return true;
    });
    const set = new Set(base.map((p) => ((sort === "com" ? p.common : p.name) || "").charAt(0).toUpperCase()));
    return set;
  }, [listing, family, sort]);

  const resetPaging = () => { setLimit(PAGE); setOpenIdx(-1); };
  const cur = openIdx >= 0 ? shown[openIdx] : null;
  const curSubs = cur ? mySubs.filter((s) => s.taxon_name === cur.name) : [];
  const curVerified = curSubs.some((s) => s.status === "verified");

  const step = (d) => {
    if (!shown.length) return;
    setOpenIdx((i) => (i + d + shown.length) % shown.length);
  };

  const attach = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !cur) return;
    setBusy(true); setError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const max = 1100;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL("image/jpeg", 0.78);
        try {
          const res = await authFetch("POST", "/api/flora-photos", {
            taxon_name: cur.name, common_name: cur.common || "", photo_data: dataUrl, note: note.trim(),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "Couldn't submit photo");
          setNote("");
          await loadMine();
          onToast && onToast("Photo submitted — awaiting Flora expert review.");
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      };
      img.onerror = () => { setBusy(false); setError("Couldn't read that image"); };
      img.src = ev.target.result;
    };
    reader.onerror = () => { setBusy(false); setError("Couldn't read that file"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeSub = async (id) => {
    if (!window.confirm("Remove this submitted photo?")) return;
    try {
      const res = await authFetch("DELETE", `/api/flora-photos/${id}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      await loadMine();
    } catch (err) { setError(err.message); }
  };

  const ceCount = useMemo(() => FLORA_PROFILES.filter((p) => p.listing === "Critically Endangered").length, []);
  const famCount = useMemo(() => new Set(FLORA_PROFILES.map((p) => p.family).filter(Boolean)).size, []);
  const photoNeeded = useMemo(() => FLORA_PROFILES.filter((p) => (p.views || 0) < 3).length, []);

  return (
    <div className="fp">
      <header className="fp-hero">
        <span>NSW &amp; ACT · Controlled flora taxa</span>
        <h1>Flora Profile Guide</h1>
        <p>Search the controlled profile library, compare against real licensed material, record defensible evidence — then hand it to a Senior Ecologist.</p>
        <div className="fp-hero-stats">
          <div><strong>{FLORA_PROFILES.length}</strong><span>Profiles loaded</span></div>
          <div><strong className="fp-stat-ce">{ceCount}</strong><span>Critically endangered</span></div>
          <div><strong className="fp-stat-teal">{famCount}</strong><span>Families</span></div>
          <div><strong className="fp-stat-gold">{photoNeeded}</strong><span>Field photo needed</span></div>
        </div>
      </header>

      <div className="fp-boundary">
        <ShieldAlert size={16} />
        <div>
          <strong>This guide helps you observe and record. It does not make the call.</strong>
          <p>These profiles are learning and source-navigation material. They do not establish a final plant determination, site occurrence, absence conclusion, survey adequacy, collection permission, BAM assessment or statutory outcome. Recheck the current official profile, apply project controls, then escalate.</p>
        </div>
      </div>

      {error ? <p className="fp-error"><AlertCircle size={15} /> {error}</p> : null}

      <div className="fp-controls">
        <div className="fp-search">
          <Search size={15} />
          <input value={q} onChange={(e) => { setQ(e.target.value); resetPaging(); }} placeholder="Search scientific name, common name or family — try wattle, Zieria, Orchidaceae" />
        </div>

        <div className="fp-row">
          <span className="fp-row-label">Sort by</span>
          <div className="fp-chips">
            {[["sci", "Scientific name"], ["com", "Common name"]].map(([k, label]) => (
              <button key={k} className={"fp-chip" + (sort === k ? " sel" : "")} onClick={() => { setSort(k); setLetter("All"); resetPaging(); }}>{label}</button>
            ))}
          </div>
        </div>

        <div className="fp-row">
          <span className="fp-row-label">{sort === "com" ? "Common A–Z" : "Genus A–Z"}</span>
          <div className="fp-az">
            <button className={"fp-az-btn" + (letter === "All" ? " sel" : "")} onClick={() => { setLetter("All"); resetPaging(); }}>·</button>
            {AZ.map((ch) => {
              const has = availableLetters.has(ch);
              return (
                <button key={ch} disabled={!has} className={"fp-az-btn" + (letter === ch ? " sel" : "") + (!has ? " disabled" : "")}
                  onClick={() => { if (has) { setLetter(ch); resetPaging(); } }}>{ch}</button>
              );
            })}
          </div>
        </div>

        <div className="fp-row">
          <span className="fp-row-label">Listing</span>
          <div className="fp-chips">
            {["All", "Critically Endangered", "Endangered", "Vulnerable"].map((l) => (
              <button key={l} className={"fp-chip" + (listing === l ? " sel" : "")} onClick={() => { setListing(l); resetPaging(); }}>{l}</button>
            ))}
          </div>
        </div>

        <div className="fp-row">
          <span className="fp-row-label">Family</span>
          <select value={family} onChange={(e) => { setFamily(e.target.value); resetPaging(); }} className="fp-select">
            <option value="All">All families ({families.length})</option>
            {families.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <div className="fp-shown-label">{filtered.length === FLORA_PROFILES.length ? `${FLORA_PROFILES.length} profiles` : `${filtered.length} of ${FLORA_PROFILES.length} profiles`}</div>

      {filtered.length === 0 ? (
        <div className="fp-empty">
          <div className="fp-empty-title">Nothing matches that.</div>
          <p>Try a shorter search term, or clear the filters.</p>
          <button className="fp-clear" onClick={() => { setQ(""); setListing("All"); setFamily("All"); setLetter("All"); setSort("sci"); resetPaging(); }}>Clear all filters</button>
        </div>
      ) : (
        <div className="fp-cards">
          {shown.map((p, i) => {
            const c = LISTING_STYLE[p.listing] || LISTING_STYLE.Vulnerable;
            const v = p.views || 0;
            const byCommon = sort === "com" && p.common;
            const verified = mySubs.some((s) => s.taxon_name === p.name && s.status === "verified");
            return (
              <button key={p.name} className="fp-card" style={{ borderLeftColor: c.accent }} onClick={() => setOpenIdx(i)}>
                <div className="fp-card-top">
                  <div className="fp-card-names">
                    <div className="fp-card-primary" style={{ fontStyle: byCommon ? "normal" : "italic" }}>{byCommon ? p.common : p.name}</div>
                    <div className="fp-card-secondary" style={{ fontStyle: byCommon ? "italic" : "normal" }}>{byCommon ? p.name : (p.common || "No common name recorded")}</div>
                  </div>
                  <div className="fp-card-badges">
                    <span className="fp-badge" style={{ background: c.bg, color: c.fg }}>{c.short}</span>
                    {verified && <span className="fp-verified">✓ verified</span>}
                  </div>
                </div>
                <div className="fp-card-tags">
                  <span>{p.jur}</span><span>{p.form || "—"}</span><span>{p.family || "—"}</span>
                </div>
                <div className="fp-card-foot">
                  <div className="fp-dots">
                    {[0, 1, 2].map((n) => <span key={n} className={"fp-dot" + (n < v ? " on" : "")} />)}
                  </div>
                  <span className="fp-viewlabel">{v >= 3 ? "3 views" : v > 0 ? `${v} of 3 · photo needed` : "field photo needed"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {filtered.length > limit && (
        <button className="fp-more" onClick={() => setLimit((l) => l + 36)}>Show {Math.min(36, filtered.length - limit)} more</button>
      )}

      <div className="fp-complete">
        <div className="fp-complete-label">✓ Library complete</div>
        <p>All six parts are loaded — <strong>{FLORA_PROFILES.length} profiles</strong> across {famCount} families, drawn from the controlled NSW / ACT register. {ceCount} critically endangered. Listing categories are current-list training references only; recheck official sources and project controls before project use.</p>
      </div>

      {cur && (
        <div className="fp-drawer-bg" onClick={() => setOpenIdx(-1)}>
          <div className="fp-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="fp-drawer-head">
              <div className="fp-drawer-badges">
                <span className="fp-badge" style={{ background: (LISTING_STYLE[cur.listing] || LISTING_STYLE.Vulnerable).bg, color: (LISTING_STYLE[cur.listing] || LISTING_STYLE.Vulnerable).fg }}>{cur.listing}</span>
                <span className="fp-badge-neutral">{cur.jur}</span>
              </div>
              <button className="fp-drawer-close" onClick={() => setOpenIdx(-1)}><X size={15} /></button>
            </div>
            <div className="fp-drawer-name">{cur.name}</div>
            <div className="fp-drawer-common">{cur.common || "No common name recorded"}</div>

            <div className="fp-drawer-body">
              <div className="fp-facts">
                <div><span>Family</span><strong>{cur.family || "—"}</strong></div>
                <div><span>Growth form</span><strong>{cur.form || "—"}</strong></div>
              </div>

              <div className={"fp-photo-note" + ((cur.views || 0) >= 3 ? " full" : "")}>
                <div className="fp-photo-note-title">{(cur.views || 0) >= 3 ? "Three licensed views available" : "Controlled field photo required"}</div>
                <p>{(cur.views || 0) >= 3
                  ? "Compare overall habit and habitat, foliage or leaf characters, and a flower, fruit or other diagnostic structure where visibly supported. Do not label a view as a life stage or organ without confirming the evidence."
                  : "Fewer than three licensed views exist for this taxon. Do not substitute an unlicensed image. Under project controls, obtain a geotagged photo of the whole plant and habitat, the foliage, or a reproductive structure — whichever diagnostic evidence is missing."}</p>
              </div>

              <div className="fp-photos">
                <div className="fp-photos-head">
                  <span>Your field photos</span>
                  {curVerified && <span className="fp-verified">✓ Photo verified</span>}
                </div>
                {curSubs.length > 0 && (
                  <div className="fp-photo-list">
                    {curSubs.map((s) => (
                      <div key={s.id} className={"fp-photo-row " + s.status}>
                        <img src={s.photo_data} alt="Field photo submitted" />
                        <div className="fp-photo-meta">
                          <div className="fp-photo-status">
                            <span className={"fp-status-pill " + s.status}>{s.status === "verified" ? "✓ Verified" : s.status === "rejected" ? "Rejected" : "Pending review"}</span>
                            <span className="fp-photo-when">{new Date(s.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</span>
                          </div>
                          <div className="fp-photo-detail">{s.review_note || s.note || "Awaiting Flora expert approval"}</div>
                        </div>
                        {s.status === "pending" && <button className="fp-photo-remove" onClick={() => removeSub(s.id)}><X size={13} /></button>}
                      </div>
                    ))}
                  </div>
                )}
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Field note — what the photo shows, plus date and location" className="fp-note-input" />
                <label className={"fp-upload" + (busy ? " busy" : "")}>
                  <Camera size={15} />
                  <span>{busy ? "Processing…" : "＋ Attach a field photo"}</span>
                  <input type="file" accept="image/*" onChange={attach} disabled={busy} />
                </label>
                <p className="fp-upload-note">Photos are submitted to the <strong>Flora expert</strong> in the admin portal for approval. Nothing is published to the profile until it is verified — approved photos carry a green tick.</p>
              </div>

              {cur.atts && cur.atts.length > 0 && (
                <div>
                  <div className="fp-section-label">Licensed reference views ({cur.atts.length})</div>
                  <div className="fp-atts">
                    {cur.atts.map((a) => (
                      <a key={a.n} href={a.url || cur.source || "#"} target="_blank" rel="noreferrer" className="fp-att">
                        <span className="fp-att-n">{a.n}</span>
                        <div className="fp-att-body">
                          <div className="fp-att-creator">{a.creator || a.provider || "Unattributed"}</div>
                          <div className="fp-att-meta">{[a.provider, (a.licence || "").replace(/^https?:\/\/(www\.)?creativecommons\.org\/licenses\//, "CC ").replace(/\/$/, "").toUpperCase()].filter(Boolean).join(" · ")}</div>
                        </div>
                        <ExternalLink size={13} />
                      </a>
                    ))}
                  </div>
                  <p className="fp-upload-note">Photographs stay with their rights holders — open the source to view each image with its licence and caption intact.</p>
                </div>
              )}

              <div>
                <div className="fp-section-label">Diagnostic features</div>
                <p className="fp-longtext">{cur.diag}</p>
              </div>

              <div>
                <div className="fp-section-label">Habitat &amp; distribution context</div>
                <p className="fp-longtext">{cur.habitat}</p>
              </div>

              <div className="fp-collect">
                <div className="fp-collect-label">Collect this evidence</div>
                <p>Record a geotagged overview and close diagnostic photographs. Map the observation and the habitat you searched. Record plant count or extent, growth stage, associated species and disturbance. Preserve uncertainty in your field notes — do not resolve it on the spot. <strong>Do not collect material</strong> without the required approvals and instruction.</p>
              </div>

              <div className="fp-escalate">
                <div className="fp-escalate-label">Escalate here</div>
                <p>Escalate a suspected occurrence, uncertain identification, potential impact, survey-timing limitation or statutory question to the Senior Ecologist or project manager. Do not determine presence, significance, avoidance requirements, licensing or approval outcomes independently.</p>
              </div>

              {cur.source && (
                <a href={cur.source} target="_blank" rel="noreferrer" className="fp-source">
                  <div><div className="fp-source-title">Open the current official profile</div><div className="fp-source-sub">Always check the live source before you rely on anything here</div></div>
                  <ExternalLink size={15} />
                </a>
              )}

              <div className="fp-nav">
                <button onClick={() => step(-1)}><ChevronLeft size={14} /> Previous</button>
                <button onClick={() => step(1)}>Next <ChevronRight size={14} /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
