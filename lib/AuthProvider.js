"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

const ALLOWED_DOMAIN = "@ecologyconsulting.au";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  // Which portal the person entered through at login: "staff" | "admin".
  // Held in sessionStorage so it survives the login -> app redirect but clears
  // when the browser closes. Being an admin does NOT force the admin portal —
  // an admin can work inside the staff portal. Only a genuine admin can ever
  // hold portal === "admin" (enforced at login and re-checked in setPortal).
  const [portal, setPortalState] = useState(() => {
    if (typeof window === "undefined") return "staff";
    return window.sessionStorage.getItem("ec_portal") || "staff";
  });

  const setPortal = useCallback((next) => {
    const value = next === "admin" ? "admin" : "staff";
    setPortalState(value);
    if (typeof window !== "undefined") window.sessionStorage.setItem("ec_portal", value);
  }, []);

  const checkAdmin = useCallback(async (currentSession) => {
    if (!currentSession) {
      setIsAdmin(false);
      setAdminChecked(true);
      return;
    }
    const { data, error } = await supabase
      .from("admin_emails")
      .select("email")
      .ilike("email", currentSession.user.email)
      .maybeSingle();
    setIsAdmin(!error && !!data);
    setAdminChecked(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      checkAdmin(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAdminChecked(false);
      checkAdmin(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, [checkAdmin]);

// Supabase can return a genuinely unhelpful message (e.g. literally "{}")
// when the server-side email send itself fails, such as a broken SMTP
// integration — catch that case specifically rather than showing it raw.
function readableAuthError(error, fallback) {
  const msg = (error?.message || "").trim();
  if (!msg || msg === "{}" || msg === "[object Object]") {
    return "Couldn't send the email — this usually means the SMTP provider (e.g. Resend) isn't fully set up yet. Check Supabase's Auth logs for the real reason.";
  }
  return msg || fallback;
}

const signInWithEmail = useCallback(async (email) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.endsWith(ALLOWED_DOMAIN)) {
      return { error: `Only ${ALLOWED_DOMAIN} email addresses can access this application.` };
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
      });
      if (error) {
        console.error("signInWithEmail failed:", error);
        return { error: readableAuthError(error, "Couldn't send the sign-in link. Try again in a moment.") };
      }
      return { error: null };
    } catch (err) {
      console.error("signInWithEmail threw:", err);
      return { error: "Couldn't reach the server. Check your connection and try again." };
    }
  }, []);

  // Real password sign-in: each person has their own password, checked by
  // Supabase Auth itself. No custom backend route, no shared secret — this
  // calls Supabase directly, the same way signInWithOtp does above.
  const signInWithPassword = useCallback(async (email, password) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.endsWith(ALLOWED_DOMAIN)) {
      return { error: `Only ${ALLOWED_DOMAIN} email addresses can access this application.` };
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
      if (error) {
        console.error("signInWithPassword failed:", error);
        return { error: "Incorrect email or password." };
      }
      return { error: null, mustChangePassword: !!data?.user?.app_metadata?.must_change_password };
    } catch (err) {
      console.error("signInWithPassword threw:", err);
      return { error: "Couldn't reach the server. Check your connection and try again." };
    }
  }, []);

  // Sends Supabase's built-in password-reset email with a link back to
  // /reset-password. No custom code touches passwords here at all.
  const sendPasswordReset = useCallback(async (email) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.endsWith(ALLOWED_DOMAIN)) {
      return { error: `Only ${ALLOWED_DOMAIN} email addresses can access this application.` };
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined,
      });
      if (error) {
        console.error("sendPasswordReset failed:", error);
        return { error: readableAuthError(error, "Couldn't send the reset link. Try again in a moment.") };
      }
      return { error: null };
    } catch (err) {
      console.error("sendPasswordReset threw:", err);
      return { error: "Couldn't reach the server. Check your connection and try again." };
    }
  }, []);

  // Sets a new password for the currently-signed-in user (used for both the
  // forced first-login change and the forgot-password recovery flow).
  const setNewPassword = useCallback(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    // updateUser can only touch user_metadata, not app_metadata — clearing
    // the must_change_password flag needs a small server call.
    try {
      const { data: { session: current } } = await supabase.auth.getSession();
      if (current?.access_token) {
        await fetch("/api/clear-password-flag", {
          method: "POST",
          headers: { Authorization: `Bearer ${current.access_token}` },
        });
        // Refresh the local session so app_metadata reflects the change immediately.
        const { data } = await supabase.auth.refreshSession();
        setSession(data.session);
      }
    } catch {
      // Non-fatal — the flag will still be cleared server-side on next check if retried.
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const mustChangePassword = !!session?.user?.app_metadata?.must_change_password;

  // Safety net: if the portal is "admin" but this person is not an admin
  // (or signed out), drop them back to the staff portal. The admin portal is
  // never reachable without genuine admin rights, regardless of stored state.
  const effectivePortal = portal === "admin" && isAdmin ? "admin" : "staff";
  useEffect(() => {
    if (adminChecked && portal === "admin" && !isAdmin) setPortal("staff");
  }, [adminChecked, portal, isAdmin, setPortal]);

  const value = {
    session,
    user: session?.user ?? null,
    loading: session === undefined || !adminChecked,
    isAdmin,
    portal: effectivePortal,
    setPortal,
    mustChangePassword,
    signInWithEmail,
    signInWithPassword,
    sendPasswordReset,
    setNewPassword,
    signOut,
    ALLOWED_DOMAIN,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
