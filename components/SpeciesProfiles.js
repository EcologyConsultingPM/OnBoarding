"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Search, X, ChevronLeft, ChevronRight, Camera, AlertCircle, ExternalLink, ShieldAlert,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FLORA_PROFILES } from "../lib/floraData";
import { FAUNA_PROFILES } from "../lib/faunaData";
import { SURVEY_FLORA } from "../lib/surveyFlora";
import { SURVEY_FAUNA } from "../lib/surveyFauna";
import SurveyRequirements from "./SurveyRequirements";
import WorkspaceNav from "./WorkspaceNav";

const FLORA_LC = {
  "Critically Endangered": { fg: "#ff9b86", bg: "rgba(212,86,63,.16)", short: "CE", accent: "#d4563f" },
  "Endangered": { fg: "#e7c979", bg: "rgba(233,201,121,.16)", short: "E", accent: "#e7c979" },
  "Vulnerable": { fg: "#8fd6c8", bg: "rgba(143,214,200,.14)", short: "V", accent: "#5fc9c9" },
};
const FAUNA_LC = {
  "Critically Endangered": { fg: "#ff9b86", bg: "rgba(212,86,63,.18)", short: "CE", accent: "#d4563f" },
  "Endangered": { fg: "#f0a35e", bg: "rgba(240,163,94,.16)", short: "E", accent: "#e08a4c" },
  "Vulnerable": { fg: "#8fbfdd", bg: "rgba(143,191,221,.14)", short: "V", accent: "#6fa4c8" },
  "Extinct": { fg: "#9aa4b4", bg: "rgba(154,164,180,.14)", short: "EX", accent: "#6d7789" },
  "Extinct in the Wild": { fg: "#b49ad4", bg: "rgba(180,154,212,.15)", short: "EW", accent: "#8b73ad" },
  "Conservation Dependent": { fg: "#7fd6c4", bg: "rgba(127,214,196,.14)", short: "CD", accent: "#5fae9e" },
};
function listingValues(profile) {
  return String(profile?.listing || "")
    .split(" | ")
    .map((value) => value.trim())
    .filter(Boolean);
}
function faunaListing(p) { return listingValues(p)[0] || ""; }
function faunaStream(p) { return (p.stream || "").split(" | ")[0]; }
function jurisdictionFlags(profile) {
  const jurisdiction = String(profile?.jur || "");
  return {
    epbc: /Commonwealth/i.test(jurisdiction),
    nsw: /NSW/i.test(jurisdiction),
    act: /ACT/i.test(jurisdiction),
  };
}
function legislationBadges(profile) {
  const flags = jurisdictionFlags(profile);
  const listings = listingValues(profile).join(" / ") || "Threatened";
  const badges = [];
  if (flags.epbc) badges.push({ key: "epbc", label: `EPBC · ${listings}`, tone: "epbc" });
  if (flags.nsw) badges.push({ key: "bc", label: `NSW BC Act · ${listings}`, tone: "bc" });
  if (flags.act) badges.push({ key: "act", label: `ACT · ${listings}`, tone: "act" });
  return badges;
}
function matchesLegislation(profile, filter) {
  const flags = jurisdictionFlags(profile);
  if (filter === "epbc") return flags.epbc;
  if (filter === "nsw") return flags.nsw;
  if (filter === "both") return flags.epbc && flags.nsw;
  if (filter === "act") return flags.act;
  return true;
}

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const PAGE = 24;

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* ---------------- Survey-standards link card (shared markup, kingdom-tinted) --------------- */
function SurveyLinkCard({ kingdom, onOpen }) {
  const gold = kingdom === "flora" ? "#e7c979" : "#f0a35e";
  const bg = kingdom === "flora" ? "#0d2016" : "#141c28";
  const border = kingdom === "flora" ? "rgba(233,201,121,.28)" : "rgba(240,163,94,.28)";
  const data = kingdom === "flora" ? SURVEY_FLORA : SURVEY_FAUNA;
  const count = data.rows.length;
  return (
    <div>
      <div className="svy-link-label">
        <span style={{ color: gold }}>Targeted survey standards — {kingdom}</span>
        <div className="rule" />
        <span className="date">NSW &amp; ACT · 2026</span>
      </div>
      <button className="svy-link-card" style={{ background: bg, borderColor: border }} onClick={onOpen}>
        <div className="svy-link-top" style={{ background: kingdom === "flora" ? "rgba(233,201,121,.07)" : "rgba(240,163,94,.07)" }}>
          <div className="svy-link-title">
            <div>Species-specific survey time and conditions <span className="arrow" style={{ color: gold }}>→</span></div>
            <div className="svy-link-pills">
              <span className="svy-link-pill" style={{ background: kingdom === "flora" ? "rgba(233,201,121,.18)" : "rgba(240,163,94,.18)", color: gold }}>Open sub-domain</span>
              <span className="svy-link-pill" style={{ background: "rgba(143,191,221,.14)", color: "#8fbfdd" }}>+ Calendar</span>
            </div>
          </div>
          <p className="svy-link-desc">{data.readme["Purpose"]}</p>
        </div>
        <div className="svy-link-stats">
          <div className="svy-link-stat"><strong>{count}</strong><span>{kingdom === "flora" ? "Species with specific requirements" : "Group-level benchmarks"}</span></div>
          <div className="svy-link-stat"><strong>{data.act.length}</strong><span>ACT-specific controls</span></div>
          <div className="svy-link-stat"><strong>{data.planner.length}</strong><span>Planning checklist steps</span></div>
        </div>
      </button>
    </div>
  );
}

export default function SpeciesProfiles({ onToast, onHome }) {
  const { session } = useAuth();
  const [kingdom, setKingdom] = useState("flora");
  const [subView, setSubView] = useState("profiles"); // profiles | survey

  const [q, setQ] = useState("");
  const dq = useDebounced(q, 150);
  const [sort, setSort] = useState("sci");
  const [letter, setLetter] = useState("All");
  const [listing, setListing] = useState("All");
  const [legislation, setLegislation] = useState("all");
  const [group, setGroup] = useState("All"); // family (flora) or stream (fauna)
  const [limit, setLimit] = useState(PAGE);
  const [openIdx, setOpenIdx] = useState(-1);

  const [subs, setSubs] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const apiBase = kingdom === "flora" ? "/api/flora-photos" : "/api/fauna-photos";

  const loadSubs = useCallback(async () => {
    try {
      const res = await authFetch("GET", apiBase);
      const d = await res.json();
      if (res.ok) setSubs(d.submissions || []);
    } catch { /* non-fatal */ }
  }, [authFetch, apiBase]);

  useEffect(() => { if (session?.access_token) loadSubs(); }, [session, kingdom, loadSubs]);
  useEffect(() => { setQ(""); setLetter("All"); setListing("All"); setLegislation("all"); setGroup("All"); setLimit(PAGE); setOpenIdx(-1); }, [kingdom]);

  const PROFILES = kingdom === "flora" ? FLORA_PROFILES : FAUNA_PROFILES;
  const LC = kingdom === "flora" ? FLORA_LC : FAUNA_LC;
  const px = kingdom === "flora" ? "fp" : "fn";

  const groups = useMemo(() => {
    const counts = {};
    PROFILES.forEach((p) => {
      const key = kingdom === "flora" ? p.family : faunaStream(p);
      if (key) counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(counts).sort().map((f) => ({ value: f, label: `${f} (${counts[f]})` }));
  }, [PROFILES, kingdom]);

  const filtered = useMemo(() => {
    const n = dq.trim().toLowerCase();
    let list = PROFILES.filter((p) => {
      const pl = listingValues(p);
      const pg = kingdom === "flora" ? p.family : faunaStream(p);
      if (listing !== "All" && !pl.includes(listing)) return false;
      if (!matchesLegislation(p, legislation)) return false;
      if (group !== "All" && pg !== group) return false;
      if (letter !== "All") {
        const key = sort === "com" ? (p.common || "") : (p.name || "");
        if ((key.charAt(0) || "").toUpperCase() !== letter) return false;
      }
      if (!n) return true;
      return (p.name + " " + (p.common || "") + " " + pg).toLowerCase().includes(n);
    });
    list = list.slice().sort((a, b) => {
      if (sort === "com") {
        const ac = a.common || "\uffff", bc = b.common || "\uffff";
        return ac.localeCompare(bc) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [PROFILES, dq, listing, legislation, group, letter, sort, kingdom]);

  const shown = filtered.slice(0, limit);
  const availableLetters = useMemo(() => {
    const base = PROFILES.filter((p) => {
      const pl = listingValues(p);
      const pg = kingdom === "flora" ? p.family : faunaStream(p);
      if (listing !== "All" && !pl.includes(listing)) return false;
      if (!matchesLegislation(p, legislation)) return false;
      if (group !== "All" && pg !== group) return false;
      return true;
    });
    return new Set(base.map((p) => ((sort === "com" ? p.common : p.name) || "").charAt(0).toUpperCase()));
  }, [PROFILES, listing, legislation, group, sort, kingdom]);

  const resetPaging = () => { setLimit(PAGE); setOpenIdx(-1); };
  const cur = openIdx >= 0 ? shown[openIdx] : null;
  const curSubs = cur ? subs.filter((s) => s.taxon_name === cur.name) : [];
  const curVerified = curSubs.some((s) => s.status === "verified");
  const step = (d) => { if (shown.length) setOpenIdx((i) => (i + d + shown.length) % shown.length); };

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
          const res = await authFetch("POST", apiBase, { taxon_name: cur.name, common_name: cur.common || "", photo_data: dataUrl, note: note.trim() });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "Couldn't submit photo");
          setNote("");
          await loadSubs();
          onToast && onToast("Photo submitted — awaiting expert review.");
        } catch (err) { setError(err.message); } finally { setBusy(false); }
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
      const res = await authFetch("DELETE", `${apiBase}/${id}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      await loadSubs();
    } catch (err) { setError(err.message); }
  };

  const ceCount = useMemo(() => PROFILES.filter((p) => (kingdom === "flora" ? p.listing : faunaListing(p)) === "Critically Endangered").length, [PROFILES, kingdom]);
  const groupCount = groups.length;
  const photoNeeded = useMemo(() => PROFILES.filter((p) => (p.views || 0) < 3).length, [PROFILES]);

  if (subView === "survey") {
    return <SurveyRequirements initialKingdom={kingdom} onBack={() => setSubView("profiles")} onHome={onHome} />;
  }

  return (
    <div className={`${px} species-profiles-workspace`}>
      <WorkspaceNav onHome={onHome} onBack={onHome} backLabel="Back to Staff Portal" />
      <header className={px + "-hero"}>
        <span>{kingdom === "flora" ? "NSW & ACT · Controlled flora taxa" : "NSW, ACT & Commonwealth · Controlled fauna taxa"}</span>
        <h1>{kingdom === "flora" ? "Flora Profile Guide" : "Fauna Profile Guide"}</h1>
        <p>Search the controlled profile library, compare against real licensed material, record defensible evidence — then hand it to a {kingdom === "flora" ? "Flora" : "Fauna"} expert.</p>
        <div className={px + "-hero-stats"}>
          <div><strong>{PROFILES.length}</strong><span>Profiles loaded</span></div>
          <div><strong style={{ color: "#ff9b86" }}>{ceCount}</strong><span>Critically endangered</span></div>
          <div><strong style={{ color: "#8fd6c8" }}>{groupCount}</strong><span>{kingdom === "flora" ? "Families" : "Groups"}</span></div>
          <div><strong style={{ color: "#e7c979" }}>{photoNeeded}</strong><span>Field photo needed</span></div>
        </div>
      </header>

      <div className="spk-toggle">
        <button className={"flora" + (kingdom === "flora" ? " sel" : "")} onClick={() => setKingdom("flora")}>Flora</button>
        <button className={"fauna" + (kingdom === "fauna" ? " sel" : "")} onClick={() => setKingdom("fauna")}>Fauna</button>
      </div>

      <div className="fp-boundary">
        <ShieldAlert size={16} />
        <div>
          <strong>This guide helps you observe and record. It does not make the call.</strong>
          <p>These profiles are learning and source-navigation material. They do not establish a final determination, site occurrence, absence conclusion, survey adequacy, collection or handling authority, BAM assessment or statutory outcome. Recheck the current official profile, apply project controls, then escalate.</p>
        </div>
      </div>

      {error ? <p className={px + "-error"}><AlertCircle size={15} /> {error}</p> : null}

      <div className={px + "-controls"}>
        <div className={px + "-search"}>
          <Search size={15} />
          <input value={q} onChange={(e) => { setQ(e.target.value); resetPaging(); }} placeholder={kingdom === "flora" ? "Search scientific name, common name or family" : "Search scientific name, common name or group"} />
        </div>

        <div className={px + "-row"}>
          <span className={px + "-row-label"}>Sort by</span>
          <div className={px + "-chips"}>
            {[["sci", "Scientific name"], ["com", "Common name"]].map(([k, label]) => (
              <button key={k} className={px + "-chip" + (sort === k ? " sel" : "")} onClick={() => { setSort(k); setLetter("All"); resetPaging(); }}>{label}</button>
            ))}
          </div>
        </div>

        <div className={px + "-row"}>
          <span className={px + "-row-label"}>{sort === "com" ? "Common A–Z" : "Genus A–Z"}</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
            <button className={px + "-az-btn" + (letter === "All" ? " sel" : "")} onClick={() => { setLetter("All"); resetPaging(); }}>·</button>
            {AZ.map((ch) => {
              const has = availableLetters.has(ch);
              return (
                <button key={ch} disabled={!has} className={px + "-az-btn" + (letter === ch ? " sel" : "") + (!has ? " disabled" : "")}
                  onClick={() => { if (has) { setLetter(ch); resetPaging(); } }}>{ch}</button>
              );
            })}
          </div>
        </div>

        <div className={px + "-row"}>
          <span className={px + "-row-label"}>Listing</span>
          <div className={px + "-chips"}>
            {["All", ...Object.keys(LC)].map((l) => (
              <button key={l} className={px + "-chip" + (listing === l ? " sel" : "")} onClick={() => { setListing(l); resetPaging(); }}>{l}</button>
            ))}
          </div>
        </div>

        <div className={px + "-row"}>
          <span className={px + "-row-label"}>Listed under</span>
          <div className={px + "-chips spk-legislation-filters"}>
            {[['all', 'All records'], ['epbc', 'Commonwealth · EPBC'], ['nsw', 'NSW · BC Act'], ['both', 'EPBC + BC Act'], ...(kingdom === 'flora' ? [['act', 'ACT']] : [])].map(([value, label]) => (
              <button key={value} className={px + "-chip" + (legislation === value ? " sel" : "")} onClick={() => { setLegislation(value); resetPaging(); }}>{label}</button>
            ))}
          </div>
        </div>

        <div className={px + "-row"}>
          <span className={px + "-row-label"}>{kingdom === "flora" ? "Family" : "Group"}</span>
          <select value={group} onChange={(e) => { setGroup(e.target.value); resetPaging(); }} className={px + "-select"}>
            <option value="All">All {kingdom === "flora" ? "families" : "groups"} ({groups.length})</option>
            {groups.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <div className={px + "-shown-label"}>{filtered.length === PROFILES.length ? `${PROFILES.length} profiles` : `${filtered.length} of ${PROFILES.length} profiles`}</div>

      {filtered.length === 0 ? (
        <div className={px + "-empty"}>
          <div className="fp-empty-title">Nothing matches that.</div>
          <p>Try a shorter search term, or clear the filters.</p>
          <button className="fp-clear" onClick={() => { setQ(""); setListing("All"); setGroup("All"); setLetter("All"); setSort("sci"); resetPaging(); }}>Clear all filters</button>
        </div>
      ) : (
        <div className={px + "-cards"}>
          {shown.map((p, i) => {
            const pl = kingdom === "flora" ? p.listing : faunaListing(p);
            const pg = kingdom === "flora" ? p.family : faunaStream(p);
            const c = LC[pl] || LC.Vulnerable;
            const v = p.views || 0;
            const byCommon = sort === "com" && p.common;
            const verified = subs.some((s) => s.taxon_name === p.name && s.status === "verified");
            return (
              <button key={p.name} className={px + "-card"} style={{ borderLeftColor: c.accent }} onClick={() => setOpenIdx(i)} aria-label={`Open ${p.name}${p.common ? ` (${p.common})` : ""} profile`}>
                <div className={px + "-card-top"}>
                  <div>
                    <div className={px + "-card-primary"} style={{ fontStyle: byCommon ? "normal" : "italic" }}>{byCommon ? p.common : p.name}</div>
                    <div className={px + "-card-secondary"} style={{ fontStyle: byCommon ? "italic" : "normal" }}>{byCommon ? p.name : (p.common || "No common name recorded")}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                    <span className={px + "-badge"} style={{ background: c.bg, color: c.fg }}>{c.short}</span>
                    <div className="spk-listing-badges">
                      {legislationBadges(p).map((badge) => <span key={badge.key} className={`spk-listing-badge ${badge.tone}`}>{badge.label}</span>)}
                    </div>
                    {verified && <span className={px + "-verified"}>✓ verified</span>}
                  </div>
                </div>
                <div className={px + "-card-tags"}>
                  <span>{p.jur}</span><span>{kingdom === "flora" ? (p.form || "—") : (p.cat || "—")}</span><span>{pg || "—"}</span>
                </div>
                <div className={px + "-card-foot"}>
                  <div className={px + "-dots"}>{[0, 1, 2].map((n) => <span key={n} className={px + "-dot" + (n < v ? " on" : "")} />)}</div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: kingdom === "flora" ? "#e7c979" : "#f0a35e" }}>{v >= 3 ? "3 views" : v > 0 ? `${v} of 3 · photo needed` : "field photo needed"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {filtered.length > limit && (
        <button className={px + "-more"} onClick={() => setLimit((l) => l + 36)}>Show {Math.min(36, filtered.length - limit)} more</button>
      )}

      <SurveyLinkCard kingdom={kingdom} onOpen={() => setSubView("survey")} />

      {cur && (
        <div className={px + "-drawer-bg"} onClick={() => setOpenIdx(-1)}>
          <div className={px + "-drawer"} onClick={(e) => e.stopPropagation()}>
            <div className={px + "-drawer-head"}>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <span className={px + "-badge"} style={{ background: (LC[faunaListing(cur)] || LC.Vulnerable).bg, color: (LC[faunaListing(cur)] || LC.Vulnerable).fg }}>{listingValues(cur).join(" / ") || "Threatened"}</span>
                {legislationBadges(cur).map((badge) => <span key={badge.key} className={`spk-listing-badge ${badge.tone}`}>{badge.label}</span>)}
                <span className="fp-badge-neutral">{cur.jur}</span>
              </div>
              <button className={px + "-drawer-close"} onClick={() => setOpenIdx(-1)}><X size={15} /></button>
            </div>
            <div className={px + "-drawer-name"}>{cur.name}</div>
            <div className={px + "-drawer-common"}>{cur.common || "No common name recorded"}</div>

            <div className={px + "-drawer-body"}>
              <div className={px + "-facts"}>
                <div><span>{kingdom === "flora" ? "Family" : "Group"}</span><strong>{kingdom === "flora" ? (cur.family || "—") : (faunaStream(cur) || "—")}</strong></div>
                <div><span>{kingdom === "flora" ? "Growth form" : "Category"}</span><strong>{kingdom === "flora" ? (cur.form || "—") : (cur.cat || "—")}</strong></div>
              </div>

              <div className={px + "-photos"}>
                <div className={px + "-photos-head"}>
                  <span>Your field photos</span>
                  {curVerified && <span className={px + "-verified"}>✓ Photo verified</span>}
                </div>
                {curSubs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 13 }}>
                    {curSubs.map((s) => (
                      <div key={s.id} className={"fp-photo-row " + s.status}>
                        <img src={s.photo_data} alt="Field photo submitted" />
                        <div className="fp-photo-meta">
                          <div className="fp-photo-status">
                            <span className={"fp-status-pill " + s.status}>{s.status === "verified" ? "✓ Verified" : s.status === "rejected" ? "Rejected" : "Pending review"}</span>
                            <span className="fp-photo-when">{new Date(s.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</span>
                          </div>
                          <div className="fp-photo-detail">{s.review_note || s.note || "Awaiting expert approval"}</div>
                        </div>
                        {s.status === "pending" && <button className="fp-photo-remove" onClick={() => removeSub(s.id)}><X size={13} /></button>}
                      </div>
                    ))}
                  </div>
                )}
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Field note — what the photo shows, plus date and location" className={px + "-note-input"} />
                <label className={px + "-upload" + (busy ? " busy" : "")}>
                  <Camera size={15} />
                  <span>{busy ? "Processing…" : "＋ Attach a field photo"}</span>
                  <input type="file" accept="image/*" onChange={attach} disabled={busy} />
                </label>
                <p className={px + "-upload-note"}>Photos are submitted to the <strong>{kingdom === "flora" ? "Flora" : "Fauna"} expert</strong> in the admin portal for approval. Nothing is published to the profile until it is verified — approved photos carry a green tick.</p>
              </div>

              {cur.atts && cur.atts.length > 0 && (
                <div>
                  <div className={px + "-section-label"}>Licensed reference views ({cur.atts.length})</div>
                  <div className={px + "-atts"}>
                    {cur.atts.map((a, i) => (
                      <a key={a.n || i} href={a.url || cur.source || "#"} target="_blank" rel="noreferrer" className={px + "-att"}>
                        <span className={px + "-att-n"}>{a.n || i + 1}</span>
                        <div className={px + "-att-body"}>
                          <div className={px + "-att-creator"}>{a.creator || a.provider || "Unattributed"}</div>
                          <div className={px + "-att-meta"}>{[a.provider, (a.licence || "").replace(/^https?:\/\/(www\.)?creativecommons\.org\/licenses\//, "CC ").replace(/^cc-/, "CC ").replace(/\/$/, "").toUpperCase()].filter(Boolean).join(" · ")}</div>
                        </div>
                        <ExternalLink size={13} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {kingdom === "flora" ? (
                <>
                  <div><div className={px + "-section-label"}>Diagnostic features</div><p className={px + "-longtext"}>{cur.diag}</p></div>
                  <div><div className={px + "-section-label"}>Habitat &amp; distribution context</div><p className={px + "-longtext"}>{cur.habitat}</p></div>
                </>
              ) : (
                <>
                  <div><div className={px + "-section-label"}>Identification focus</div><p className={px + "-longtext"}>{cur.focus}</p></div>
                  <div><div className={px + "-section-label"}>Evidence to record</div><p className={px + "-longtext"}>{cur.evidence}</p></div>
                  <div><div className={px + "-section-label"}>Escalate</div><p className={px + "-longtext"}>{cur.escalate}</p></div>
                </>
              )}

              {cur.source && (
                <a href={cur.source} target="_blank" rel="noreferrer" className={px + "-source"}>
                  <div><div className={px + "-source-title"}>Open the current official profile</div><div className={px + "-source-sub"}>Always check the live source before you rely on anything here</div></div>
                  <ExternalLink size={15} />
                </a>
              )}

              <div className={px + "-nav"}>
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
