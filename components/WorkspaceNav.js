"use client";

import Link from "next/link";
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
  const homeHref = audience === "admin" ? "/?portal=admin" : "/";
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
