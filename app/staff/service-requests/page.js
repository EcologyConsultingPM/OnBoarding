"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import StaffServiceRequests from "../../../components/StaffServiceRequests";
import WorkspaceNav from "../../../components/WorkspaceNav";

export default function StaffServiceRequestsPage() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, session, mustChangePassword, router]);

  if (loading || !session || mustChangePassword) return null;
  return (
    <main className="staff-service-requests-page">
      <header className="staff-service-requests-page__hero">
        <div>
          <span>Ecology Consulting · staff support</span>
          <h1>Service Requests</h1>
          <p>Submit and track internal requests without leaving your staff workspace.</p>
        </div>
        <WorkspaceNav audience="staff" />
      </header>
      <StaffServiceRequests />
    </main>
  );
}
