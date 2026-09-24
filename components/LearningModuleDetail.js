"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  Flag,
  ListChecks,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  LEARNING_CYCLE,
  LEARNING_LEVELS,
  getModuleReadiness,
  normaliseModuleContent,
} from "../lib/learningModule";
import { useAuth } from "../lib/AuthProvider";

const SECTION_GROUPS = [
  {
    key: "learn",
    eyebrow: "LEARN",
    title: "Build professional understanding",
    Icon: BookOpen,
    fields: [
      ["why", "Why does this matter?", "Explain the project, evidence, client and regulatory purpose."],
      ["what", "What is it?", "Define terminology, concepts, context and boundaries."],
    ],
  },
  {
    key: "do",
    eyebrow: "DO",
    title: "Apply a controlled process",
    Icon: ListChecks,
    fields: [
      ["when", "When do I use it?", "Place this task in the project lifecycle."],
      ["how", "How do I do it?", "Set out the practical sequence: prepare, check, perform, record, QA, handover and escalate.", "list"],
    ],
  },
  {
    key: "check",
    eyebrow: "CHECK",
    title: "Protect quality and traceability",
    Icon: FileCheck2,
    fields: [
      ["good_practice", "What does good look like?", "Describe the standard for records, observations, data and communication."],
      ["common_errors", "What commonly goes wrong?", "Identify realistic mistakes, uncertainty and quality risks."],
      ["evidence", "What evidence do I retain?", "List the records that make the work traceable.", "list"],
      ["references", "Reference material", "Optional job aids, legislation or technical sources.", "list", true],
    ],
  },
  {
    key: "escalate",
    eyebrow: "ESCALATE",
    title: "Work within authority",
    Icon: ShieldAlert,
    fields: [
      ["decision_scope", "What can I decide?", "State the decisions the learner may make inside their defined scope."],
      ["escalation", "What must I escalate?", "State triggers for senior, project, WHS, client, specialist or regulatory review."],
    ],
  },
  {
    key: "demonstrate",
    eyebrow: "DEMONSTRATE",
    title: "Evidence capability before authorisation",
    Icon: ClipboardCheck,
    fields: [
      ["assessment", "Application-based assessment", "Use a realistic scenario that tests evidence, procedure, escalation and record quality."],
      ["competency_statement", "A competent staff member can…", "Write observable behaviours that show practical capability."],
    ],
  },
];

const APPROVAL_LABEL = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  archived: "Archived",
};

function ListField({ label, hint, values, onChange, readOnly }) {
  const list = Array.isArray(values) ? values : [];
  if (readOnly) {
    return (
      <section className="lm-field lm-field--read">
        <h3>{label}</h3>
        <p className="lm-field-hint">{hint}</p>
        {list.length ? <ul>{list.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul> : <p className="lm-not-set">Not yet specified.</p>}
      </section>
    );
  }
  const update = (index, value) => {
    const next = [...list];
    next[index] = value;
    onChange(next);
  };
  return (
    <section className="lm-field">
      <label>{label}</label>
      <p className="lm-field-hint">{hint}</p>
      <div className="lm-list-editor">
        {list.map((value, index) => (
          <div key={index} className="lm-list-row">
            <span>{index + 1}</span>
            <input value={value} onChange={(event) => update(index, event.target.value)} placeholder="Add a clear, observable point" />
            <button type="button" onClick={() => onChange(list.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${label} item ${index + 1}`}>Remove</button>
          </div>
        ))}
        <button type="button" className="lm-add-row" onClick={() => onChange([...list, ""])}>Add item</button>
      </div>
    </section>
  );
}

function TextField({ label, hint, value, onChange, readOnly }) {
  if (readOnly) {
    return (
      <section className="lm-field lm-field--read">
        <h3>{label}</h3>
        <p className="lm-field-hint">{hint}</p>
        {value ? <p className="lm-reading-copy">{value}</p> : <p className="lm-not-set">Not yet specified.</p>}
      </section>
    );
  }
  return (
    <section className="lm-field">
      <label>{label}</label>
      <p className="lm-field-hint">{hint}</p>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} placeholder="Write clear, practical guidance for the learner" />
    </section>
  );
}

function Flow({ compact = false }) {
  return (
    <ol className={`lm-flow ${compact ? "lm-flow--compact" : ""}`} aria-label="Learning and competency workflow">
      {LEARNING_CYCLE.map((step, index) => (
        <li key={step.key}>
          <span>{index + 1}</span>
          <strong>{step.label}</strong>
          {index < LEARNING_CYCLE.length - 1 ? <ChevronRight aria-hidden="true" size={15} /> : null}
        </li>
      ))}
    </ol>
  );
}

export default function LearningModuleDetail({ node, audience = "admin", onBack, onSaved }) {
  const { session } = useAuth();
  const admin = audience === "admin";
  const [module, setModule] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!node?.id || !session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const query = audience === "staff" ? "?audience=staff" : "";
      const response = await fetch(`/api/ld/${node.id}${query}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load this learning module.");
      const next = { ...data.node, module_content: normaliseModuleContent(data.node.module_content) };
      setModule(next);
      setDraft({ title: next.title || "", description: next.description || "", module_content: next.module_content });
    } catch (requestError) {
      setError(requestError.message || "Could not load this learning module.");
    } finally {
      setLoading(false);
    }
  }, [audience, node?.id, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const readiness = useMemo(() => getModuleReadiness(draft?.module_content), [draft?.module_content]);
  const updateContent = (key, value) => {
    setDraft((current) => ({
      ...current,
      module_content: { ...current.module_content, [key]: value },
    }));
  };

  const save = async () => {
    if (!draft?.title.trim()) { setError("A module title is required."); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/ld/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim(),
          module_content: normaliseModuleContent(draft.module_content),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save this learning module.");
      const next = { ...data.node, module_content: normaliseModuleContent(data.node.module_content) };
      setModule(next);
      setDraft({ title: next.title || "", description: next.description || "", module_content: next.module_content });
      onSaved?.(next);
      setMessage("Module draft saved.");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (requestError) {
      setError(requestError.message || "Could not save this learning module.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="lm-loading"><Loader2 className="spin" size={18} /> Loading learning module…</div>;
  if (error && !module) return <div className="lm-error"><AlertCircle size={16} /> {error}<button type="button" onClick={load}>Try again</button></div>;
  if (!module || !draft) return null;

  const content = admin ? draft.module_content : module.module_content;
  const level = LEARNING_LEVELS.find((option) => option.value === content.learning_level)?.label || "Foundation";

  return (
    <section className={`lm-detail ${admin ? "lm-detail--admin" : "lm-detail--staff"}`}>
      <button type="button" className="lm-back" onClick={onBack}><ArrowLeft size={15} /> Back to library</button>
      <header className="lm-hero">
        <div>
          <span className="lm-kicker">{admin ? "Controlled learning module" : "Learning module"}</span>
          {admin ? <input className="lm-title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="Module title" /> : <h1>{module.title}</h1>}
          {admin ? <textarea className="lm-summary-input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} placeholder="A concise module purpose for the library" aria-label="Module summary" /> : <p>{module.description || "A structured learning module for safe, evidence-based ecological practice."}</p>}
        </div>
        <aside>
          <span className={`lm-status ${module.approval_status}`}>{APPROVAL_LABEL[module.approval_status] || "Draft"}</span>
          <span className="lm-level">{level}</span>
        </aside>
      </header>

      <section className="lm-assurance" aria-label="Learning assurance">
        <div><ShieldCheck size={18} /><span><strong>Completion is not authorisation.</strong> Learning must be practised, demonstrated and reviewed before a person is authorised to work independently.</span></div>
        <Flow compact />
      </section>

      {admin ? <section className="lm-identity">
        <div className="lm-section-heading"><Sparkles size={17} /><div><span>Module control</span><h2>Set the learning boundary</h2></div></div>
        <div className="lm-identity-grid">
          <label>Learning level<select value={content.learning_level} onChange={(event) => updateContent("learning_level", event.target.value)}>{LEARNING_LEVELS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Authorised scope<textarea rows={3} value={content.scope} onChange={(event) => updateContent("scope", event.target.value)} placeholder="What work may be undertaken after competency is verified?" /></label>
          <label>Supervision requirement<textarea rows={3} value={content.supervision} onChange={(event) => updateContent("supervision", event.target.value)} placeholder="When is direct supervision, review or sign-off required?" /></label>
        </div>
      </section> : <section className="lm-boundaries">
        <article><Flag size={17} /><div><span>Authorised scope</span><p>{content.scope || "Your authorised scope is confirmed only after formal competency verification."}</p></div></article>
        <article><ShieldAlert size={17} /><div><span>Supervision & review</span><p>{content.supervision || "Follow the project’s agreed supervision and technical-review arrangements."}</p></div></article>
      </section>}

      {SECTION_GROUPS.map(({ key, eyebrow, title, Icon, fields }) => (
        <section key={key} className={`lm-section lm-section--${key}`}>
          <div className="lm-section-heading"><Icon size={18} /><div><span>{eyebrow}</span><h2>{title}</h2></div></div>
          <div className="lm-fields">
            {fields.map(([fieldKey, label, hint, type]) => type === "list"
              ? <ListField key={fieldKey} label={label} hint={hint} values={content[fieldKey]} readOnly={!admin} onChange={(value) => updateContent(fieldKey, value)} />
              : <TextField key={fieldKey} label={label} hint={hint} value={content[fieldKey]} readOnly={!admin} onChange={(value) => updateContent(fieldKey, value)} />)}
          </div>
        </section>
      ))}

      {admin ? <footer className="lm-savebar">
        <div className={readiness.ready ? "ready" : "incomplete"}>
          {readiness.ready ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
          <span><strong>{readiness.ready ? "Ready for review" : "Draft checklist incomplete"}</strong>{readiness.ready ? " This module has every required learning-control field." : ` Add: ${readiness.missing.join(", ")}.`}</span>
        </div>
        {error ? <p className="lm-error"><AlertCircle size={15} /> {error}</p> : null}
        {message ? <p className="lm-success"><CheckCircle2 size={15} /> {message}</p> : null}
        <button type="button" onClick={save} disabled={saving}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}{saving ? "Saving…" : "Save module draft"}</button>
      </footer> : null}
    </section>
  );
}
