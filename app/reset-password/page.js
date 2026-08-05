"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useAuth } from "../../lib/AuthProvider";

const C = {
  green900: "#16371f", green700: "#24522a", green400: "#3d7a35", green200: "#6ea24f",
  ink: "#23301f", inkSoft: "#6b755f", line: "#e3e6d8", rust: "#c05a4a",
};
const FONT = "'Nunito Sans', 'Helvetica Neue', sans-serif";

export default function ResetPasswordPage() {
  const { session, loading, setNewPassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  // Clicking the emailed reset link gives a temporary "recovery" session
  // automatically via Supabase — if there's no session at all, the link
  // was invalid or has expired.
  useEffect(() => {
    if (!loading && !session) {
      setStatus("error");
      setMessage("This reset link is invalid or has expired. Request a new one from the sign-in page.");
    }
  }, [loading, session]);

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
    setStatus("done");
    setTimeout(() => router.replace("/"), 1400);
  };

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
          <KeyRound size={22} color="#fff" strokeWidth={2.2} />
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.ink }}>Choose a new password</h1>

        {status === "done" ? (
          <div style={{ marginTop: 20, background: "#eef3e4", border: `1px solid ${C.green200}`, borderRadius: 10, padding: "14px 16px", fontSize: 13.5, fontWeight: 700, color: C.green900 }}>
            Password updated. Taking you back in…
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (at least 10 characters)"
              autoComplete="new-password" disabled={!session}
              style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
            />
            <input
              type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password" disabled={!session}
              style={{ border: `1.5px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, color: C.ink, outline: "none", fontFamily: FONT }}
            />
            <button type="submit" disabled={status === "sending" || !session} style={{
              background: C.green400, color: "#fff", border: "none", borderRadius: 10, padding: "12px 14px",
              fontSize: 14.5, fontWeight: 800, cursor: (status === "sending" || !session) ? "default" : "pointer",
              opacity: (status === "sending" || !session) ? 0.7 : 1, fontFamily: FONT,
            }}>
              {status === "sending" ? "Saving…" : "Set new password"}
            </button>
            {status === "error" && <div style={{ color: C.rust, fontSize: 13, fontWeight: 700 }}>{message}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
