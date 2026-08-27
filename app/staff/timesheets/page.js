"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import StaffTimesheetsWorkspace from "../../../components/StaffTimesheetsWorkspace";

export default function StaffTimesheetsPage() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, mustChangePassword, router, session]);

  if (loading || !session || mustChangePassword) return null;
  return <StaffTimesheetsWorkspace />;
}
