import { CalendarRange, Flag, Lock, TrendingUp } from "lucide-react";

const STATUS = {
  not_commenced: { label: "Not commenced", color: "#7a6460" },
  active: { label: "Active", color: "#c28434" },
  need_info: { label: "Information required", color: "#b14f43" },
  paused_other: { label: "Paused", color: "#3b7398" },
  qa_review: { label: "QA review", color: "#7963a0" },
  completed: { label: "Completed", color: "#228451" },
};

function asDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayStamp(value) {
  const date = asDate(value);
  return date ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) : null;
}

function shortDate(value) {
  const date = asDate(value);
  return date ? date.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "Date pending";
}

export default function ProjectGantt({ schedule = [] }) {
  const seen = new Set();
  const rows = schedule.filter((item) => item.title).filter((item) => {
    const key = item.id || [item.title, item.detail || "", item.startDate || "", item.endDate || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dated = rows.flatMap((item) => [dayStamp(item.startDate), dayStamp(item.endDate || item.startDate)]).filter((value) => Number.isFinite(value));
  const min = dated.length ? Math.min(...dated) : Date.now();
  const max = dated.length ? Math.max(...dated) : min + 7 * 86400000;
  const span = Math.max(1, Math.ceil((max - min) / 86400000) + 1);
  const monthLabels = [];
  for (let index = 0; index < span; index += 1) {
    const date = new Date(min + index * 86400000);
    if (index === 0 || date.getUTCDate() === 1) monthLabels.push({ index, label: date.toLocaleDateString("en-AU", { month: "short", day: "numeric" }) });
  }

  return (
    <section className="pgantt" aria-label="Project Gantt schedule">
      <header className="pgantt-head">
        <div><span><CalendarRange size={14} /> Live delivery schedule</span><h2>Project Gantt</h2><p>Schedule lines retain their identity and progress updates automatically when connected activity work is saved.</p></div>
        <span className="pgantt-legend"><TrendingUp size={14} /> Live progress from activities</span>
      </header>
      {!rows.length ? <p className="pgantt-empty">Add a dated schedule line or a work activity to begin the connected project Gantt.</p> : (
        <div className="pgantt-scroll">
          <div className="pgantt-table" style={{ "--gantt-days": Math.max(span, 7) }}>
            <div className="pgantt-axis"><div>Schedule line</div><div className="pgantt-dates">{monthLabels.map((month) => <span key={month.index} style={{ left: `${(month.index / span) * 100}%` }}>{month.label}</span>)}</div></div>
            {rows.map((item) => {
              const start = dayStamp(item.startDate || item.endDate) ?? min;
              const end = dayStamp(item.endDate || item.startDate) ?? start;
              const left = Math.max(0, ((start - min) / 86400000 / span) * 100);
              const width = Math.max(2, (((Math.max(end, start) - start) / 86400000 + 1) / span) * 100);
              const status = STATUS[item.status] || STATUS.not_commenced;
              const progress = Math.max(0, Math.min(100, Number(item.progressPercent ?? 0)));
              return <div className="pgantt-row" key={item.id || `${item.title}-${item.sortOrder}`}>
                <div className="pgantt-label"><strong>{item.milestone ? <Flag size={13} /> : null}{item.title}</strong><small>{shortDate(item.startDate || item.endDate)} – {shortDate(item.endDate || item.startDate)} · {status.label}{item.locked ? <><Lock size={11} /> Locked</> : null}</small></div>
                <div className="pgantt-track"><span className="pgantt-bar" style={{ left: `${left}%`, width: `${width}%`, background: status.color }}><i style={{ width: `${progress}%` }} /><b>{progress}%</b></span></div>
              </div>;
            })}
          </div>
        </div>
      )}
    </section>
  );
}
