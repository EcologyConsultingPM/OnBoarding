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
      const response = await fetch("/api/portal-visibility?scope=manage", {
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
    if (showAll) return resources.filter((resource) => resource.portal === "staff");
    const root = resources.find((resource) => resource.key === resourceKey);
    if (!root) return [];
    return [root, ...resources.filter((resource) => resource.parent === resourceKey)];
  }, [resources, resourceKey, showAll]);

  useEffect(() => {
    if (managedResources.some((resource) => resource.key === selectedResource)) return;
    setSelectedResource(managedResources[0]?.key || resourceKey);
  }, [managedResources, resourceKey, selectedResource]);

  const selected = resources.find((resource) => resource.key === selectedResource);

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
              <ShieldCheck size={14} /> Aaron-only access control
            </span>
            <h2 id="pvm-title">Portal visibility</h2>
            <p>Choose a portal area, then use the eye control to grant or remove visibility for an active Staff List member.</p>
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
                </div>
              );
            })}
            {!staff.length ? <p className="pvm-empty">No active staff are available in the Staff List yet.</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
