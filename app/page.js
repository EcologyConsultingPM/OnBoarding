"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthProvider";
import OnboardingWorkbook from "../components/OnboardingWorkbook";

export default function Home() {
  const { session, loading, mustChangePassword, portalChosen } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace("/login"); return; }
    if (mustChangePassword) { router.replace("/change-password"); return; }
    // Signed in but hasn't chosen a portal on this device yet — send them to
    // the picker so an admin lands in admin, not silently in staff.
    if (!portalChosen) router.replace("/login");
  }, [loading, session, mustChangePassword, portalChosen, router]);

  if (loading || !session || mustChangePassword || !portalChosen) {
    return (
      <main style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Nunito Sans', sans-serif", color: "#1e4d2b" }}>
        Loading…
      </main>
    );
  }

  return (
    <main style={{ height: "100vh", padding: 16 }}>
      <OnboardingWorkbook />
    </main>
  );
}
