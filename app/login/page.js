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
    if (!awaiting) return;
    if (loading || !session) return;
    if (portal === "admin" && !isAdmin) {
      setStatus("error");
      setMessage("This email doesn't have admin access. Use the Staff portal, or ask an existing admin to add you.");
      setAwaiting(false);
      signOut();
      return;
    }
    // Re-assert the chosen portal right before entering the app. This is the
    // fix for admins landing in staff: the earlier write in choosePortal can be
    // clobbered while the auth state settles, so we write it again here — both
    // to the context and directly to localStorage — immediately before redirect.
    if (portal) {
      setSessionPortal(portal);
      if (typeof window !== "undefined") window.localStorage.setItem("ec_portal", portal);
    }
    router.replace("/");
  }, [awaiting, loading, session, isAdmin, portal, router, signOut, setSessionPortal]);

  // If already signed in and they pick a portal, honour it and go straight in.
  const enterWithExistingSession = (chosen) => {
    setSessionPortal(chosen);
    if (typeof window !== "undefined") window.localStorage.setItem("ec_portal", chosen);
    if (chosen === "admin" && !isAdmin) {
      setStatus("error");
      setMessage("This email doesn't have admin access. Use the Staff portal, or ask an existing admin to add you.");
      return;
    }
    router.replace("/");
  };

  const choosePortal = (next) => {
    setPortal(next);
    setSessionPortal(next);
    // Already signed in? Honour the choice and go straight into that portal.
    if (session && !loading) { enterWithExistingSession(next); return; }
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
      // Persist the chosen portal SYNCHRONOUSLY before the async sign-in, so it
      // is guaranteed in storage before any auth-state change or redirect can
      // race it. `portal` is always set here (can't reach this screen without
      // picking one). This is the durable fix for admins landing in staff.
      if (portal && typeof window !== "undefined") {
        window.localStorage.setItem("ec_portal", portal);
        setSessionPortal(portal);
      }
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
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.15fr .85fr", fontFamily: "'Archivo', Helvetica, sans-serif", background: "#f5f2ea" }} className="ec-login">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..500&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />

      {/* Left — photographic panel */}
      <div style={{ position: "relative", overflow: "hidden", background: "#0e2a1c" }} className="ec-login-photo">
        <div style={{ position: "absolute", inset: 0, background: "url('/assets/koala.png') 42% 40%/cover", filter: "grayscale(0.2) contrast(1.05)", opacity: 0.95 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(155deg, rgba(31,90,52,0.55), rgba(11,35,23,0.6) 88%)", mixBlendMode: "multiply" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(6,18,12,.82), rgba(6,18,12,0) 42%), linear-gradient(to bottom, rgba(6,18,12,.5), rgba(6,18,12,0) 30%)" }} />
        <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "44px 52px", color: "#f2f6ef", minHeight: "100vh", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ background: "#fff", borderRadius: 8, padding: "7px 10px", display: "flex", alignItems: "center" }}>
              <img src="/logo.png" alt="Ecology Consulting" style={{ height: 26, display: "block" }} />
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(242,246,239,0.72)" }}>Onboarding &amp; Learning Portal</div>
          </div>
          <div style={{ maxWidth: 520, textShadow: "0 2px 12px rgba(6,18,12,0.55)" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#e7c979", marginBottom: 18 }}>Phascolarctos cinereus — Blue Mountains, NSW</div>
            <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 50, lineHeight: 1.06, letterSpacing: "-0.015em", margin: "0 0 16px" }}>The field starts here.</h1>
            <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "rgba(242,246,239,0.82)", margin: 0, maxWidth: "44ch" }}>Your induction, competencies, WHS forms and project allocations — one place, from day one to accreditation.</p>
          </div>
          <div style={{ display: "flex", gap: 26, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(242,246,239,0.55)", flexWrap: "wrap" }}>
            <span>Internal use only</span><span>ISO 45001 aligned</span>
          </div>
        </div>
      </div>

      {/* Right — form panel */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "56px 48px", background: "#f5f2ea" }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          {children}
        </div>
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
