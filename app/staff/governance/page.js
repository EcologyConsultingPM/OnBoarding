"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import WhsEcFormsDomain from "../../../components/WhsEcFormsDomain";

// Technical route only: Internal Governance remains a sub-domain of WHS & EC
// Forms in the portal interface. This route allows a notification to land staff
// directly on the relevant controlled document area.
export default function StaffGovernancePage() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, mustChangePassword, router, session]);

  if (loading || !session || mustChangePassword) return null;
  return <WhsEcFormsDomain initialSubdomain="governance" />;
}
