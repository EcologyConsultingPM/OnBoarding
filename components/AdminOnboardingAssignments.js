"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search, Trash2, UsersRound } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// This panel is administrator-only at both UI and API layers. It covers exactly
// the two requested states: unassigned/hidden drafts and staff-visible active
// assignments. Removal deletes the associated assignment content and progress.
export default function AdminOnboardingAssignments({ onToast }) {
  const { session } = useAuth();
  const [modules, setModules] = useState([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/onboarding-assignments", { headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load onboarding assignments.");
      setModules(body.modules || []);
    } catch (err) {
      setError(err.message || "Could not load onboarding assignments.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return modules.filter((module) => {
      if (filter !== "all" && module.state !== filter) return false;
      return !needle || [module.staff_name, module.staff_email, module.title, module.sme]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [filter, modules, query]);

  const remove = async (module) => {
    const description = module.state === "draft" ? "draft onboarding module" : "active staff onboarding module";
    if (!window.confirm(`Permanently delete this ${description}?\n\n${module.title}\n${module.staff_name}\n\nAssociated topics and staff progress will also be removed. This cannot be undone.`)) return;
    setBusyId(module.id);
    setError("");
    try {
      const response = await fetch("/api/admin/onboarding-assignments", {
        method: "DELETE",
        headers: headers(),
        body: JSON.stringify({ module_id: module.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not remove onboarding assignment.");
      setModules((current) => current.filter((item) => item.id !== module.id));
      onToast?.(`Removed ${module.state === "draft" ? "draft" : "active"} onboarding assignment.`);
    } catch (err) {
      setError(err.message || "Could not remove onboarding assignment.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="admin-onboarding-control" aria-label="Manage staff onboarding assignments">
      <div className="admin-onboarding-control__hero">
        <div>
          <span><UsersRound size={14} /> Portal Management · onboarding controls</span>
          <h2>Manage onboarding assignments</h2>
          <p>Remove hidden drafts or active staff assignments when an onboarding path is no longer required. Removal permanently deletes its assigned modules, topics and recorded progress.</p>
        </div>
        <button type="button" onClick={load} className="admin-onboarding-control__refresh" disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      <div className="admin-onboarding-control__filters">
        <label className="admin-onboarding-control__search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff member or module" /></label>
        <label><span>Status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All assignments</option><option value="draft">Draft — hidden from staff</option><option value="active">Active — visible to staff</option></select></label>
      </div>

      {error ? <div className="admin-onboarding-control__error" role="alert"><AlertTriangle size={15} /> {error}</div> : null}
      {loading ? <p className="admin-onboarding-control__empty">Loading onboarding assignments…</p> : null}
      {!loading && !error && filtered.length === 0 ? <p className="admin-onboarding-control__empty">No onboarding assignments match the current view.</p> : null}
      {!loading && !error && filtered.length > 0 ? (
        <div className="admin-onboarding-control__list">
          {filtered.map((module) => (
            <article className="admin-onboarding-control__row" key={module.id}>
              <div className="admin-onboarding-control__main">
                <div className="admin-onboarding-control__staff">{module.staff_name} <small>{module.staff_email}</small></div>
                <strong>{module.title}</strong>
                <span>{module.sme ? `SME: ${module.sme} · ` : ""}Last updated {formatDate(module.updated_at || module.created_at)}</span>
              </div>
              <span className={`admin-onboarding-control__state ${module.state}`}>{module.state === "draft" ? "Draft — hidden" : "Active — staff can access"}</span>
              <button type="button" className="admin-onboarding-control__delete" disabled={busyId === module.id} onClick={() => remove(module)}>
                <Trash2 size={14} /> {busyId === module.id ? "Removing…" : "Delete"}
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
