"use client";

import { useEffect, useRef, useState } from "react";

const RATE_FIELDS = [
  { key: "project_manager_rate", label: "Project Manager" },
  { key: "senior_ecologist_rate", label: "Senior Ecologist" },
  { key: "ecologist_rate", label: "Ecologist" },
];
const emptyDraft = () => Object.fromEntries(RATE_FIELDS.map(({ key }) => [key, ""]));
const validRate = (value) => value !== "" && /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(String(value)) &&
  Number.isFinite(Number(value)) && Number(value) >= 0.01 && Number(value) <= 1000000;

function draftFrom(values) {
  return Object.fromEntries(RATE_FIELDS.map(({ key }) => {
    const value = values?.[key];
    return [key, value !== null && value !== undefined && validRate(value) ? Number(value).toFixed(2) : ""];
  }));
}

function blankState(scopeKey, loading = false) {
  return { scopeKey, rates: null, draft: emptyDraft(), loading, loaded: false, saving: false, conflict: false, error: "", message: "" };
}

function timestampLabel(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-AU") : value;
}

// Mounted only in the administrator's Project Operations setup card. The API
// independently enforces administrator and admin.projects.setup access.
export default function ProjectChargeRates({ session, projectId, projectName }) {
  const token = session?.access_token || "";
  const scopeKey = `${projectId || ""}:${token}`;
  const latestScopeRef = useRef(scopeKey);
  latestScopeRef.current = scopeKey;
  const activeRequestRef = useRef(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState(() => blankState(scopeKey, Boolean(projectId && token)));
  // Hide old project data immediately, even before the next effect is run.
  const view = state.scopeKey === scopeKey ? state : blankState(scopeKey, Boolean(projectId && token));

  useEffect(() => {
    const controller = new AbortController();
    const scope = { scopeKey, controller, saving: false };
    activeRequestRef.current = scope;
    const isCurrent = () => activeRequestRef.current === scope && latestScopeRef.current === scopeKey && !controller.signal.aborted;
    setState(blankState(scopeKey, Boolean(projectId && token)));

    if (projectId && token) {
      (async () => {
        try {
          const response = await fetch(`/api/admin/project-charge-rates?projectId=${encodeURIComponent(projectId)}`, {
            method: "GET",
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const data = await response.json();
          if (!isCurrent()) return;
          if (!response.ok) {
            setState((current) => ({ ...current, loading: false, conflict: response.status === 409, error: data.error || "Could not load project charge rates." }));
            return;
          }
          if (data.rates && String(data.rates.project_id).toLowerCase() !== String(projectId).toLowerCase()) {
            throw new Error("The server returned rates for a different project. Reload rates before continuing.");
          }
          const rates = data.rates || null;
          const values = rates?.confirmed_at ? rates : data.suggestions;
          setState({ ...blankState(scopeKey), rates, draft: draftFrom(values), loaded: true });
        } catch (error) {
          if (!isCurrent() || error.name === "AbortError") return;
          setState((current) => ({ ...current, loading: false, error: error.message || "Could not load project charge rates." }));
        }
      })();
    }

    return () => {
      controller.abort();
      if (activeRequestRef.current === scope) activeRequestRef.current = null;
    };
  }, [projectId, token, scopeKey, reloadVersion]);

  const save = async () => {
    const scope = activeRequestRef.current;
    if (!projectId || !token || !scope || scope.scopeKey !== scopeKey || scope.saving ||
        view.loading || !view.loaded || view.conflict) return;
    if (!RATE_FIELDS.every(({ key }) => validRate(view.draft[key]))) {
      setState((current) => ({ ...current, error: "Enter all three rates from $0.01 to $1,000,000 per hour with no more than two decimal places.", message: "" }));
      return;
    }
    const isCurrent = () => activeRequestRef.current === scope && latestScopeRef.current === scopeKey && !scope.controller.signal.aborted;
    scope.saving = true;
    setState((current) => ({ ...current, saving: true, error: "", message: "" }));
    try {
      // This click is the only write path. Company suggestions remain unconfirmed
      // until the administrator explicitly saves this project's three rates.
      const response = await fetch("/api/admin/project-charge-rates", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        signal: scope.controller.signal,
        body: JSON.stringify({
          projectId,
          rates: Object.fromEntries(RATE_FIELDS.map(({ key }) => [key, Number(view.draft[key])])),
          expectedUpdatedAt: view.rates?.updated_at || null,
        }),
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) {
        setState((current) => ({
          ...current,
          saving: false,
          conflict: response.status === 409,
          error: response.status === 409
            ? `${data.error || "These rates changed or the database migration is pending."} Reload rates and review them before saving again.`
            : data.error || "Could not save project charge rates.",
        }));
        return;
      }
      if (!data.rates?.confirmed_at || !data.rates.updated_at ||
          String(data.rates.project_id).toLowerCase() !== String(projectId).toLowerCase()) {
        throw new Error("The saved card could not be verified. Reload rates before continuing.");
      }
      setState((current) => ({
        ...current,
        rates: data.rates,
        draft: draftFrom(data.rates),
        saving: false,
        conflict: false,
        message: "Rates saved and confirmed for this project. Future entries will use these rates; historical rates and budgets are unchanged.",
      }));
    } catch (error) {
      if (!isCurrent() || error.name === "AbortError") return;
      // A lost response may follow a successful write. Do not guess or retry it.
      setState((current) => ({ ...current, saving: false, conflict: true, error: `${error.message || "Could not verify the save."} Reload rates before saving again.` }));
    } finally {
      scope.saving = false;
    }
  };

  if (!projectId) {
    return <div className="aps-form project-charge-rates"><h3>Project charge rates</h3><p className="aps-empty">Save project first to confirm charge rates for this job.</p></div>;
  }

  const disabled = !token || view.loading || !view.loaded || view.saving || view.conflict;
  const allRatesValid = RATE_FIELDS.every(({ key }) => validRate(view.draft[key]));

  return (
    <div className="aps-form project-charge-rates" role="group" aria-label="Project charge rates" aria-busy={view.loading || view.saving}>
      <h3>Project charge rates</h3>
      <p>Confirm the hourly charge rates for {projectName || "this project"}. Charges can differ by job.</p>
      {!token ? <p className="aps-error" role="alert">Sign in again to manage project charge rates.</p> : null}
      {view.loading ? <p role="status">Loading project charge rates…</p> : null}
      {view.loaded ? (
        view.rates?.confirmed_at ? (
          <p className="aps-success" role="status">
            Confirmed for this project · <time dateTime={view.rates.confirmed_at}>{timestampLabel(view.rates.confirmed_at)}</time>
            {view.rates.updated_at && view.rates.updated_at !== view.rates.confirmed_at ? <span> · Updated <time dateTime={view.rates.updated_at}>{timestampLabel(view.rates.updated_at)}</time></span> : null}
          </p>
        ) : <p role="status">Suggested company rates — not yet confirmed for this project</p>
      ) : null}
      <div className="aps-three">
        {RATE_FIELDS.map(({ key, label }) => (
          <label className="aps-field" key={key}>
            {label} ($/hour)
            <input
              name={key}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max="1000000"
              required
              value={view.draft[key]}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                setState((current) => ({ ...current, draft: { ...current.draft, [key]: value }, error: "", message: "" }));
              }}
            />
          </label>
        ))}
      </div>
      {view.loaded && !allRatesValid ? <p className="aps-empty">All three positive rates are required before saving. Missing company suggestions are left blank.</p> : null}
      <p className="aps-empty">
        Read-only charging roles: Gerard Dwyer, Emily Zouch and Simon Vinson — Senior Ecologist;
        Grace Stephenson, Aaron Dooley and Tony Webster — Project Manager; all other staff — Ecologist.
        The Job # resolves the project for charging. Changes apply to future entries only and do not overwrite historical rates or budgets.
      </p>
      {view.error ? <p className="aps-error" role="alert">{view.error}</p> : null}
      {view.message ? <p className="aps-success" role="status">{view.message}</p> : null}
      <div className="aps-two">
        <button type="button" className="aps-primary" disabled={disabled || !allRatesValid} onClick={save}>
          {view.saving ? "Saving rates…" : "Save rates for this project"}
        </button>
        <button type="button" className="ec-btn ec-btn--neutral" disabled={!token || view.loading || view.saving} onClick={() => setReloadVersion((value) => value + 1)}>
          Reload rates and suggestions
        </button>
      </div>
    </div>
  );
}
