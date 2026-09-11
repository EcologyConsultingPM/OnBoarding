"use client";

/**
 * /admin/ecado — the hidden Ecado domain.
 *
 * Client-side gate: calls the escalations API, which already 404s any
 * caller not on the ecado_viewers allow-list. On failure this redirects
 * away silently rather than rendering an error, since the whole point is
 * that this route's existence is never confirmed to anyone not on the list.
 * (The original design's server-side cookie-based notFound() guard doesn't
 * fit this app, which authenticates client-side via Bearer tokens
 * everywhere else — the real enforcement is still server-side, in the API
 * route and the database RLS underneath it, not in this page.)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/AuthProvider";
import EcadoConsole from "../../../components/ecado/EcadoConsole";
import WorkspaceNav from "../../../components/WorkspaceNav";

export default function EcadoPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState("checking"); // checking | ok | denied
  const [escalations, setEscalations] = useState([]);
  const [viewerEmail, setViewerEmail] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!session?.access_token) { router.replace("/login"); return; }

    fetch("/api/ecado/escalations/close", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("denied");
        return response.json();
      })
      .then((data) => {
        setEscalations(data.escalations || []);
        setViewerEmail(session.user?.email || "");
        setState("ok");
      })
      .catch(() => {
        setState("denied");
        router.replace("/");
      });
  }, [authLoading, session, router]);

  if (state !== "ok") return null;

  // Page shell aligned to the admin style guide: WorkspaceNav for consistent
  // navigation (this domain previously had no way back to the portal), the
  // portal palette, DM Serif Display heading and Archivo body.
  return (
    <main className="ecado-page">
      <style>{`
        .ecado-page { max-width: 1020px; margin: 0 auto; padding: 28px 20px 56px; font-family: "Archivo", "Nunito Sans", system-ui, sans-serif; color: #23301f; }
        .ecado-hero { margin-bottom: 30px; padding-bottom: 22px; border-bottom: 1px solid #e3e6d8; }
        .ecado-kicker { margin: 14px 0 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .14em; color: #7a877d; }
        .ecado-hero h1 { margin: 6px 0 0; font-family: "DM Serif Display", Georgia, serif; font-size: 34px; font-weight: 400; color: #173920; }
        .ecado-hero .ecado-lede { margin-top: 9px; max-width: 620px; font-size: 14px; color: #5c6b58; line-height: 1.62; }
        .ecado-viewer { margin-top: 13px; font-size: 11.5px; color: #7a877d; }
      `}</style>
      <header className="ecado-hero">
        <WorkspaceNav audience="admin" backLabel="Back to portal" />
        <p className="ecado-kicker">Program &amp; Project Management Office</p>
        <h1>Ecado</h1>
        <p className="ecado-lede">
          Ecado monitors, advises and prioritises. It does not approve, assign or change records.
          Every recommendation is actioned by a person in the source module.
        </p>
        <p className="ecado-viewer">Signed in as {viewerEmail} · access is logged</p>
      </header>

      <EcadoConsole initialEscalations={escalations} />
    </main>
  );
}
