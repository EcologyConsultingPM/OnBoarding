"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import ProjectsList from "../../../components/ProjectsList";
import ProjectHealth from "../../../components/ProjectHealth";

export default function StaffProjectsPage() {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();
  const [openProjectId, setOpenProjectId] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, session, mustChangePassword, router]);

  if (loading || !session || mustChangePassword) return null;

  return (
    <main className="proj-page">
      <header className="proj-hero">
        <span>Ecology Consulting · Projects &amp; operations</span>
        <h1>Project health</h1>
        <p>Your allocated projects, their schedule, budget and team. Update your work status from within each project.</p>
      </header>
      {openProjectId
        ? <ProjectHealth projectId={openProjectId} onBack={() => setOpenProjectId(null)} />
        : <ProjectsList onOpen={setOpenProjectId} />}
    </main>
  );
}
