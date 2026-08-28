import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, Clock3, Download, Filter, ListFilter, RefreshCw, Search, Timer, X } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../lib/AuthProvider";
import WorkspaceNav from "./WorkspaceNav";

const STATUS = {
  not_commenced: { label: "Not commenced", colour: "#d98980" },
  active: { label: "Active", colour: "#d49b2b" },
  need_info: { label: "Needs information", colour: "#b5352a" },
  paused_other: { label: "Paused", colour: "#4d8fc2" },
  qa_review: { label: "In QA review", colour: "#7d3b5c" },
  completed: { label: "Completed", colour: "#4b9654" },
};

function formatDate(value) {
  if (!value) return "No update date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No update date" : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function normaliseText(value) {
  return (value || "").toLocaleLowerCase();
}

// A staff-only view of immutable project activity history and staff-submitted
// Project Tracker entries. Official payroll time remains in the independent
// Ecology Consulting timesheet system; this screen is the controlled reference.
export default function StaffTimesheetsWorkspace() {
  const { session } = useAuth();
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated_desc");

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${session?.access_token || ""}` }), [session]);

  const load = useCallback(async () => {
    if (!session?.access_token || !session?.user?.id) return;
    setLoading(true);
    setError("");
    try {
      const projectsResponse = await fetch("/api/projects", { headers: authHeaders() });
      const projectsData = await projectsResponse.json();
      if (!projectsResponse.ok) throw new Error(projectsData.error || "Could not load your project allocations.");
      const allocatedProjects = projectsData.projects || [];
      setProjects(allocatedProjects);

      const historyResponse = await fetch("/api/my-project-tracker", { headers: authHeaders() });
      const historyData = await historyResponse.json();
      if (!historyResponse.ok) throw new Error(historyData.error || "Could not load your tracker history.");
      setEntries(historyData.entries || []);
    } catch (err) {
      setError(err.message || "Could not load your tracker history.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, session?.access_token, session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  const filteredEntries = useMemo(() => {
    const cutoff = periodFilter === "all" ? null : new Date(Date.now() - Number(periodFilter) * 24 * 60 * 60 * 1000);
    const search = normaliseText(query.trim());
    const result = entries.filter((entry) => {
      const entryDate = entry.work_date || entry.changed_at;
      const category = entry.activity_category || entry.category || entry.task_category || "";
      if (projectFilter !== "all" && entry.project_id !== projectFilter) return false;
      if (clientFilter !== "all" && (entry.project_client || "") !== clientFilter) return false;
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      if (statusFilter !== "all" && entry.status !== statusFilter) return false;
      if (cutoff && (!entryDate || new Date(entryDate) < cutoff)) return false;
      if (startDate && (!entryDate || String(entryDate).slice(0, 10) < startDate)) return false;
      if (endDate && (!entryDate || String(entryDate).slice(0, 10) > endDate)) return false;
      if (search && ![entry.project_name, entry.project_client, entry.title, category, entry.note, entry.information].some((value) => normaliseText(value).includes(search))) return false;
      return true;
    });

    result.sort((a, b) => {
      if (sortBy === "updated_asc") return new Date(a.changed_at || 0) - new Date(b.changed_at || 0);
      if (sortBy === "project") return String(a.project_name || "").localeCompare(String(b.project_name || "")) || new Date(b.changed_at || 0) - new Date(a.changed_at || 0);
      if (sortBy === "client") return String(a.project_client || "").localeCompare(String(b.project_client || "")) || String(a.project_name || "").localeCompare(String(b.project_name || ""));
      if (sortBy === "status") return (STATUS[a.status]?.label || a.status).localeCompare(STATUS[b.status]?.label || b.status) || new Date(b.changed_at || 0) - new Date(a.changed_at || 0);
      return new Date(b.changed_at || 0) - new Date(a.changed_at || 0);
    });
    return result;
  }, [categoryFilter, clientFilter, endDate, entries, periodFilter, projectFilter, query, sortBy, startDate, statusFilter]);

  const totals = useMemo(() => ({
    activities: entries.length,
    active: entries.filter((entry) => entry.status === "active").length,
    blocked: entries.filter((entry) => ["need_info", "paused_other"].includes(entry.status)).length,
    complete: entries.filter((entry) => entry.status === "completed").length,
  }), [entries]);

  const clearFilters = () => {
    setQuery("");
    setProjectFilter("all");
    setStatusFilter("all");
    setPeriodFilter("all");
    setStartDate("");
    setEndDate("");
    setClientFilter("all");
    setCategoryFilter("all");
    setSortBy("updated_desc");
  };
  const clients = useMemo(() => [...new Set(entries.map((entry) => entry.project_client).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [entries]);
  const categories = useMemo(() => [...new Set(entries.map((entry) => entry.activity_category || entry.category || entry.task_category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [entries]);
  const exportXlsx = () => {
    const rows = filteredEntries.map((entry) => ({
      "Work date": formatDate(entry.work_date || entry.changed_at),
      Client: entry.project_client || "",
      Project: entry.project_name || "",
      "Activity category": entry.activity_category || entry.category || entry.task_category || "",
      "Activity information": entry.information || entry.title || "",
      Status: STATUS[entry.status]?.label || entry.status || "",
      Hours: entry.hours ?? entry.budget_hours ?? "",
      "Notable issues": entry.notable_issues || entry.note || "",
      "Record type": entry.entry_type === "tracker_entry" ? "Project Tracker entry" : "Project activity update",
      "Recorded at": entry.changed_at ? new Date(entry.changed_at).toLocaleString("en-AU") : "",
    }));
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Work date": "No entries match the selected filters." }]);
    sheet["!cols"] = [{ wch: 16 }, { wch: 26 }, { wch: 34 }, { wch: 24 }, { wch: 52 }, { wch: 18 }, { wch: 10 }, { wch: 42 }, { wch: 24 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "My Timesheets");
    XLSX.writeFile(workbook, `ecology-consulting-timesheets-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const hasFilters = query || projectFilter !== "all" || clientFilter !== "all" || categoryFilter !== "all" || statusFilter !== "all" || periodFilter !== "all" || startDate || endDate || sortBy !== "updated_desc";

  return (
    <main className="timesheet-page">
      <header className="timesheet-hero">
        <WorkspaceNav audience="staff" />
        <span><Timer size={14} /> Ecology Consulting · staff time and project tracking</span>
        <h1>Timesheets</h1>
        <p>Review your allocated project tracker entries, then use the official timesheet system to enter actual time worked.</p>
        <a className="timesheet-entry-link" href="https://staff.ecologyconsulting.au/" target="_blank" rel="noreferrer">
          <Clock3 size={16} /> Enter timesheet <ArrowUpRight size={15} />
        </a>
      </header>

      <section className="timesheet-summary" aria-label="Project tracker summary">
        <div><strong>{totals.activities}</strong><span>Tracker entries</span></div>
        <div><strong>{totals.active}</strong><span>In progress</span></div>
        <div><strong className={totals.blocked ? "is-alert" : ""}>{totals.blocked}</strong><span>Need attention</span></div>
        <div><strong>{totals.complete}</strong><span>Completed</span></div>
      </section>

      <section className="timesheet-tracker">
        <div className="timesheet-tracker-head">
          <div>
            <h2><BarChart3 size={18} /> Project tracker history</h2>
            <p>Your submitted Project Tracker entries and allocated activity status updates. Use the official timesheet system to enter payroll time.</p>
          </div>
          <div className="timesheet-head-actions"><button className="timesheet-export" type="button" onClick={exportXlsx} disabled={loading}><Download size={14} /> Export XLSX</button><button className="timesheet-refresh" type="button" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh</button></div>
        </div>

        <div className="timesheet-filters" aria-label="Filter project tracker history">
          <label className="timesheet-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project or activity" /></label>
          <label><span>Project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>Client</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">All clients</option>{clients.map((client) => <option key={client} value={client}>{client}</option>)}</select></label>
          <label><span>Activity category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}</select></label>
          <label><span>Updated</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
          <label><span>From</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <label><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="updated_desc">Newest first</option><option value="updated_asc">Oldest first</option><option value="client">Client</option><option value="project">Project</option><option value="status">Status</option></select></label>
          {hasFilters ? <button type="button" className="timesheet-clear" onClick={clearFilters}><X size={13} /> Clear</button> : null}
        </div>

        {error ? <div className="timesheet-error" role="alert">{error}</div> : null}
        {!error && loading ? <p className="timesheet-empty">Loading your project tracker history…</p> : null}
        {!error && !loading && filteredEntries.length === 0 ? <p className="timesheet-empty">{entries.length ? "No tracker entries match the current filters." : "No project tracker entries have been allocated to you yet."}</p> : null}
        {!error && !loading && filteredEntries.length > 0 ? (
          <div className="timesheet-table-wrap">
            <table className="timesheet-table">
              <thead><tr><th>Project</th><th>Activity</th><th>Status</th><th>Hours</th><th>Recorded</th></tr></thead>
              <tbody>{filteredEntries.map((entry) => {
                const status = STATUS[entry.status] || { label: entry.status || "Unknown", colour: "#7a877d" };
                return <tr key={entry.id}>
                  <td><strong>{entry.project_name}</strong>{entry.project_client ? <small>{entry.project_client}</small> : null}</td>
                  <td><strong>{entry.title}</strong>{entry.task_category ? <small>{entry.task_category}</small> : null}{entry.allocation ? <small>{entry.allocation}</small> : null}{entry.notable_issues ? <small className="timesheet-reason">Issue: {entry.notable_issues}</small> : entry.note ? <small className="timesheet-reason">{entry.note}</small> : null}</td>
                  <td><span className="timesheet-status" style={{ background: `${status.colour}18`, color: status.colour }}>{entry.entry_type === "tracker_entry" ? "Project entry · " : "Activity update · "}{status.label}</span></td>
                  <td>{entry.hours != null ? `${entry.hours} h` : entry.budget_hours != null ? `${entry.budget_hours} h planned` : "—"}</td>
                  <td>{formatDate(entry.changed_at)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
