"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, Home } from "lucide-react";

/** A single navigation pattern for every direct portal workspace. */
export default function WorkspaceNav({
  audience = "staff",
  backHref,
  backLabel = "Back",
  onBack,
  className = "",
}) {
  // "/admin" is not a route — the admin dashboard is served from "/" with
  // ?portal=admin. Linking to /admin produced a hard 404 for every admin.
  const baseHomeHref = audience === "admin" ? "/?portal=admin" : "/?portal=staff";
  const [homeHref, setHomeHref] = useState(baseHomeHref);

  // A physical subdomain page (for example service requests) must not erase
  // the workspace an employee or administrator was working in. The root portal
  // already stores its active workspace; carry it back in the Home URL so a
  // return from a file, form or standalone page restores that exact workspace.
  useEffect(() => {
    try {
      const key = audience === "admin"
        ? "ec-admin-portal-location"
        : "ec-staff-portal-location";
      const current = new URL(window.location.href);
      const workspace = current.searchParams.get("workspace") || window.localStorage.getItem(key);
      if (!workspace) return;
      const target = new URL(baseHomeHref, window.location.origin);
      target.searchParams.set("workspace", workspace);
      setHomeHref(`${target.pathname}${target.search}`);
    } catch {
      setHomeHref(baseHomeHref);
    }
  }, [audience, baseHomeHref]);
  const back = onBack ? (
    <button type="button" className="workspace-nav__button" onClick={onBack}>
      <ChevronLeft size={15} /> {backLabel}
    </button>
  ) : backHref ? (
    <Link className="workspace-nav__button" href={backHref}>
      <ChevronLeft size={15} /> {backLabel}
    </Link>
  ) : null;
  return (
    <nav
      className={`workspace-nav ${className}`.trim()}
      aria-label="Workspace navigation"
    >
      {back || <span aria-hidden="true" />}
      <Link className="workspace-nav__home" href={homeHref}>
        <Home size={14} /> {audience === "admin" ? "Admin home" : "Staff home"}
      </Link>
    </nav>
  );
}
