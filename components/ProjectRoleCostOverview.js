"use client";
import { useEffect, useRef, useState } from "react";

const SCOPES = [
  ["current", "Current funded actuals"],
  ["historical", "Closed / non-current allocation history"],
  ["otherHistory", "Other recorded history"],
  ["lifetime", "Lifetime recorded actuals"],
];
const number = (value) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(value);
const money = (value) => value === null || value === undefined ? "Not configured" :
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const margin = (value) => value === null || value === undefined ? "—" : `${number(value)}%`;
const blankState = (scopeKey, loading = false) => ({ scopeKey, loading, error: "", data: null });

const STYLES = `
.prco { background:#f5f4ed; color:#173c2c; border:1px solid #d8e1d7; border-radius:14px; padding:22px; min-width:0; }
.prco * { box-sizing:border-box; }
.prco .prco-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.prco h3 { color:#173c2c; margin:0 0 7px; font-size:1.25rem; }
.prco p { color:#365642; line-height:1.6; margin:8px 0; font-size:.9rem; }
.prco button,.prco select { color:#173c2c; background:#fff; border:1px solid #829884; border-radius:8px; padding:10px 13px; font:inherit; min-height:42px; }
.prco button { cursor:pointer; font-weight:600; }
.prco button:disabled { opacity:.65; cursor:wait; }
.prco button:focus-visible,.prco select:focus-visible,.prco .prco-scroll:focus-visible { outline:3px solid #286647; outline-offset:3px; }
.prco .prco-scope { display:flex; align-items:center; gap:12px; margin:18px 0 12px; flex-wrap:wrap; }
.prco label { color:#173c2c; font-weight:600; }
.prco select { max-width:100%; }
.prco .prco-scroll { overflow-x:auto; max-width:100%; border:1px solid #d8e1d7; border-radius:9px; background:#fff; }
.prco table { border-collapse:collapse; width:100%; min-width:850px; font-size:.85rem; color:#173c2c; }
.prco caption { text-align:left; color:#173c2c; font-weight:600; padding:13px 14px; background:#eef2e9; }
.prco th,.prco td { padding:13px 12px; border-bottom:1px solid #e2e8df; text-align:right; vertical-align:top; font-variant-numeric:tabular-nums; }
.prco thead th { background:#1d4b34; color:#fff; font-weight:600; }
.prco th:first-child { text-align:left; }
.prco tbody th { font-weight:600; }
.prco td small { display:block; color:#4b614f; font-size:.74rem; margin-top:5px; }
.prco tfoot th,.prco tfoot td { background:#eef2e9; border-bottom:none; font-weight:700; }
.prco .prco-footnote { font-size:.82rem; color:#365642; }
.prco .prco-warning { background:#fff5d9; color:#644818; border-left:3px solid #a47f27; border-radius:4px; padding:10px 12px; }
.prco .prco-error { background:#fff0ec; color:#842c22; padding:12px; border-radius:7px; }
@media(max-width:640px) { .prco { padding:15px; } .prco .prco-header button { width:100%; } .prco .prco-scope { align-items:stretch; flex-direction:column; } .prco select { width:100%; } }
`;

// Parent must mount in the administrator tracker tab and explicitly pass
// isAdmin={true}. The server independently enforces role and resource access.
// refreshKey can be incremented after imports/corrections/rate-card changes.
// onRefresh is an optional notification for a parent summary refresh.
export default function ProjectRoleCostOverview({ session, projectId, projectName, isAdmin = false, refreshKey = 0, onRefresh }) {
  const token = session?.access_token || "";
  const scopeKey = `${isAdmin === true}:${projectId || ""}:${token}`;
  const latestScopeRef = useRef(scopeKey);
  latestScopeRef.current = scopeKey;
  const activeRequestRef = useRef(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [scope, setScope] = useState("current");
  const canLoad = isAdmin === true && Boolean(projectId && token);
  const [state, setState] = useState(() => blankState(scopeKey, canLoad));
  const view = state.scopeKey === scopeKey ? state : blankState(scopeKey, canLoad);

  useEffect(() => {
    const controller = new AbortController();
    const requestScope = { scopeKey, controller };
    activeRequestRef.current = requestScope;
    const isCurrent = () => activeRequestRef.current === requestScope && latestScopeRef.current === scopeKey && !controller.signal.aborted;
    setState(blankState(scopeKey, canLoad));
    if (canLoad) {
      (async () => {
        try {
          const response = await fetch(`/api/admin/project-tracker-role-costs?projectId=${encodeURIComponent(projectId)}`, {
            method: "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          });
          const data = await response.json();
          if (!isCurrent()) return;
          if (!response.ok) throw new Error(data.error || "Could not load the role cost overview.");
          if (!data.overview || String(data.projectId).toLowerCase() !== String(projectId).toLowerCase() ||
            String(data.overview.projectId).toLowerCase() !== String(projectId).toLowerCase() ||
            !SCOPES.every(([key]) => Array.isArray(data.overview[key]?.rows) && data.overview[key]?.totals)) {
            throw new Error("The project overview could not be verified. Please refresh.");
          }
          setState({ scopeKey, loading: false, error: "", data });
        } catch (error) {
          if (!isCurrent() || error.name === "AbortError") return;
          setState({ scopeKey, loading: false, error: error.message || "Could not load the role cost overview.", data: null });
        }
      })();
    }
    return () => { controller.abort(); if (activeRequestRef.current === requestScope) activeRequestRef.current = null; };
  }, [projectId, token, isAdmin, scopeKey, canLoad, refreshKey, reloadVersion]);

  if (isAdmin !== true) return null;
  const overview = view.data?.overview;
  const position = overview?.[scope];
  const differentRates = position?.rows.some((row) => row.historicalRatesDiffer);
  const reconciliation = overview?.allocationReconciliation?.[scope];
  const refresh = () => {
    setReloadVersion((value) => value + 1);
    // A callback failure must not suppress the local read-only refresh.
    try { Promise.resolve(onRefresh?.()).catch(() => {}); } catch { /* Parent owns its own error display. */ }
  };

  return <section className="prco" aria-label="Role Cost Overview" aria-busy={view.loading}>
    <style>{STYLES}</style>
    <div className="prco-header">
      <div><h3>Role Cost Overview</h3><p>{projectName || view.data?.projectName || "Project"} · Administrator-only · All amounts in AUD</p></div>
      <button type="button" onClick={refresh} disabled={!canLoad || view.loading}>Refresh role costs</button>
    </div>
    {!projectId ? <p role="status">Select a project to view recorded role costs.</p> : !token ? <p role="status">Sign in again to view role costs.</p> : null}
    {view.loading ? <p role="status">Loading complete recorded actuals…</p> : null}
    {view.error ? <p className="prco-error" role="alert">{view.error}</p> : null}
    {overview && position ? <>
      <div className="prco-scope"><label htmlFor="prco-scope">Reporting basis</label><select id="prco-scope" value={scope} onChange={(event) => setScope(event.target.value)}>
        {SCOPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></div>
      <p>{overview.basis[scope]}</p>
      <p className="prco-footnote">{position.entryCount} recorded entries · {position.assignedEntryCount} assigned · {position.unassignedEntryCount} explicit unassigned. Planned Activity updates are not added.</p>
      {position.entryCount === 0 ? <p role="status">No recorded actuals for this reporting basis.</p> : null}
      {!overview.chargeRatesConfirmed ? <p className="prco-warning">No confirmed project labour rate card. Recorded spend still uses preserved snapshots or the existing legacy fallback, not company suggestions.</p> : null}
      {reconciliation?.differs ? <p className="prco-warning">Stored allocation summaries differ from these recorded-entry actuals by {number(reconciliation.hoursDifference)} h and {money(reconciliation.chargeOutSpendDifference)}. No stored totals have been changed; review allocation recalculation before comparing project balances.</p> : null}
      {scope === "current" && overview.otherHistory.entryCount > 0 ? <p className="prco-warning">{overview.otherHistory.entryCount} legacy/orphan/partially assigned entries are retained in Other recorded history and Lifetime only, not current funding.</p> : null}
      <div className="prco-scroll" tabIndex={0} role="region" aria-label="Role costs table; scroll horizontally on smaller screens">
        <table>
          <caption>{SCOPES.find(([key]) => key === scope)?.[1]} — recorded-entry costs</caption>
          <thead><tr><th scope="col">Role</th><th scope="col">Hours/km</th><th scope="col">Project charge-out rate</th><th scope="col">Charge-out spend</th><th scope="col">Internal rate</th><th scope="col">Internal spend</th><th scope="col">Profit</th><th scope="col">Profit margin%</th></tr></thead>
          <tbody>{position.rows.map((row) => <tr key={row.role}>
            <th scope="row">{row.role}</th>
            <td>{number(row.quantity)} {row.unit}</td>
            <td>{row.currentChargeRate === null ? row.unit === "km" ? "Not configured" : "Not confirmed" : `${money(row.currentChargeRate)}/${row.unit}`}
              {row.historicalRatesDiffer ? <small>Applied effective: {money(row.appliedEffectiveChargeRate)}/{row.unit}</small> : null}
            </td>
            <td>{money(row.chargeOutSpend)}</td><td>{row.internalRate === null ? "Not configured" : `${money(row.internalRate)}/${row.unit}`}</td>
            <td>{money(row.internalSpend)}</td><td>{row.profit === null ? "Not configured" : money(row.profit)}</td><td>{margin(row.profitMarginPercent)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th scope="row">{position.totals.marginScope}</th><td>{number(position.hours)} h<br />{number(position.kilometres)} km</td><td>—</td><td>{money(position.totals.chargeOutSpend)}</td><td>—</td><td>{money(position.totals.internalSpend)}</td><td>{money(position.totals.profit)}</td><td>{margin(position.totals.profitMarginPercent)}</td></tr></tfoot>
        </table>
      </div>
      {differentRates ? <p className="prco-footnote">Current confirmed card rates differ from rates applied to recorded work. Spend preserves authoritative historical snapshots and the unchanged labour legacy fallback; it is not hours or kilometres multiplied by today's card. Applied effective rates are spend ÷ recorded hours or km.</p> : null}
      {!overview.mileage.chargeRateConfigured ? <p className="prco-footnote">Project mileage charge-out rate: <strong>Not configured.</strong> An administrator must confirm this project's $/km rate for new billable mileage. This overview never guesses a rate or creates charges.</p> : null}
      {position.referenceOnlyKilometres > 0 ? <p className="prco-footnote"><strong>Historical reference-only mileage:</strong> {number(position.referenceOnlyKilometres)} km have no trusted mileage charge snapshot and retain the prior zero-charge policy. They are not repriced using today's card. Internal mileage cost is included at the confirmed $0.90/km policy.</p> : null}
      {!overview.mileage.internalRateConfigured ? <p className="prco-footnote"><strong>Labour-only pending mileage internal rate:</strong> Mileage values are excluded from the stated overall margin until the internal rate is configured.</p> : null}
      <p className="prco-footnote">Fixed internal rates: Senior Ecologist $81/h · Ecologist $75/h · Project Manager $70/h · Mileage $0.90/km on all recorded kilometres. Mileage revenue uses only trusted per-entry snapshots; an explicit zero snapshot is non-billable. Profit = charge-out spend − internal spend. Total margin = total profit ÷ total charge-out spend, not the average of role percentages. A zero charge-out denominator has no margin (—). This is not accepted-budget forecast profit.</p>
    </> : null}
  </section>;
}
