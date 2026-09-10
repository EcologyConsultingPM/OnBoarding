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
      <style>{`
        .ec-console { display: flex; flex-direction: column; gap: 28px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .ec-section-title { margin: 0 0 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
        .ec-commands { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
        .ec-command { border: 1px solid #e2e8f0; background: #fff; border-radius: 10px; padding: 12px 14px; text-align: left; cursor: pointer; font-family: inherit; }
        .ec-command:hover { border-color: #94a3b8; }
        .ec-command:disabled { opacity: .5; cursor: not-allowed; }
        .ec-command strong { display: block; font-size: 13px; font-weight: 600; color: #0f172a; }
        .ec-command span { display: block; font-size: 11px; color: #64748b; margin-top: 2px; }
        .ec-project-input { margin-top: 10px; width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; font-size: 13px; box-sizing: border-box; }
        .ec-error { border: 1px solid #fecaca; background: #fef2f2; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; }
        .ec-escalation { border: 1px solid #e2e8f0; background: #fff; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .ec-escalation strong { font-size: 13px; color: #0f172a; }
        .ec-escalation p { margin: 4px 0 0; font-size: 11.5px; color: #475569; }
        .ec-close-btn { flex-shrink: 0; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 5px 10px; font-size: 11.5px; color: #334155; cursor: pointer; }
        .ec-modal-bg { position: fixed; inset: 0; z-index: 200; background: rgba(15,23,42,.4); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .ec-modal { width: 100%; max-width: 480px; background: #fff; border-radius: 12px; padding: 20px; }
        .ec-modal h3 { margin: 0 0 4px; font-size: 14px; color: #0f172a; }
        .ec-modal textarea { width: 100%; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font-size: 13px; box-sizing: border-box; font-family: inherit; }
        .ec-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .ec-btn-secondary { border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 7px 14px; font-size: 13px; color: #334155; cursor: pointer; }
        .ec-btn-primary { border: none; background: #0f172a; color: #fff; border-radius: 6px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
        .ec-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
        .ec-brief-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 10px; }
        .ec-brief-head span { font-size: 12px; color: #475569; }
        .ec-brief-unnarrated { font-size: 11px; color: #b45309; }
        .ec-copy-btn { margin-left: auto; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 5px 10px; font-size: 11.5px; color: #334155; cursor: pointer; }
        .ec-brief-article { border: 1px solid #e2e8f0; background: #fff; border-radius: 10px; padding: 18px 20px; font-size: 13px; line-height: 1.6; color: #1e293b; }
        .ec-brief-article h1, .ec-brief-article h2, .ec-brief-article h3 { color: #0f172a; }
        .ec-indent { margin-left: 16px; }
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
          <p style={{ fontSize: 13, color: "#64748b" }}>No open escalations.</p>
        ) : (
          escalations.map((e) => (
            <div key={e.id} className="ec-escalation">
              <div>
                <strong>{ICON[e.rating]} {e.title}</strong>
                <p>{e.what_happened}</p>
                <p style={{ color: "#94a3b8" }}>Opened {new Date(e.opened_at).toLocaleDateString("en-AU")} \u00b7 {e.owner || "unassigned"}</p>
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
