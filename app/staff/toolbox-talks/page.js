"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import WhsEcFormsDomain from "../../../components/WhsEcFormsDomain";

export default function StaffToolboxTalksPage() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, mustChangePassword, router, session]);

  if (loading || !session || mustChangePassword) return null;
  return <WhsEcFormsDomain initialSubdomain="forms" />;
}
