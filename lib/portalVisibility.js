import { normaliseStaffEmail } from "./staffDirectory";

export const PRIMARY_ADMIN_EMAILS = Object.freeze([
  "aaron.dooley@ecologyconsulting.au",
  "tony.webster@ecologyconsulting.au",
]);

// Kept for backward compatibility with existing UI copy and integrations.
export const PRIMARY_ADMIN_EMAIL = PRIMARY_ADMIN_EMAILS[0];

export const PORTAL_RESOURCES = [
  {
    key: "staff.projects",
    portal: "staff",
    label: "My Projects",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.notifications",
    portal: "staff",
    label: "Notifications",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.projects.activities",
    portal: "staff",
    label: "My Projects · Project Activities",
    parent: "staff.projects",
    defaultVisible: true,
  },
  {
    key: "staff.projects.tracker",
    portal: "staff",
    label: "My Projects · Project Tracker",
    parent: "staff.projects",
    defaultVisible: true,
  },
  {
    key: "staff.projects.service_requests",
    portal: "staff",
    label: "My Projects · Service Requests",
    parent: "staff.projects",
    defaultVisible: true,
  },
  {
    key: "staff.timesheets",
    portal: "staff",
    label: "Timesheets",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.forms",
    portal: "staff",
    label: "WHS & EC Forms",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.forms.governance",
    portal: "staff",
    label: "WHS & EC Forms · Internal Governance",
    parent: "staff.forms",
    defaultVisible: true,
  },
  {
    key: "staff.learning",
    portal: "staff",
    label: "Learning & Development",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.species",
    portal: "staff",
    label: "Species Profiles & Survey Requirements",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.remote_operations",
    portal: "staff",
    label: "Remote Operations",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "staff.onboarding",
    portal: "staff",
    label: "My Onboarding",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.projects",
    portal: "admin",
    label: "Projects & Operations",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.projects.setup",
    portal: "admin",
    label: "Projects & Operations · Setup & Allocations",
    parent: "admin.projects",
    defaultVisible: true,
  },
  {
    key: "admin.projects.tracker",
    portal: "admin",
    label: "Projects & Operations · Project Tracker",
    parent: "admin.projects",
    defaultVisible: true,
  },
  {
    key: "admin.projects.health",
    portal: "admin",
    label: "Projects & Operations · Health Report",
    parent: "admin.projects",
    defaultVisible: true,
  },
  {
    key: "admin.quote_pipeline",
    portal: "admin",
    label: "Quote Pipeline",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.quote_pipeline.financials",
    portal: "admin",
    label: "Quote Pipeline · Financial values and totals",
    parent: "admin.quote_pipeline",
    defaultVisible: false,
  },
  {
    key: "admin.remote_operations",
    portal: "admin",
    label: "Remote Operations Oversight",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.whs",
    portal: "admin",
    label: "WHS & Compliance",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.whs_monitoring",
    portal: "admin",
    label: "WHS & Compliance · Monitoring",
    parent: "admin.whs",
    defaultVisible: true,
  },
  {
    key: "admin.internal_governance",
    portal: "admin",
    label: "WHS & Compliance · Internal Governance",
    parent: "admin.whs",
    defaultVisible: true,
  },
  {
    key: "admin.service_requests",
    portal: "admin",
    label: "Service Requests",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.learning",
    portal: "admin",
    label: "Learning & Development Library",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.species",
    portal: "admin",
    label: "Species Profiles & Survey Requirements",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.regulatory_watch",
    portal: "admin",
    label: "Regulatory Watch",
    parent: null,
    defaultVisible: true,
  },
  {
    key: "admin.portal_management",
    portal: "admin",
    label: "Portal Management",
    parent: null,
    defaultVisible: true,
  },
];

const RESOURCE_MAP = new Map(PORTAL_RESOURCES.map((resource) => [resource.key, resource]));

export function resourceDefinition(key) {
  return RESOURCE_MAP.get(key) || null;
}

export function isPrimaryAdministrator(access) {
  return PRIMARY_ADMIN_EMAILS.includes(normaliseStaffEmail(access?.user?.email));
}

export function isProtectedPrimaryEmail(email) {
  return PRIMARY_ADMIN_EMAILS.includes(normaliseStaffEmail(email));
}

export function visibilitySchemaMissing(error) {
  return (
    error?.code === "42P01" ||
    String(error?.message || "").includes("portal_visibility_overrides")
  );
}

function defaultVisibility(resourceKeys) {
  return Object.fromEntries(
    resourceKeys.map((key) => [key, resourceDefinition(key)?.defaultVisible === true]),
  );
}

function inheritedKeys(resource) {
  const chain = [];
  let current = resource;
  while (current) {
    chain.unshift(current.key);
    current = current.parent ? resourceDefinition(current.parent) : null;
  }
  return chain;
}

export async function visibilityForUser(access, resourceKeys = PORTAL_RESOURCES.map((resource) => resource.key)) {
  const requested = [...new Set(resourceKeys)].filter((key) => resourceDefinition(key));
  if (!requested.length) return {};

  if (isPrimaryAdministrator(access)) {
    return Object.fromEntries(requested.map((key) => [key, true]));
  }

  const keysToLoad = [...new Set(requested.flatMap((key) => inheritedKeys(resourceDefinition(key))))];
  const { data, error } = await access.admin
    .from("portal_visibility_overrides")
    .select("resource_key, is_visible")
    .eq("user_id", access.user.id)
    .in("resource_key", keysToLoad);
  if (error) {
    // Before the additive migration is applied, retain the safe built-in defaults.
    // In particular, Quote Pipeline remains unavailable to non-primary admins.
    if (visibilitySchemaMissing(error)) return defaultVisibility(requested);
    throw new Error(error.message);
  }

  const overrides = new Map((data || []).map((row) => [row.resource_key, row.is_visible]));
  return Object.fromEntries(
    requested.map((key) => {
      const resource = resourceDefinition(key);
      const chain = inheritedKeys(resource);
      const explicitParentLock = chain.some(
        (candidate) => overrides.get(candidate) === false,
      );
      const ownOverride = overrides.get(resource.key);
      return [key, !explicitParentLock && (ownOverride ?? resource.defaultVisible)];
    }),
  );
}

export async function canAccessPortalResource(access, resourceKey) {
  const resource = resourceDefinition(resourceKey);
  if (!resource) return false;
  if (resource.portal === "admin" && !access.isAdmin) return false;
  const visibility = await visibilityForUser(access, [resourceKey]);
  return visibility[resourceKey] === true;
}

export async function requirePortalResource(access, resourceKey) {
  const allowed = await canAccessPortalResource(access, resourceKey);
  if (allowed) return null;
  return Response.json(
    {
      error:
        "You do not have access to this portal area. Please email the Project Manager if you need access.",
    },
    { status: 403 },
  );
}

export function visibilityAccessMessage() {
  return "You do not have access to this portal area. Please email the Project Manager if you need access.";
}
