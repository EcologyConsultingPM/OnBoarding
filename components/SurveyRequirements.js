"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Search, ShieldAlert } from "lucide-react";
import { SURVEY_FLORA } from "../lib/surveyFlora";
import { SURVEY_FAUNA } from "../lib/surveyFauna";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function MonthTally({ tally, kingdom }) {
  const max = Math.max(...tally, 1);
  return (
    <div className="svy-tally">
      {tally.map((v, i) => (
        <div key={i} className="svy-tally-bar">
          <div className="svy-tally-fill" style={{ height: `${Math.max(6, (v / max) * 100)}%` }} title={`${v}`} />
          <span className="svy-tally-lbl">{MONTHS[i]}</span>
        </div>
      ))}
    </div>
  );
}

function MonthStrip({ months, kingdom }) {
  const set = new Set(months || []);
  return (
    <div className="svy-months">
      {MONTHS.map((m, i) => <span key={i} className={"svy-month" + (set.has(i) ? " on" : "")}>{m}</span>)}
    </div>
  );
}

export default function SurveyRequirements({ initialKingdom = "flora", onBack }) {
  const [kingdom, setKingdom] = useState(initialKingdom);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);

  const data = kingdom === "flora" ? SURVEY_FLORA : SURVEY_FAUNA;

  const rows = useMemo(() => {
    if (kingdom !== "flora") return [];
    const n = q.trim().toLowerCase();
    let list = data.rows;
    if (n) list = list.filter((r) => (r.name + " " + (r.common || "") + " " + r.req).toLowerCase().includes(n));
    return list;
  }, [data, q, kingdom]);

  const groups = useMemo(() => {
    if (kingdom !== "fauna") return [];
    const n = q.trim().toLowerCase();
    let list = data.rows;
    if (n) list = list.filter((r) => (r.taxon + " " + r.group + " " + r.timing).toLowerCase().includes(n));
    return list;
  }, [data, q, kingdom]);

  const readmeKey = kingdom === "flora" ? "NSW flora sheet" : "NSW fauna sheet";

  return (
    <div className={"svy " + kingdom}>
      {onBack && <button className="svy-back" onClick={onBack}><ChevronLeft size={14} /> Back to profile guide</button>}

      <header className="svy-hero">
        <span>NSW &amp; ACT · 2026 · Species-specific survey time and conditions</span>
        <h1>Targeted survey standards — {kingdom === "flora" ? "flora" : "fauna"}</h1>
        <p>{data.readme["Purpose"]}</p>
      </header>

      <div className="spk-toggle">
        <button className={"flora" + (kingdom === "flora" ? " sel" : "")} onClick={() => { setKingdom("flora"); setQ(""); setLimit(40); }}>Flora</button>
        <button className={"fauna" + (kingdom === "fauna" ? " sel" : "")} onClick={() => { setKingdom("fauna"); setQ(""); setLimit(40); }}>Fauna</button>
      </div>

      <MonthTally tally={data.monthTally} kingdom={kingdom} />

      <div className="svy-note">
        <ShieldAlert size={16} />
        <div>
          <strong>{readmeKey}</strong>
          <p>{data.readme[readmeKey]}</p>
        </div>
      </div>

      {kingdom === "flora" ? (
        <>
          <div className="svy-search"><Search size={15} /><input value={q} onChange={(e) => { setQ(e.target.value); setLimit(40); }} placeholder="Search species with specific survey requirements" /></div>
          <div className="svy-shown-label" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(238,243,234,.45)" }}>
            {rows.length} of {data.rows.length} species with specific requirements
          </div>
          <div className="svy-list">
            {rows.slice(0, limit).map((r) => (
              <div key={r.id} className="svy-row">
                <div className="svy-row-top">
                  <span className="svy-row-name">{r.name}</span>
                  {r.common && <span className="svy-row-common">{r.common}</span>}
                </div>
                <p className="svy-row-req">{r.req}</p>
                <MonthStrip months={r.months} kingdom={kingdom} />
                <div className="svy-src">{r.src}</div>
              </div>
            ))}
          </div>
          {rows.length > limit && (
            <button className="fp-more" onClick={() => setLimit((l) => l + 40)}>Show {Math.min(40, rows.length - limit)} more</button>
          )}
        </>
      ) : (
        <>
          <div className="svy-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fauna group survey benchmarks" /></div>
          <div className="svy-list">
            {groups.map((g, i) => (
              <div key={i} className="svy-group-card">
                <div className="svy-group-name">{g.taxon}</div>
                <div className="svy-group-grid">
                  <div><span>Timing</span><p>{g.timing}</p></div>
                  <div><span>Benchmark effort</span><p>{g.benchmark}</p></div>
                  <div><span>Method control</span><p>{g.control}</p></div>
                </div>
                {g.months && g.months.length > 0 && <MonthStrip months={g.months} kingdom={kingdom} />}
                <div className="svy-src">{g.src}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div>
        <div className="fp-section-label" style={{ color: kingdom === "flora" ? "#e7c979" : "#f0a35e" }}>
          {kingdom === "flora" ? "ACT controls" : "ACT species-specific controls"}
        </div>
        <div className="svy-act-grid">
          {data.act.map((a, i) => (
            <div key={i} className="svy-act-row">
              <div className="svy-act-topic">{a.topic}</div>
              <p><strong>Rule:</strong> {a.rule}</p>
              <p><strong>Permit/welfare:</strong> {a.permit}</p>
              <p><strong>Escalate:</strong> {a.escalate}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="fp-section-label" style={{ color: kingdom === "flora" ? "#e7c979" : "#f0a35e" }}>Planning checklist</div>
        <div className="svy-planner">
          {data.planner.map((p, i) => (
            <div key={i} className="svy-plan-row">
              <div className="svy-plan-step">{p.step}</div>
              <div className="svy-plan-body">
                <p>{p.record}</p>
                <div className="svy-plan-done">{p.done}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
