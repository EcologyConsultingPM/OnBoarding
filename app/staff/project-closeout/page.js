"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import ProjectCloseOut from "../../../components/ProjectCloseOut";
import WorkspaceNav from "../../../components/WorkspaceNav";
import styles from "../../../components/ProjectCloseOut.module.css";

export default function StaffProjectCloseoutPage({ searchParams }) {
  const { session, loading, mustChangePassword } = useAuth();
  const router = useRouter();
  const [projectId, setProjectId] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (mustChangePassword) router.replace("/change-password");
  }, [loading, session, mustChangePassword, router]);

  useEffect(() => {
    const readProject = () => setProjectId(new URLSearchParams(window.location.search).get("projectId") || "");
    readProject();
    window.addEventListener("popstate", readProject);
    return () => window.removeEventListener("popstate", readProject);
  }, [searchParams?.projectId]);

  if (loading || !session || mustChangePassword) return null;
  return <main className={styles.staffPage}>
    <header className={styles.staffTop}><div><span className={styles.kicker}>Staff project review</span><h1>Project Close Report</h1><p>Review the project report and contribute your own hurdles and lessons.</p></div><WorkspaceNav audience="staff" /></header>
    <div className={styles.staffContent}>{projectId === null ? <p role="status">Loading invitation…</p> : projectId ? <ProjectCloseOut projectId={projectId} staffMode /> : <section className={`${styles.root} ${styles.picker}`}><h2>Open your project invitation</h2><p role="alert">This link does not include a project. Open your project close-out invitation from Notifications.</p><a href="/staff/notifications">Return to Notifications</a></section>}</div>
  </main>;
}
