"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

export default function PortalVisibilityManager({ resourceKey, onClose, showAll = false }) {
  const { session } = useAuth();
  const [resources, setResources] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selectedResource, setSelectedResource] = useState(resourceKey);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const resources = showAll ? "all" : resourceKey;
      const response = await fetch(`/api/portal-visibility?scope=manage&resources=${encodeURIComponent(resources)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load visibility controls.");
      setResources(data.resources || []);
      setStaff(data.staff || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load visibility controls.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const managedResources = useMemo(() => {
    if (showAll) return resources;
    const root = resources.find((resource) => resource.key === resourceKey);
    if (!root) return [];
    return [root, ...resources.filter((resource) => resource.parent === resourceKey)];
  }, [resources, resourceKey, showAll]);

  useEffect(() => {
    if (managedResources.some((resource) => resource.key === selectedResource)) return;
    setSelectedResource(managedResources[0]?.key || resourceKey);
  }, [managedResources, resourceKey, selectedResource]);

  const selected = resources.find((resource) => resource.key === selectedResource);

  const CAPACITY_VIEW = "admin.projects.capacity";
  const CAPACITY_EDIT = "admin.projects.capacity.edit";
  const REQUIRED_STAFF_FORMS = new Set(["staff.forms", "staff.forms.governance"]);
  const capacityPlannerSelected = selectedResource === CAPACITY_VIEW;
  const requiredStaffFormsSelected = REQUIRED_STAFF_FORMS.has(selectedResource);

  const update = async (person, isVisible) => {
    if (!session?.access_token || !selectedResource) return;
    const actionKey = `${person.id}:${selectedResource}`;
    setSaving(actionKey);
    setError("");
    try {
      const response = await fetch("/api/portal-visibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: person.id,
          resourceKey: selectedResource,
          isVisible,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update visibility.");
      setStaff((current) =>
        current.map((item) =>
          item.id === person.id
            ? {
                ...item,
                visibility: { ...item.visibility, [selectedResource]: data.visibility[selectedResource] },
                overrides: { ...item.overrides, [selectedResource]: isVisible },
              }
            : item,
        ),
      );
      setMessage(`${person.name || person.email} can ${isVisible ? "now" : "no longer"} see ${selected?.label || "this area"}.`);
      setTimeout(() => setMessage(""), 2800);
    } catch (err) {
      setError(err.message || "Could not update visibility.");
    } finally {
      setSaving("");
    }
  };

  const updateCapacityLevel = async (person, level) => {
    if (!session?.access_token || person.isPrimary) return;
    const actionKey = `${person.id}:capacity`;
    setSaving(actionKey);
    setError("");
    try {
      const changes = [
        { resourceKey: CAPACITY_VIEW, isVisible: level !== "none" },
        { resourceKey: CAPACITY_EDIT, isVisible: level === "full" },
      ];
      for (const change of changes) {
        const response = await fetch("/api/portal-visibility", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ userId: person.id, ...change }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not update Capacity Planner access.");
      }
      await load();
      setMessage(`${person.name || person.email} now has ${level === "full" ? "Full" : level === "read" ? "Read-only" : "No"} Capacity Planner access.`);
      setTimeout(() => setMessage(""), 2800);
    } catch (err) {
      setError(err.message || "Could not update Capacity Planner access.");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="pvm-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pvm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pvm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pvm-header">
          <div>
            <span className="pvm-kicker">
              <ShieldCheck size={14} /> Protected administrator access control
            </span>
            <h2 id="pvm-title">Portal visibility</h2>
            <p>Choose a Staff or Admin portal area, then use the eye control to grant or remove visibility for an eligible active staff member. Quote financial values remain a separately controlled Admin sub-domain.</p>
          </div>
          <button type="button" className="pvm-close" onClick={onClose} aria-label="Close visibility controls">
            <X size={18} />
          </button>
        </header>

        {managedResources.length > 1 ? (
          <div className="pvm-resource-list" role="tablist" aria-label="Area visibility controls">
            {managedResources.map((resource) => (
              <button
                type="button"
                role="tab"
                key={resource.key}
                aria-selected={selectedResource === resource.key}
                className={selectedResource === resource.key ? "selected" : ""}
                onClick={() => setSelectedResource(resource.key)}
              >
                {resource.label.replace(/^.*? · /, "")}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="pvm-error">{error}</p> : null}
        {message ? <p className="pvm-success"><CheckCircle2 size={14} /> {message}</p> : null}

        {loading ? (
          <p className="pvm-loading"><Loader2 className="spin" size={16} /> Loading active Staff List…</p>
        ) : (
          <div className="pvm-staff-list">
            {staff.map((person) => {
              const permanentlyVisible = person.isPrimary === true;
              const visible = permanentlyVisible || person.visibility?.[selectedResource] === true;
              const actionKey = `${person.id}:${selectedResource}`;
              const isSaving = saving === actionKey;
              return (
                <div className="pvm-staff-row" key={person.id}>
                  <div>
                    <strong>{person.name || person.email}</strong>
                    <span>{person.email}{person.phone ? ` · ${person.phone}` : ""}</span>
                  </div>
                  {requiredStaffFormsSelected ? (
                    <span className="pvm-always-visible">Always visible to staff</span>
                  ) : capacityPlannerSelected ? (
                    <label className="pvm-access-level">
                      <span>Planner access</span>
                      <select
                        disabled={Boolean(saving) || permanentlyVisible}
                        value={permanentlyVisible ? "full" : person.visibility?.[CAPACITY_EDIT] === true ? "full" : visible ? "read" : "none"}
                        onChange={(event) => updateCapacityLevel(person, event.target.value)}
                      >
                        <option value="none">No access</option>
                        <option value="read">Read-only</option>
                        <option value="full">Full access</option>
                      </select>
                    </label>
                  ) : (
                    <button
                      type="button"
                      className={`pvm-eye${visible ? " visible" : " hidden"}`}
                      disabled={Boolean(saving) || permanentlyVisible}
                      onClick={() => update(person, !visible)}
                      aria-label={permanentlyVisible ? "Primary administrator access is always visible" : `${visible ? "Remove" : "Grant"} ${selected?.label || "portal area"} access for ${person.name || person.email}`}
                      title={permanentlyVisible ? "Primary administrator access is always visible" : visible ? "Visible — click to lock" : "Locked — click to allow"}
                    >
                      {isSaving ? <Loader2 className="spin" size={16} /> : visible ? <Eye size={16} /> : <EyeOff size={16} />}
                      <span>{permanentlyVisible ? "Primary admin" : visible ? "Visible" : "Locked"}</span>
                    </button>
                  )}
                </div>
              );
            })}
            {!staff.length ? <p className="pvm-empty">No eligible active staff are available for this portal area yet.</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
