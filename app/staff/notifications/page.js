"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import StaffNotifications from "../../../components/StaffNotifications";

export default function StaffNotificationsPage() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, session, mustChangePassword, router]);

  if (loading || !session || mustChangePassword) return null;
  return <StaffNotifications />;
}
