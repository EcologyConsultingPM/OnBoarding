import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function tableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

function toSettings(row) {
  return {
    trackerVisible: Boolean(row?.tracker_visible),
    resourcesReady: Boolean(row?.resources_ready),
    trainingChecked: Boolean(row?.training_checked),
    formsConfigured: Boolean(row?.forms_configured),
    whsChecked: Boolean(row?.whs_checked),
  };
}

function booleanInput(value) {
  return value === true;
}

function validProjectId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

// Staff tracker entries require an approved budget source and a staff-visible
// allocation. The first activation should not require administrators to locate
// a separate financial screen merely to create a valid timesheet path. This
// helper creates a clearly labelled baseline only when those records are absent;
// later detailed budget management remains in Project Tracker.
async function ensureBaselineTrackerBudget(access, project, now) {
  let { data: source, error: sourceError } = await access.admin
    .from("project_budget_sources")
    .select("id")
    .eq("project_id", project.id)
    .eq("source_type", "original")
    .maybeSingle();
  if (sourceError) return { error: sourceError.message };
  if (!source) {
    const inserted = await access.admin
      .from("project_budget_sources")
      .insert({
        project_id: project.id,
        source_code: "BASE",
        source_name: "Project delivery baseline",
        source_type: "original",
        approved_value: numberOrZero(project.budget_dollars),
        approved_hours: numberOrZero(project.budget_hours),
        approval_status: "approved",
        effective_date: new Date().toISOString().slice(0, 10),
        created_by: access.user.id,
        updated_by: access.user.id,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (inserted.error) return { error: inserted.error.message };
    source = inserted.data;
  }
  const { data: visibleAllocation, error: allocationError } = await access.admin
    .from("project_budget_allocations")
    .select("id")
    .eq("project_id", project.id)
    .eq("budget_source_id", source.id)
    .eq("status", "active")
    .eq("staff_visible", true)
    .limit(1);
  if (allocationError) return { error: allocationError.message };
  if (!(visibleAllocation || []).length) {
    const { error } = await access.admin.from("project_budget_allocations").insert({
      project_id: project.id,
      budget_source_id: source.id,
      allocation_code: "DELIVERY",
      allocation_name: "Allocated project delivery",
      allocation_value: numberOrZero(project.budget_dollars),
      allocation_hours: numberOrZero(project.budget_hours),
      hours_consumed: 0,
      charge_out_spend: 0,
      internal_cost: 0,
      threshold_percent: 80,
      status: "active",
      staff_visible: true,
      created_by: access.user.id,
      updated_by: access.user.id,
      created_at: now,
      updated_at: now,
    });
    if (error) return { error: error.message };
  }
  return { sourceId: source.id };
}

function settingColumns() {
  return [
    "project_id", "tracker_visible", "resources_ready", "training_checked", "forms_configured", "whs_checked",
    "activated_by", "activated_at", "updated_by", "updated_at",
  ].join(", ");
}

async function requireAdmin(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  if (!access.isAdmin) return { error: jsonError("Administrator access is required.", 403) };
  return { access };
}

async function projectRows(access) {
  const { data, error } = await access.admin
    .from("projects")
    .select("id, name, client_name, budget_hours, budget_dollars, status")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function settingsByProject(access) {
  const { data, error } = await access.admin
    .from("project_tracker_settings")
    .select(settingColumns());
  if (error) {
    if (tableUnavailable(error)) return { ready: false, settings: new Map() };
    throw new Error(error.message);
  }
  return { ready: true, settings: new Map((data || []).map((row) => [row.project_id, row])) };
}

// Must exactly match TASK_CATEGORIES in components/AdminProjectSetup.js — see
// the identical fix and explanation in app/api/projects/[projectId]/activities/approval/route.js.
const STANDARD_TRACKER_CATEGORIES = ["Desktop Assessment", "Client Information Review", "Field Plan", "GIS & Mapping", "Field Survey", "Targeted Survey", "Site Inspection", "Data Analysis", "Project Management", "Client Meeting", "Internal Meeting", "Review", "QA Review", "Reporting", "Deliverable Preparation", "Invoice", "Close-Out", "Other"];

async function teamCounts(access) {
  const { data, error } = await access.admin
    .from("project_allocations")
    .select("project_id, staff_user_id, active");
  if (error) {
    // The active flag is introduced with the tracker configuration migration.
    if (tableUnavailable(error) || String(error.message || "").includes("active")) {
      const fallback = await access.admin.from("project_allocations").select("project_id, staff_user_id");
      if (fallback.error) throw new Error(fallback.error.message);
      return fallback.data || [];
    }
    throw new Error(error.message);
  }
  return (data || []).filter((row) => row.active !== false);
}

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const [projects, settingsResult, allocations] = await Promise.all([
      projectRows(auth.access),
      settingsByProject(auth.access),
      teamCounts(auth.access),
    ]);
    const countByProject = new Map();
    allocations.forEach((allocation) => {
      if (!allocation.staff_user_id) return;
      countByProject.set(allocation.project_id, (countByProject.get(allocation.project_id) || 0) + 1);
    });

    return Response.json({
      setupReady: settingsResult.ready,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        clientName: project.client_name,
        budgetHours: project.budget_hours,
        budgetDollars: project.budget_dollars,
        status: project.status,
        teamCount: countByProject.get(project.id) || 0,
        settings: toSettings(settingsResult.settings.get(project.id)),
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

// This controlled quick-start supports the normal staff timesheet path without
// weakening the detailed tracker setup. It preserves a custom template if one
// already exists, fills standard categories only when none have been provided,
// and creates baseline budget records only when required for staff entry.
export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    if (String(body?.action || "") !== "activate_staff_timesheets") return jsonError("Unknown Project Tracker setup action.");
    const projectId = String(body?.projectId || "").trim();
    if (!validProjectId(projectId)) return jsonError("A valid project is required.");

    const { data: project, error: projectError } = await auth.access.admin
      .from("projects")
      .select("id, name, status, budget_hours, budget_dollars")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) return jsonError(projectError.message);
    if (!project) return jsonError("Project not found.", 404);
    if (String(project.status || "").toLowerCase() !== "active") return jsonError("Set the project to Active in Setup & Allocations before enabling staff timesheets.", 409);

    const { data: team, error: teamError } = await auth.access.admin
      .from("project_allocations")
      .select("staff_user_id")
      .eq("project_id", projectId)
      .eq("active", true);
    if (teamError) return jsonError(teamError.message);
    const recipients = (team || []).map((row) => row.staff_user_id).filter(Boolean);
    if (!recipients.length) return jsonError("Allocate at least one active staff member before enabling staff timesheets.", 409);

    const now = new Date().toISOString();
    const { data: existingTemplate, error: templateError } = await auth.access.admin
      .from("project_tracker_templates")
      .select("id, template_name, instructions, category_options, column_definitions, guidance_rows, locked")
      .eq("project_id", projectId)
      .maybeSingle();
    if (templateError) return jsonError(tableUnavailable(templateError) ? "Project Tracker templates are awaiting the approved tracker migration." : templateError.message, tableUnavailable(templateError) ? 409 : 400);

    if (!existingTemplate) {
      const { error } = await auth.access.admin.from("project_tracker_templates").insert({
        project_id: projectId,
        template_name: "Project Tracker",
        instructions: "Record project activity accurately and identify issues requiring project-lead review.",
        category_options: STANDARD_TRACKER_CATEGORIES,
        column_definitions: [],
        guidance_rows: [],
        locked: true,
        locked_by: auth.access.user.id,
        locked_at: now,
        created_by: auth.access.user.id,
        updated_by: auth.access.user.id,
        created_at: now,
        updated_at: now,
      });
      if (error) return jsonError(error.message);
    } else if (!existingTemplate.locked) {
      const categories = Array.isArray(existingTemplate.category_options) && existingTemplate.category_options.length ? existingTemplate.category_options : STANDARD_TRACKER_CATEGORIES;
      const { error } = await auth.access.admin.from("project_tracker_templates").update({
        category_options: categories,
        locked: true,
        locked_by: auth.access.user.id,
        locked_at: now,
        updated_by: auth.access.user.id,
        updated_at: now,
      }).eq("id", existingTemplate.id);
      if (error) return jsonError(error.message);
    }

    const baseline = await ensureBaselineTrackerBudget(auth.access, project, now);
    if (baseline.error) return jsonError(`Could not prepare the staff timesheet baseline: ${baseline.error}`);
    const { data: current, error: currentError } = await auth.access.admin.from("project_tracker_settings").select(settingColumns()).eq("project_id", projectId).maybeSingle();
    if (currentError) return jsonError(tableUnavailable(currentError) ? "Project Tracker Setup is awaiting the approved configuration migration." : currentError.message, tableUnavailable(currentError) ? 409 : 400);
    const previous = toSettings(current);
    const { data: saved, error: settingsError } = await auth.access.admin.from("project_tracker_settings").upsert({
      project_id: projectId,
      tracker_visible: true,
      resources_ready: previous.resourcesReady,
      training_checked: previous.trainingChecked,
      forms_configured: previous.formsConfigured,
      whs_checked: previous.whsChecked,
      activated_by: current?.activated_by || auth.access.user.id,
      activated_at: current?.activated_at || now,
      updated_by: auth.access.user.id,
      updated_at: now,
    }, { onConflict: "project_id" }).select(settingColumns()).single();
    if (settingsError) return jsonError(settingsError.message);

    const { error: auditError } = await auth.access.admin.from("project_tracker_setting_events").insert({
      project_id: projectId,
      action: "staff_timesheet_quickstart",
      actor_id: auth.access.user.id,
      before_state: previous,
      after_state: toSettings(saved),
      summary: `${project.name} staff Project Tracker enabled with a standard locked template and delivery baseline.`,
    });
    if (auditError) return jsonError(auditError.message);
    const { error: eventError } = await auth.access.admin.from("portal_events").insert(recipients.map((recipientId) => ({
      recipient_id: recipientId,
      event_type: "project_tracker_enabled",
      severity: "information",
      title: "Project Tracker access available",
      body: `You can now log project activity and timesheet reference entries for ${project.name}.`,
      href: "/staff/projects",
      source_table: "project_tracker_settings",
      source_id: projectId,
    })));
    if (eventError) console.warn("Project Tracker activation notification could not be created:", eventError.message);
    return Response.json({ settings: toSettings(saved), standardTemplateApplied: !existingTemplate || !existingTemplate.locked });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const projectId = String(body?.projectId || "").trim();
    if (!validProjectId(projectId)) return jsonError("A valid project is required.");

    const settings = {
      trackerVisible: booleanInput(body?.trackerVisible),
      resourcesReady: booleanInput(body?.resourcesReady),
      trainingChecked: booleanInput(body?.trainingChecked),
      formsConfigured: booleanInput(body?.formsConfigured),
      whsChecked: booleanInput(body?.whsChecked),
    };

    const { data: project, error: projectError } = await auth.access.admin
      .from("projects")
      .select("id, name, status, budget_hours, budget_dollars")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) return jsonError(projectError.message);
    if (!project) return jsonError("Project not found.", 404);

    const { data: current, error: currentError } = await auth.access.admin
      .from("project_tracker_settings")
      .select(settingColumns())
      .eq("project_id", projectId)
      .maybeSingle();
    if (currentError) {
      if (tableUnavailable(currentError)) return jsonError("Project Tracker Setup is awaiting the approved configuration migration.", 409);
      return jsonError(currentError.message);
    }

    const projectActive = String(project.status || "").toLowerCase() === "active";
    if (settings.trackerVisible && !projectActive) return jsonError("Set the project to Active before enabling staff tracker visibility.", 409);

    const { data: template, error: templateError } = await auth.access.admin
      .from("project_tracker_templates")
      .select("id, locked")
      .eq("project_id", projectId)
      .maybeSingle();
    if (templateError) {
      if (tableUnavailable(templateError)) return jsonError("Save and lock the staff Project Tracker template after the approved tracker migration is applied.", 409);
      return jsonError(templateError.message);
    }
    if (settings.trackerVisible && !template?.locked) return jsonError("Save and lock the staff Project Tracker template before enabling staff visibility.", 409);

    const { data: activeAllocations, error: allocationError } = await auth.access.admin
      .from("project_allocations")
      .select("staff_user_id")
      .eq("project_id", projectId)
      .eq("active", true);
    if (allocationError) return jsonError(allocationError.message);
    if (settings.trackerVisible && !(activeAllocations || []).some((row) => row.staff_user_id)) {
      return jsonError("Allocate at least one active staff member before enabling the staff tracker.", 409);
    }

    const previous = toSettings(current);
    const isNew = !current;
    const enabling = !previous.trackerVisible && settings.trackerVisible;
    const pausing = previous.trackerVisible && !settings.trackerVisible;
    const now = new Date().toISOString();
    if (settings.trackerVisible) {
      const baseline = await ensureBaselineTrackerBudget(auth.access, project, now);
      if (baseline.error) return jsonError(`Could not prepare the staff timesheet baseline: ${baseline.error}`);
    }
    const payload = {
      project_id: projectId,
      tracker_visible: settings.trackerVisible,
      resources_ready: settings.resourcesReady,
      training_checked: settings.trainingChecked,
      forms_configured: settings.formsConfigured,
      whs_checked: settings.whsChecked,
      updated_by: auth.access.user.id,
      updated_at: now,
      activated_by: enabling ? auth.access.user.id : current?.activated_by || null,
      activated_at: enabling ? now : current?.activated_at || null,
    };
    const { data: saved, error: saveError } = await auth.access.admin
      .from("project_tracker_settings")
      .upsert(payload, { onConflict: "project_id" })
      .select(settingColumns())
      .single();
    if (saveError) return jsonError(saveError.message);

    const action = enabling ? "tracker_enabled" : pausing ? "tracker_paused" : isNew ? "settings_created" : "settings_updated";
    const { error: auditError } = await auth.access.admin.from("project_tracker_setting_events").insert({
      project_id: projectId,
      action,
      actor_id: auth.access.user.id,
      before_state: previous,
      after_state: toSettings(saved),
      summary: `${project.name} Project Tracker ${enabling ? "enabled for allocated staff" : pausing ? "paused for staff" : "setup updated"}.`,
    });
    if (auditError) return jsonError(auditError.message);

    if (enabling) {
      const recipients = (activeAllocations || []).map((row) => row.staff_user_id).filter(Boolean);
      if (recipients.length) {
        const { error: eventError } = await auth.access.admin.from("portal_events").insert(recipients.map((recipientId) => ({
          recipient_id: recipientId,
          event_type: "project_tracker_enabled",
          severity: "information",
          title: "Project Tracker access available",
          body: `You have been allocated to ${project.name}. Its Project Tracker is now available in your Staff Portal.`,
          href: "/staff/projects",
          source_table: "project_tracker_settings",
          source_id: projectId,
        })));
        if (eventError) console.warn("Project Tracker visibility notification could not be created:", eventError.message);
      }
    }

    return Response.json({ settings: toSettings(saved) });
  } catch (error) {
    return serverError(error);
  }
}
