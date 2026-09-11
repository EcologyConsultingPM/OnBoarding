"use client";

/**
 * Ecado console — six commands, an open-escalation register, and a closure
 * dialogue that will not accept a blank reason. Markdown is rendered with a
 * minimal formatter so this has no new dependency.
 */

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../../lib/AuthProvider";

const COMMANDS = [
  { kind: "daily", label: "What requires attention today?", hint: "Daily operations brief" },
  { kind: "weekly", label: "Weekly executive brief", hint: "Portfolio, compliance, resources, commercial" },
  { kind: "program", label: "Review all active projects", hint: "Program review" },
  { kind: "project", label: "Review a project", hint: "Project health review", needsProject: true },
  { kind: "capacity", label: "Review staff capacity", hint: "Allocation, spare capacity, reallocation" },
  { kind: "compliance", label: "Review compliance status", hint: "WHS, corrective actions, certifications" },
];

const ICON = { critical: "\ud83d\udd34", high: "\ud83d\udfe0", medium: "\ud83d\udfe1", low: "\ud83d\udfe2" };

function Markdown({ source }) {
  const lines = source.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h3 key={i}>{line.slice(4)}</h3>;
        if (line.startsWith("## ")) return <h2 key={i}>{line.slice(3)}</h2>;
        if (line.startsWith("# ")) return <h1 key={i}>{line.slice(2)}</h1>;
        if (line.startsWith("---")) return <hr key={i} />;
        if (!line.trim()) return <br key={i} />;
        return (
          <p key={i} className={line.startsWith("- ") || /^\d+\./.test(line) ? "ec-indent" : undefined}>
            {inline(line)}
          </p>
        );
      })}
    </>
  );
}

function inline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
}

export default function EcadoConsole({ initialEscalations }) {
  const { session } = useAuth();
  const [escalations, setEscalations] = useState(initialEscalations || []);
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [projectRef, setProjectRef] = useState("");
  const [openEvidence, setOpenEvidence] = useState("");
  const [closing, setClosing] = useState(null);
  const [reason, setReason] = useState("");

  const headers = useCallback(() => ({ "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);

  const run = useCallback(async (kind) => {
    if (kind === "project" && !projectRef.trim()) {
      setError("Enter a project name first.");
      return;
    }
    setLoading(kind);
    setError(null);
    try {
      const res = await fetch("/api/ecado/brief", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ kind, projectRef: projectRef.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Brief generation failed.");
      setBrief(data);
    } catch (e) {
      setError(e.message || "Brief generation failed.");
    } finally {
      setLoading(null);
    }
  }, [projectRef, headers]);

  const submitClosure = useCallback(async () => {
    if (!closing) return;
    if (reason.trim().length < 10) {
      setError("A closure reason of at least 10 characters is required. Record why, not just that.");
      return;
    }
    const res = await fetch("/api/ecado/escalations/close", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id: closing.id, reason: reason.trim() }),
    });
    if (res.ok) {
      setEscalations((prev) => prev.filter((e) => e.id !== closing.id));
      setClosing(null);
      setReason("");
      setError(null);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Closure failed.");
    }
  }, [closing, reason, headers]);

  const openCritical = useMemo(() => escalations.filter((e) => e.rating === "critical").length, [escalations]);

  return (
    <div className="ec-console">
      {/* Aligned to the Ecology Consulting admin style guide: Archivo body,
          DM Serif Display headings, and the portal palette (deep green #173920
          / #1f5a34, cream #fffdf8, sage #cdd8c6 / #e3e6d8, muted #7a877d,
          clay #a5342a for alerts). Previously this console shipped a generic
          slate/blue-grey palette with -apple-system type, so the hidden Ecado
          domain looked like a different product to the rest of the portal. */}
      <style>{`
        .ec-console { display: flex; flex-direction: column; gap: 26px; font-family: "Archivo", "Nunito Sans", system-ui, sans-serif; color: #23301f; }
        .ec-section-title { margin: 0 0 10px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: #7a877d; }
        .ec-commands { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 9px; }
        .ec-command { border: 1px solid #cdd8c6; background: #fffdf8; border-radius: 14px; padding: 13px 15px; text-align: left; cursor: pointer; font-family: inherit; transition: border-color .15s ease, box-shadow .15s ease; }
        .ec-command:hover { border-color: #1f5a34; box-shadow: 0 2px 8px rgba(31,90,52,.10); }
        .ec-command:disabled { opacity: .5; cursor: not-allowed; }
        .ec-command strong { display: block; font-size: 13.5px; font-weight: 700; color: #173920; }
        .ec-command span { display: block; font-size: 11.5px; color: #7a877d; margin-top: 3px; }
        .ec-project-input { margin-top: 11px; width: 100%; border: 1px solid #cdd8c6; border-radius: 10px; padding: 10px 13px; font-size: 13px; box-sizing: border-box; font-family: inherit; background: #fffdf8; color: #23301f; }
        .ec-project-input:focus { outline: 2px solid #1f5a34; outline-offset: 1px; border-color: #1f5a34; }
        .ec-error { border: 1px solid #e6c3bd; background: #fbecea; border-radius: 10px; padding: 11px 15px; font-size: 13px; color: #a5342a; font-weight: 600; }
        .ec-escalation { border: 1px solid #cdd8c6; background: #fffdf8; border-radius: 14px; padding: 13px 15px; margin-bottom: 9px; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .ec-escalation strong { font-size: 13.5px; color: #173920; font-weight: 700; }
        .ec-escalation p { margin: 5px 0 0; font-size: 12px; color: #5c6b58; line-height: 1.5; }
        .ec-close-btn { flex-shrink: 0; border: 1px solid #cdd8c6; background: #fff; border-radius: 999px; padding: 6px 13px; font-size: 11.5px; font-weight: 700; color: #2c6a34; cursor: pointer; }
        .ec-close-btn:hover { border-color: #1f5a34; background: #f2f7f0; }
        .ec-modal-bg { position: fixed; inset: 0; z-index: 200; background: rgba(18,33,26,.52); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .ec-modal { width: 100%; max-width: 480px; background: #fffdf8; border-radius: 18px; padding: 22px; box-shadow: 0 18px 48px rgba(18,33,26,.22); }
        .ec-modal h3 { margin: 0 0 5px; font-family: "DM Serif Display", Georgia, serif; font-size: 19px; font-weight: 400; color: #173920; }
        .ec-modal textarea { width: 100%; margin-top: 9px; border: 1px solid #cdd8c6; border-radius: 10px; padding: 9px 11px; font-size: 13px; box-sizing: border-box; font-family: inherit; background: #fff; color: #23301f; }
        .ec-modal textarea:focus { outline: 2px solid #1f5a34; outline-offset: 1px; }
        .ec-modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 16px; }
        .ec-btn-secondary { border: 1px solid #cdd8c6; background: #fff; border-radius: 999px; padding: 8px 17px; font-size: 13px; font-weight: 700; color: #5c6b58; cursor: pointer; font-family: inherit; }
        .ec-btn-primary { border: none; background: #1f5a34; color: #fffdf8; border-radius: 999px; padding: 8px 17px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .ec-btn-primary:hover { background: #173920; }
        .ec-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
        .ec-brief-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 11px; }
        .ec-brief-head span { font-size: 12px; color: #5c6b58; }
        .ec-brief-unnarrated { font-size: 11px; color: #a5342a; font-weight: 700; }
        .ec-copy-btn { margin-left: auto; border: 1px solid #cdd8c6; background: #fff; border-radius: 999px; padding: 6px 13px; font-size: 11.5px; font-weight: 700; color: #2c6a34; cursor: pointer; }
        .ec-brief-article { border: 1px solid #cdd8c6; background: #fffdf8; border-radius: 16px; padding: 20px 22px; font-size: 13.5px; line-height: 1.65; color: #23301f; }
        .ec-brief-article h1, .ec-brief-article h2, .ec-brief-article h3 { font-family: "DM Serif Display", Georgia, serif; font-weight: 400; color: #173920; }
        .ec-brief-article a { color: #2c6a34; }
        .ec-indent { margin-left: 16px; }
        .ec-escalation-body { min-width: 0; }
        .ec-escalation-meta { color: #7a877d; }
        .ec-evidence-toggle { margin-top: 9px; border: 1px solid #cdd8c6; background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 700; color: #2c6a34; cursor: pointer; font-family: inherit; }
        .ec-evidence-toggle:hover { border-color: #1f5a34; background: #f2f7f0; }
        .ec-evidence { margin-top: 11px; padding: 13px 15px; border: 1px solid #e3e6d8; border-left: 3px solid #1f5a34; border-radius: 0 12px 12px 0; background: #f7f9f3; }
        .ec-evidence dl { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px 18px; }
        .ec-evidence dl > div { min-width: 0; }
        .ec-evidence dt { font-size: 10.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #7a877d; }
        .ec-evidence dd { margin: 2px 0 0; font-size: 12.5px; color: #23301f; overflow-wrap: anywhere; }
        .ec-evidence code { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; background: #eef1e8; padding: 1px 5px; border-radius: 4px; color: #173920; }
        .ec-evidence-block { margin: 11px 0 0; display: block; font-size: 12.5px; line-height: 1.55; color: #23301f; }
        .ec-evidence-block strong { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #7a877d; margin-bottom: 2px; }
        .ec-evidence-values { margin-top: 11px; }
        .ec-evidence-values strong { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #7a877d; margin-bottom: 5px; }
        .ec-evidence-values ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
        .ec-evidence-values li { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
        .ec-evidence-values li span { color: #5c6b58; text-transform: capitalize; }
        .ec-evidence-note { margin: 12px 0 0; font-size: 11px; color: #7a877d; line-height: 1.5; }
        .ec-empty { font-size: 13px; color: #7a877d; }
      `}</style>

      <section>
        <h2 className="ec-section-title">Commands</h2>
        <div className="ec-commands">
          {COMMANDS.map((c) => (
            <button key={c.kind} type="button" className="ec-command" onClick={() => run(c.kind)} disabled={loading !== null}>
              <strong>{loading === c.kind ? "Working…" : c.label}</strong>
              <span>{c.hint}</span>
            </button>
          ))}
        </div>
        <input className="ec-project-input" value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="Project name for a project review" />
      </section>

      {error ? <div className="ec-error">{error}</div> : null}

      <section>
        <h2 className="ec-section-title">Open escalations ({escalations.length}{openCritical ? ` \u00b7 ${openCritical} critical` : ""})</h2>
        {escalations.length === 0 ? (
          <p className="ec-empty">No open escalations.</p>
        ) : (
          escalations.map((e) => (
            <div key={e.id} className="ec-escalation">
              <div className="ec-escalation-body">
                <strong>{ICON[e.rating]} {e.title}</strong>
                <p>{e.what_happened}</p>
                <p className="ec-escalation-meta">Opened {new Date(e.opened_at).toLocaleDateString("en-AU")} \u00b7 {e.owner || "unassigned"}</p>

                {/* Evidence drawer. Every field here was already computed and
                    persisted with the escalation, then discarded at render —
                    so a reader could see the conclusion but not what produced
                    it. Explainability is the point of a finding: the rule that
                    fired, the record it read, the severity history, and what
                    is being asked of the reader. */}
                <button
                  type="button"
                  className="ec-evidence-toggle"
                  aria-expanded={openEvidence === e.id}
                  onClick={() => setOpenEvidence(openEvidence === e.id ? "" : e.id)}
                >
                  {openEvidence === e.id ? "Hide" : "Why Ecado flagged this"}
                </button>

                {openEvidence === e.id ? (
                  <div className="ec-evidence">
                    <dl>
                      <div><dt>Rule</dt><dd><code>{e.rule_id}</code></dd></div>
                      <div><dt>Source record</dt><dd>{e.source_ref || `${e.source_type} ${e.source_id}`}</dd></div>
                      <div><dt>Severity</dt><dd>{e.rating}{e.peak_rating && e.peak_rating !== e.rating ? ` (peaked at ${e.peak_rating})` : ""}</dd></div>
                      <div><dt>Escalation level</dt><dd>{e.level} of 4</dd></div>
                      <div><dt>First seen</dt><dd>{new Date(e.opened_at).toLocaleString("en-AU")}</dd></div>
                      {e.last_seen_at ? <div><dt>Last confirmed</dt><dd>{new Date(e.last_seen_at).toLocaleString("en-AU")}</dd></div> : null}
                      <div><dt>Owner</dt><dd>{e.owner || "Unassigned"}</dd></div>
                    </dl>

                    {e.why_it_matters ? (
                      <p className="ec-evidence-block"><strong>Why it matters</strong><span>{e.why_it_matters}</span></p>
                    ) : null}
                    {e.what_next ? (
                      <p className="ec-evidence-block"><strong>What next</strong><span>{e.what_next}</span></p>
                    ) : null}

                    {e.detail && Object.keys(e.detail).length ? (
                      <div className="ec-evidence-values">
                        <strong>Values read</strong>
                        <ul>
                          {Object.entries(e.detail).map(([key, value]) => (
                            <li key={key}>
                              <span>{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase()}</span>
                              <code>{value === null || value === undefined ? "—" : String(value)}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <p className="ec-evidence-note">
                      Determined by rule <code>{e.rule_id}</code> against the record above, not by the language model.
                      Ecado does not approve, assign or change records.
                    </p>
                  </div>
                ) : null}
              </div>
              <button type="button" className="ec-close-btn" onClick={() => { setClosing(e); setReason(""); }}>Close…</button>
            </div>
          ))
        )}
      </section>

      {closing ? (
        <div className="ec-modal-bg" onClick={() => setClosing(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Close escalation</h3>
            <p style={{ fontSize: 12, color: "#475569" }}>{closing.title}</p>
            <p style={{ fontSize: 11.5, color: "#64748b", marginTop: 8 }}>Record what was actually done. This closure is attributed to you and retained with the record.</p>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Corrective action completed 8 Sep, verified on site, evidence attached to incident 214." />
            <div className="ec-modal-actions">
              <button type="button" className="ec-btn-secondary" onClick={() => setClosing(null)}>Cancel</button>
              <button type="button" className="ec-btn-primary" onClick={submitClosure} disabled={reason.trim().length < 10}>Close with reason</button>
            </div>
          </div>
        </div>
      ) : null}

      {brief ? (
        <section>
          <div className="ec-brief-head">
            <h2 className="ec-section-title" style={{ margin: 0 }}>Brief</h2>
            {["critical", "high", "medium", "low"].map((r) => <span key={r}>{ICON[r]} {brief.counts?.[r] ?? 0}</span>)}
            {!brief.narrated ? <span className="ec-brief-unnarrated">rule engine output only</span> : null}
            <button type="button" className="ec-copy-btn" onClick={() => navigator.clipboard.writeText(brief.markdown)}>Copy markdown</button>
          </div>
          <article className="ec-brief-article"><Markdown source={brief.markdown} /></article>
        </section>
      ) : null}
    </div>
  );
}
