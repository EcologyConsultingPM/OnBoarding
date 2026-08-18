"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Users, ArrowLeft } from "lucide-react";
import { useAuth } from "../../lib/AuthProvider";
import { isSupabaseConfigured } from "../../lib/supabaseClient";

const C = {
  green900: "#16371f", green700: "#24522a", green400: "#3d7a35", green200: "#6ea24f",
  cream: "#cfe3b8", ink: "#23301f", inkSoft: "#6b755f", line: "#e3e6d8", bg: "#f4f4ee", rust: "#c05a4a",
};
const FONT = "'Nunito Sans', 'Helvetica Neue', sans-serif";

const PORTALS = {
  admin: {
    label: "Admin",
    Icon: Shield,
    title: "Admin portal",
    blurb: "Draft the onboarding: edit rows, build modules, manage sign-offs, add links, and grant access.",
  },
  staff: {
    label: "Staff",
    Icon: Users,
    title: "Staff portal",
    blurb: "Work through your onboarding: open links, add notes and dates, and tick items off as you go.",
  },
};

export default function LoginPage() {
  const { session, loading, isAdmin, setPortal: setSessionPortal, signInWithEmail, signInWithPassword, sendPasswordReset, signOut } = useAuth();
  const router = useRouter();
  const [portal, setPortal] = useState(null); // null | "admin" | "staff"
  const [mode, setMode] = useState("password"); // password | link | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [message, setMessage] = useState("");
  const [awaiting, setAwaiting] = useState(false); // password login submitted; enforce portal + redirect

  useEffect(() => {
    if (!awaiting) {
      if (!loading && session) router.replace("/");
      return;
    }
    if (loading || !session) return;
    if (portal === "admin" && !isAdmin) {
      setStatus("error");
      setMessage("This email doesn't have admin access. Use the Staff portal, or ask an existing admin to add you.");
      setAwaiting(false);
      signOut();
      return;
    }
    router.replace("/");
  }, [awaiting, loading, session, isAdmin, portal, router, signOut]);

  const choosePortal = (next) => {
    setPortal(next);
    setSessionPortal(next);
    setMode("password");
    setStatus("idle");
    setMessage("");
    setPassword("");
    setAwaiting(false);
  };
  const back = () => {
    setPortal(null);
    setStatus("idle");
    setMessage("");
    setPassword("");
    setAwaiting(false);
  };
  const switchMode = (next) => {
    setMode(next);
    setStatus("idle");
    setMessage("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    if (mode === "password") {
      setAwaiting(true); // set before awaiting: session can resolve mid-await
      const { error } = await signInWithPassword(email, password);
      if (error) {
        setAwaiting(false);
        setStatus("error");
        setMessage(error);
        return;
      }
      // Success: the effect above enforces portal access and redirects.
      // If must_change_password is set, app/page.js sends them to /change-password.
    } else if (mode === "link") {
      const { error } = await signInWithEmail(email);
      if (error) { setStatus("error"); setMessage(error); return; }
      setStatus("sent");
    } else if (mode === "forgot") {
      const { error } = await sendPasswordReset(email);
      if (error) { setStatus("error"); setMessage(error); return; }
      setStatus("sent");
    }
  };

  const shell = (children) => (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(140deg, ${C.green900} 0%, ${C.green700} 45%, ${C.green400} 100%)`,
      fontFamily: FONT, padding: 20,
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800;900&display=swap" />
      <div style={{ background: "#fff", borderRadius: 18, padding: "36px 34px", width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px", display: "inline-block", marginBottom: 18 }}>
          <img src="/logo.png" alt="Ecology Consulting" style={{ height: 26, width: "auto", display: "block" }} />
        </div>
        {children}
      </div>
    </div>
  );

  // Step 1 — choose a portal. Framing only, not an access control; admin
  // access is always enforced server-side (admin_emails + RLS) regardless
  // of which button someone clicks here.
  if (!portal) {
    return shell(
      <>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.ink }}>Onboarding Workbook</h1>
        <p style={{ fontSize: 13.5, color: C.inkSoft, fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>
          Choose how you'd like to sign in.
        </p>
        {!isSupabaseConfigured && (
          <div style={{ marginTop: 20, background: "#fbeae7", border: `1px solid ${C.rust}`, borderRadius: 10, padding: "14px 16px", fontSize: 13, fontWeight: 700, color: C.rust, lineHeight: 1.5 }}>
            Sign-in is not available yet: the Supabase environment variables are not set. Add them in your project settings, then reload.
          </div>
        )}
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          {["admin", "staff"].map((key) => {
            const p = PORTALS[key];
            const { Icon } = p;
            return (
              <button
                key={key} type="button" onClick={() => choosePortal(key)}
                style={{
                  display: "flex", alignItems: "center", gap: 14, textAlign: "left", width: "100%",
                  border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "16px 16px", background: "#fff",
                  cursor: "pointer", fontFamily: FONT,
                }}
              >
                <span style={{
                  flexShrink: 0, width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center",
                  justifyContent: "center", background: C.green900,
                }}>
                  <Icon size={22} color="#fff" strokeWidth={2.2} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15.5, fontWeight: 900, color: C.ink }}>{p.title}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.45 }}>{p.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  // Step 2 — sign in to the chosen portal.
  const p = PORTALS[portal];
  const { Icon } = p;

  if (mode === "forgot") {
    return shell(
      <>
        <button
          type="button" onClick={() => switchMode("password")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: 0, marginBottom: 14, cursor: "pointer", color: C.inkSoft, fontWeight: 800, fontSize: 13, fontFamily: FONT }}
        >
          <ArrowLeft size={16} strokeWidth={2.4} /> Back to sign in
        </button>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: C.ink }}>Reset your password</h1>
        <p style={{ fontSize: 13.5, color: C.inkSoft, fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>
          Enter your email and we'll send you a link to set a new password.
        </p>
        {status === "sent" ? (
          <div style={{ marginTop: 20, background: "#eef3e4", border: `1px solid ${C.green200}`, borderRadius: 10, padding: "14px 16px", fontSize: 13.5, fontWeight: 700, color: C.green900 }}>
            Check <strong>{email}</strong> for a password reset link.
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@ecologyconsulting.au"
              style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
            />
            <button type="submit" disabled={status === "sending"} style={{
              background: C.green400, color: "#fff", border: "none", borderRadius: 10, padding: "12px 14px",
              fontSize: 14.5, fontWeight: 800, cursor: status === "sending" ? "default" : "pointer",
              opacity: status === "sending" ? 0.7 : 1, fontFamily: FONT,
            }}>
              {status === "sending" ? "Sending…" : "Send reset link"}
            </button>
            {status === "error" && <div style={{ color: C.rust, fontSize: 13, fontWeight: 700 }}>{message}</div>}
          </form>
        )}
      </>
    );
  }

  return shell(
    <>
      <button
        type="button" onClick={back}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: 0, marginBottom: 14, cursor: "pointer", color: C.inkSoft, fontWeight: 800, fontSize: 13, fontFamily: FONT }}
      >
        <ArrowLeft size={16} strokeWidth={2.4} /> All sign-in options
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: C.green900 }}>
          <Icon size={19} color="#fff" strokeWidth={2.2} />
        </span>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: C.ink }}>{p.title}</h1>
      </div>
      <p style={{ fontSize: 13.5, color: C.inkSoft, fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>
        {portal === "admin"
          ? "Restricted to approved admin email addresses."
          : "Any @ecologyconsulting.au email can sign in."}
      </p>

      <div role="tablist" aria-label="Sign-in method" style={{ marginTop: 20, display: "flex", gap: 6, background: C.bg, borderRadius: 10, padding: 4 }}>
        {[["password", "Password"], ["link", "Email link"]].map(([key, label]) => {
          const active = mode === key;
          return (
            <button
              key={key} role="tab" aria-selected={active} type="button"
              onClick={() => switchMode(key)}
              style={{
                flex: 1, border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 800,
                fontFamily: FONT, cursor: "pointer",
                background: active ? "#fff" : "transparent", color: active ? C.green900 : C.inkSoft,
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {status === "sent" ? (
        <div style={{ marginTop: 16, background: "#eef3e4", border: `1px solid ${C.green200}`, borderRadius: 10, padding: "14px 16px", fontSize: 13.5, fontWeight: 700, color: C.green900 }}>
          Check <strong>{email}</strong> for a sign-in link. You can close this tab.
        </div>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@ecologyconsulting.au"
            style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
          />
          {mode === "password" && (
            <>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
              />
              <button
                type="button" onClick={() => switchMode("forgot")}
                style={{ alignSelf: "flex-end", background: "none", border: "none", color: C.inkSoft, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, padding: 0 }}
              >
                Forgot password?
              </button>
            </>
          )}
          <button type="submit" disabled={status === "sending" || awaiting || !isSupabaseConfigured} style={{
            background: C.green400, color: "#fff", border: "none", borderRadius: 10, padding: "12px 14px",
            fontSize: 14.5, fontWeight: 800, cursor: (status === "sending" || awaiting || !isSupabaseConfigured) ? "default" : "pointer",
            opacity: (status === "sending" || awaiting || !isSupabaseConfigured) ? 0.7 : 1, fontFamily: FONT,
          }}>
            {(status === "sending" || awaiting)
              ? (mode === "password" ? "Signing in…" : "Sending…")
              : (mode === "password" ? `Sign in to ${p.label} portal` : "Send sign-in link")}
          </button>
          {status === "error" && <div style={{ color: C.rust, fontSize: 13, fontWeight: 700 }}>{message}</div>}
        </form>
      )}
    </>
  );
}
