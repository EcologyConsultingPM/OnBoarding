"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useAuth } from "../../lib/AuthProvider";

const C = {
  green900: "#16371f", green700: "#24522a", green400: "#3d7a35", green200: "#6ea24f",
  ink: "#23301f", inkSoft: "#6b755f", line: "#e3e6d8", rust: "#c05a4a",
};
const FONT = "'Nunito Sans', 'Helvetica Neue', sans-serif";

export default function ChangePasswordPage() {
  const { session, loading, mustChangePassword, setNewPassword, signOut } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace("/login"); return; }
    if (!mustChangePassword) router.replace("/");
  }, [loading, session, mustChangePassword, router]);

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (password.length < 10) {
      setStatus("error"); setMessage("Use at least 10 characters."); return;
    }
    if (password !== confirm) {
      setStatus("error"); setMessage("Passwords don't match."); return;
    }
    setStatus("sending");
    const { error } = await setNewPassword(password);
    if (error) {
      setStatus("error"); setMessage(error); return;
    }
    router.replace("/");
  };

  if (loading || !session || !mustChangePassword) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, color: C.green900 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(140deg, ${C.green900} 0%, ${C.green700} 45%, ${C.green400} 100%)`,
      fontFamily: FONT, padding: 20,
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800;900&display=swap" />
      <div style={{ background: "#fff", borderRadius: 18, padding: "36px 34px", width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, background: C.green900, display: "flex",
          alignItems: "center", justifyContent: "center", marginBottom: 16,
        }}>
          <Lock size={22} color="#fff" strokeWidth={2.2} />
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.ink }}>Set your password</h1>
        <p style={{ fontSize: 13.5, color: C.inkSoft, fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>
          You're signed in with a temporary password. Choose a new one, it becomes your login going forward, and you won't need to do this again.
        </p>
        <form onSubmit={submit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (at least 10 characters)"
            autoComplete="new-password"
            style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
          />
          <input
            type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
          />
          <button type="submit" disabled={status === "sending"} style={{
            background: C.green400, color: "#fff", border: "none", borderRadius: 10, padding: "12px 14px",
            fontSize: 14.5, fontWeight: 800, cursor: status === "sending" ? "default" : "pointer",
            opacity: status === "sending" ? 0.7 : 1, fontFamily: FONT,
          }}>
            {status === "sending" ? "Saving…" : "Set password and continue"}
          </button>
          {status === "error" && <div style={{ color: C.rust, fontSize: 13, fontWeight: 700 }}>{message}</div>}
        </form>
        <button
          type="button" onClick={signOut}
          style={{ marginTop: 16, background: "none", border: "none", color: C.inkSoft, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, padding: 0 }}
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
