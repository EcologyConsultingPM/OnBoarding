"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock3, Film, FolderOpen, Loader2, PlayCircle, RefreshCw, Video } from "lucide-react";
import { DOMAIN_VIDEO_LIBRARY } from "../lib/domainVideoLibrary";
import { useAuth } from "../lib/AuthProvider";

const videoUrl = (audience, video) => `/domain-videos/${audience}/${video.file}`;

export default function SaasDomainVideos({ audience = "staff" }) {
  const { session } = useAuth();
  const videos = DOMAIN_VIDEO_LIBRARY[audience] || [];
  const admin = audience === "admin";
  const [available, setAvailable] = useState(new Set());
  const [selectedId, setSelectedId] = useState(videos[0]?.id || "");
  const [filter, setFilter] = useState("All domains");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const access = await fetch(`/api/domain-videos?audience=${audience}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await access.json().catch(() => ({}));
      if (!access.ok) throw new Error(data.error || "You do not have access to this video domain.");
      setAvailable(new Set(videos.map((video) => video.file)));
    } catch (requestError) {
      setAvailable(new Set());
      setError(requestError?.message || "Could not load the video library.");
    } finally {
      setLoading(false);
    }
  }, [audience, session?.access_token, videos]);

  useEffect(() => { load(); }, [load]);

  const domains = useMemo(() => ["All domains", ...new Set(videos.map((video) => video.domain))], [videos]);
  const filtered = useMemo(() => videos.filter((video) => filter === "All domains" || video.domain === filter), [filter, videos]);
  const selected = videos.find((video) => video.id === selectedId) || filtered[0] || videos[0];
  const selectedAvailable = selected && available.has(selected.file);

  return (
    <main className={`sdv sdv--${audience}`}>
      <header className="sdv-hero">
        <div>
          <span><Video size={14} /> {admin ? "Administrator enablement" : "Staff enablement"}</span>
          <h1>SaaS Domain Videos</h1>
          <p>{admin ? "Short, role-specific walkthroughs for navigating the Admin Portal’s operational domains and controlled workflows." : "Short walkthroughs for finding your way around the Staff Portal, completing work safely and using each domain correctly."}</p>
        </div>
        <div className="sdv-hero-note"><PlayCircle size={20} /><span><strong>Start here</strong>Choose a domain, watch the walkthrough, then return to the relevant workspace to apply the steps.</span></div>
      </header>

      <section className="sdv-guidance" aria-label="Using the video guide">
        <article><span>1</span><div><strong>Find your domain</strong><small>Use the domain filter or choose a walkthrough below.</small></div></article>
        <article><span>2</span><div><strong>Watch the workflow</strong><small>Each clip shows where to go and what to do next.</small></div></article>
        <article><span>3</span><div><strong>Apply with care</strong><small>Follow your role authority, supervision and approval requirements.</small></div></article>
      </section>

      <section className="sdv-controls">
        <label>Filter by domain<select value={filter} onChange={(event) => setFilter(event.target.value)}>{domains.map((domain) => <option key={domain}>{domain}</option>)}</select></label>
        <p><Film size={15} /> {available.size} of {videos.length} walkthrough{videos.length === 1 ? "" : "s"} available</p>
        <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14} /> Refresh library</button>
      </section>

      {error ? <p className="sdv-error"><AlertCircle size={15} /> {error}</p> : null}

      <section className="sdv-layout">
        <div className="sdv-player-panel">
          {loading ? <div className="sdv-loading"><Loader2 className="spin" size={18} /> Loading walkthrough library…</div> : selected && selectedAvailable ? <><video key={selected.id} className="sdv-player" controls preload="metadata" controlsList="nodownload"><source src={videoUrl(audience, selected)} type="video/mp4" />Your browser does not support embedded video.</video><div className="sdv-player-copy"><span>{selected.domain} · {selected.duration}</span><h2>{selected.title}</h2><p>{selected.summary}</p></div></> : <div className="sdv-empty-player"><FolderOpen size={28} /><h2>Walkthrough unavailable</h2><p>{selected ? `The ${selected.title} walkthrough is unavailable with this account.` : "Choose a walkthrough from the library."}</p></div>}
        </div>
        <div className="sdv-list" aria-label="Available domain walkthroughs">
          {filtered.map((video) => {
            const published = available.has(video.file);
            const active = selected?.id === video.id;
            return <article key={video.id} className={`${active ? "selected" : ""}${published ? " available" : ""}`}><button type="button" className="sdv-video-select" onClick={() => setSelectedId(video.id)}><span className="sdv-video-icon">{published ? <PlayCircle size={20} /> : <Video size={19} />}</span><span><strong>{video.title}</strong><small>{video.domain} · <Clock3 size={11} /> {video.duration}</small><em>{published ? "Ready to watch" : "Unavailable"}</em></span></button></article>;
          })}
        </div>
      </section>
    </main>
  );
}
