"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthProvider";
import OnboardingWorkbook from "../components/OnboardingWorkbook";

export default function Home() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace("/login"); return; }
    if (mustChangePassword) { router.replace("/change-password"); return; }
    // Signed in: render the app. The portal (admin vs staff) is resolved inside
    // the app — admins default to the admin portal and can switch to staff.
  }, [loading, session, mustChangePassword, router]);

  if (loading || !session || mustChangePassword) {
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
