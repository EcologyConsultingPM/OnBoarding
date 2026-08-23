"use client";

import { useState, useEffect, useRef } from "react";
import { UserPlus, ShieldCheck, User, Users2, Copy, Check, AlertCircle, EyeOff } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

// New-staff access setup. Creates (or resets) an account, sets the person's
// name, and grants the chosen access level. The temp password is shown once
// and auto-hides after 2 minutes so it can't linger on a shared screen.
export default function PortalManagement({ children }) {
  const { session } = useAuth();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", accessLevel: "staff" });
  const [issued, setIssued] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!issued) return;
    setSecondsLeft(120);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => { if (s <= 1) { clearInterval(timerRef.current); setIssued(null); return 0; } return s - 1; });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [issued]);

  const submit = async () => {
    setError(""); setCopied(false);
    const email = form.email.trim().toLowerCase();
    if (!email.endsWith("@ecologyconsulting.au")) { setError("Email must be an @ecologyconsulting.au address."); return; }
    if (!form.firstName.trim()) { setError("First name is required."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invite-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, firstName: form.firstName.trim(), lastName: form.lastName.trim(), accessLevel: form.accessLevel, forceChange: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not set up this account.");
      setIssued({ email: data.email, tempPassword: data.tempPassword, accessLevel: data.accessLevel, name: data.name });
      setForm({ firstName: "", lastName: "", email: "", accessLevel: "staff" });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const copy = () => { if (issued) { navigator.clipboard?.writeText(issued.tempPassword); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  const accessLabel = { staff: "Staff portal only", admin: "Admin portal only", both: "Staff + Admin" };

  return (
    <div className="pm">
      <header className="pm-hero">
        <span>Ecology Consulting · Portal stewardship</span>
        <h1>Portal management</h1>
        <p>Set up new staff access, manage roles and administrators, staff development &amp; progress, and draft onboarding paths.</p>
      </header>

      {/* New staff access */}
      <section className="pm-card">
        <h2><UserPlus size={17} /> Set up new staff access</h2>
        <p className="pm-sub">Create an account and choose which portal the person can use. A one-time temporary password is generated — relay it to them directly; they'll set their own password on first sign-in.</p>

        <div className="pm-grid">
          <label className="pm-field"><span>First name</span><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
          <label className="pm-field"><span>Last name</span><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
          <label className="pm-field pm-full"><span>Email (@ecologyconsulting.au)</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="first.last@ecologyconsulting.au" /></label>
        </div>

        <div className="pm-access">
          <span className="pm-access-label">Access level</span>
          <div className="pm-access-opts">
            {[
              { v: "staff", Icon: User, label: "Staff portal", desc: "Onboarding, forms, learning" },
              { v: "admin", Icon: ShieldCheck, label: "Admin portal", desc: "Management & oversight" },
              { v: "both", Icon: Users2, label: "Both", desc: "Staff + admin access" },
            ].map(({ v, Icon, label, desc }) => (
              <button key={v} type="button" className={`pm-access-opt ${form.accessLevel === v ? "sel" : ""}`} onClick={() => setForm({ ...form, accessLevel: v })}>
                <Icon size={16} />
                <div className="pm-access-opt-t">{label}</div>
                <div className="pm-access-opt-d">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="pm-error"><AlertCircle size={15} /> {error}</p> : null}

        <button className="pm-submit" onClick={submit} disabled={busy}><UserPlus size={15} /> {busy ? "Setting up…" : "Create access & generate password"}</button>

        {issued && (
          <div className="pm-issued">
            <div className="pm-issued-head">
              <span>Access created — copy the password now, hides in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</span>
              <button onClick={() => setIssued(null)}><EyeOff size={13} /> Hide now</button>
            </div>
            <div className="pm-issued-row"><strong>{issued.name || issued.email}</strong> · {accessLabel[issued.accessLevel] || "Staff portal"}</div>
            <div className="pm-issued-email">{issued.email}</div>
            <div className="pm-issued-pw">
              <code>{issued.tempPassword}</code>
              <button onClick={copy}>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
            </div>
            <div className="pm-issued-bar"><div style={{ width: `${(secondsLeft / 120) * 100}%` }} /></div>
          </div>
        )}
      </section>

      {/* Existing management panels passed through */}
      {children}
    </div>
  );
}
