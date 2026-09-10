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

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 32, borderBottom: "1px solid #e2e8f0", paddingBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#64748b" }}>
          Program &amp; Project Management Office
        </p>
        <h1 style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 700, color: "#0f172a" }}>Ecado</h1>
        <p style={{ marginTop: 8, maxWidth: 560, fontSize: 13.5, color: "#475569", lineHeight: 1.6 }}>
          Ecado monitors, advises and prioritises. It does not approve, assign or change records.
          Every recommendation is actioned by a person in the source module.
        </p>
        <p style={{ marginTop: 12, fontSize: 11.5, color: "#94a3b8" }}>Signed in as {viewerEmail} · access is logged</p>
      </header>

      <EcadoConsole initialEscalations={escalations} />
    </main>
  );
}
