import { supabase } from "./supabaseClient";

/* ---------------------------------------------------------------
   Fetch everything and assemble it into the nested shape the UI
   already understands (phases -> sections -> items -> progress/links,
   ldMonths -> modules -> subheadings -> progress/links, signoffs).
----------------------------------------------------------------- */

export async function fetchWorkbook(userId) {
  const [
    { data: phases, error: e1 },
    { data: sections, error: e2 },
    { data: items, error: e3 },
    { data: progress, error: e4 },
    { data: links, error: e5 },
    { data: months, error: e6 },
    { data: modules, error: e7 },
    { data: signoffs, error: e8 },
    { data: admins, error: e9 },
    { data: staffProgress, error: e10 },
  ] = await Promise.all([
    supabase.from("phases").select("*").order("sort_order"),
    supabase.from("sections").select("*").order("sort_order"),
    supabase.from("checklist_items").select("*").order("sort_order"),
    supabase.from("item_progress").select("*"),
    supabase.from("item_links").select("*").order("sort_order"),
    supabase.from("ld_months").select("*").order("sort_order"),
    supabase.from("ld_modules").select("*").order("sort_order"),
    supabase.from("signoffs").select("*"),
    supabase.from("admin_emails").select("*").order("created_at"),
    userId ? supabase.from("staff_progress").select("*").eq("user_id", userId) : Promise.resolve({ data: [], error: null }),
  ]);

  const firstError = e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8 || e9 || e10;
  if (firstError) throw firstError;

  const progressByItem = Object.fromEntries((progress || []).map((p) => [p.item_id, p]));
  const staffProgressByItem = Object.fromEntries((staffProgress || []).map((p) => [p.item_id, p]));
  const linksByItem = {};
  (links || []).forEach((l) => { (linksByItem[l.item_id] ||= []).push(l); });
  const signoffByModule = Object.fromEntries((signoffs || []).map((s) => [s.module_id, s]));

  // Onboarding checklist items: done/date/notes are personal to the signed-in
  // user (staff_progress). The admin comment stays shared/general guidance
  // on the row, read from item_progress, since it's admin-authored context
  // about the step itself, not feedback tied to one person's attempt at it.
  const buildSectionRow = (item) => ({
    id: item.id,
    title: item.label,
    showDate: item.show_date,
    done: staffProgressByItem[item.id]?.done ?? false,
    date: staffProgressByItem[item.id]?.item_date ?? "",
    notes: staffProgressByItem[item.id]?.notes ?? "",
    comment: progressByItem[item.id]?.admin_comment ?? "",
    links: (linksByItem[item.id] || []).map((l) => ({ id: l.id, label: l.label, url: l.url })),
  });

  // L&D module topics: unchanged, shared item_progress as before.
  const buildModuleRow = (item) => ({
    id: item.id,
    title: item.label,
    showDate: item.show_date,
    done: progressByItem[item.id]?.done ?? false,
    date: progressByItem[item.id]?.item_date ?? "",
    notes: progressByItem[item.id]?.notes ?? "",
    comment: progressByItem[item.id]?.admin_comment ?? "",
    links: (linksByItem[item.id] || []).map((l) => ({ id: l.id, label: l.label, url: l.url })),
  });

  const itemsBySection = {};
  const itemsByModule = {};
  (items || []).forEach((it) => {
    if (it.section_id) (itemsBySection[it.section_id] ||= []).push(it);
    if (it.module_id) (itemsByModule[it.module_id] ||= []).push(it);
  });

  const sectionsByPhase = {};
  (sections || []).forEach((s) => { (sectionsByPhase[s.phase_id] ||= []).push(s); });

  const modulesByMonth = {};
  (modules || []).forEach((m) => { (modulesByMonth[m.month_id] ||= []).push(m); });

  const outPhases = (phases || []).map((p) => ({
    id: p.id, slug: p.slug, label: p.label, subtitle: p.subtitle,
    sections: (sectionsByPhase[p.id] || []).map((s) => ({
      id: s.id, title: s.title, note: s.note, mentor: s.mentor ?? "",
      items: (itemsBySection[s.id] || []).map(buildSectionRow),
    })),
  }));

  const outMonths = (months || []).map((m) => ({
    id: m.id, name: m.name, unlocked: m.unlocked,
    modules: (modulesByMonth[m.id] || []).map((mod) => {
      const so = signoffByModule[mod.id] || {};
      return {
        id: mod.id, title: mod.title, sme: mod.sme,
        subheadings: (itemsByModule[mod.id] || []).map(buildModuleRow),
        signoff: {
          targetCompletion: so.target_completion ?? "",
          sme: so.sme ?? "",
          overview: so.overview ?? "",
          learningOutcomes: so.learning_outcomes ?? [],
          materials: so.training_materials ?? [],
          assessment: so.assessment_items ?? [],
          evidence: so.evidence_items ?? [],
          outcome: so.outcome ?? null,
          assessedBy: so.assessed_by ?? "",
          signName: so.sign_name ?? "",
          signDate: so.sign_date ?? "",
        },
      };
    }),
  }));

  return { phases: outPhases, ldMonths: outMonths, adminEmails: (admins || []).map((a) => a.email) };
}

/* ---------------------------------------------------------------
   Staff-writable: progress only (done / date / notes)
----------------------------------------------------------------- */

export async function saveItemProgress(itemId, patch, byEmail) {
  const row = {};
  if ("done" in patch) row.done = patch.done;
  if ("date" in patch) row.item_date = patch.date;
  if ("notes" in patch) row.notes = patch.notes;
  if ("comment" in patch) row.admin_comment = patch.comment;
  row.updated_by = byEmail;
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from("item_progress").update(row).eq("item_id", itemId);
  if (error) throw error;
}

// Onboarding checklist items only: each staff member's own done/date/notes,
// upserted into staff_progress. Admins cannot write here by design (see the
// RLS policy) — only the signed-in user can update their own row.
export async function saveSectionProgress(userId, itemId, patch) {
  const row = { user_id: userId, item_id: itemId, updated_at: new Date().toISOString() };
  if ("done" in patch) row.done = patch.done;
  if ("date" in patch) row.item_date = patch.date;
  if ("notes" in patch) row.notes = patch.notes;
  const { error } = await supabase.from("staff_progress").upsert(row, { onConflict: "user_id,item_id" });
  if (error) throw error;
}

// Convenience wrapper: derives the current user from the active session so
// call sites don't need to thread userId through every component.
export async function saveMyProgress(itemId, patch) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in");
  return saveSectionProgress(userId, itemId, patch);
}

// Admin-authored guidance on an onboarding checklist row — shared across
// whoever views that row, not tied to one person's staff_progress entry.
export async function updateAdminComment(itemId, comment) {
  const { error } = await supabase
    .from("item_progress")
    .update({ admin_comment: comment, updated_at: new Date().toISOString() })
    .eq("item_id", itemId);
  if (error) throw error;
}

// Admin-only: the staff directory + per-person onboarding completion,
// served by /api/admin/staff (verifies the caller server-side before
// touching anything privileged).
export async function fetchStaffProgress() {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/admin/staff", {
    headers: { Authorization: `Bearer ${session?.access_token || ""}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load staff progress");
  return body;
}

/* ---------------------------------------------------------------
   Admin-only: structural content
----------------------------------------------------------------- */

export async function addSection(phaseId, title, sortOrder) {
  const { data, error } = await supabase.from("sections").insert({ phase_id: phaseId, title, sort_order: sortOrder }).select().single();
  if (error) throw error;
  return data;
}
export async function updateSectionMentor(sectionId, mentor) {
  const { error } = await supabase.from("sections").update({ mentor }).eq("id", sectionId);
  if (error) throw error;
}
export async function updateMonthLock(monthId, unlocked) {
  const { error } = await supabase.from("ld_months").update({ unlocked }).eq("id", monthId);
  if (error) throw error;
}
export async function updateMonthName(monthId, name) {
  const { error } = await supabase.from("ld_months").update({ name }).eq("id", monthId);
  if (error) throw error;
}
export async function addItem(parent, label, sortOrder) {
  const payload = { label, sort_order: sortOrder, show_date: !!parent.section_id };
  if (parent.section_id) payload.section_id = parent.section_id;
  if (parent.module_id) payload.module_id = parent.module_id;
  const { data: item, error } = await supabase.from("checklist_items").insert(payload).select().single();
  if (error) throw error;
  const { error: e2 } = await supabase.from("item_progress").insert({ item_id: item.id });
  if (e2) throw e2;
  return item;
}
export async function deleteItem(itemId) {
  const { error } = await supabase.from("checklist_items").delete().eq("id", itemId);
  if (error) throw error;
}
export async function renameItem(itemId, label) {
  const { error } = await supabase.from("checklist_items").update({ label }).eq("id", itemId);
  if (error) throw error;
}

export async function addLink(itemId, label, url, sortOrder) {
  const { data, error } = await supabase.from("item_links").insert({ item_id: itemId, label, url, sort_order: sortOrder }).select().single();
  if (error) throw error;
  return data;
}
export async function removeLink(linkId) {
  const { error } = await supabase.from("item_links").delete().eq("id", linkId);
  if (error) throw error;
}

export async function addMonth(name, sortOrder) {
  const { data, error } = await supabase.from("ld_months").insert({ name, sort_order: sortOrder }).select().single();
  if (error) throw error;
  return data;
}
export async function addModule(monthId, title, sme, sortOrder) {
  const { data: mod, error } = await supabase.from("ld_modules").insert({ month_id: monthId, title, sme, sort_order: sortOrder }).select().single();
  if (error) throw error;
  const { error: e2 } = await supabase.from("signoffs").insert({
    module_id: mod.id, target_completion: "", sme, assessed_by: sme,
    learning_outcomes: [], training_materials: [], assessment_items: [], evidence_items: [],
  });
  if (e2) throw e2;
  return mod;
}
export async function deleteModule(moduleId) {
  const { error } = await supabase.from("ld_modules").delete().eq("id", moduleId);
  if (error) throw error;
}
export async function updateModule(moduleId, patch) {
  const { error } = await supabase.from("ld_modules").update(patch).eq("id", moduleId);
  if (error) throw error;
}

export async function updateSignoff(moduleId, signoff) {
  const row = {
    target_completion: signoff.targetCompletion,
    sme: signoff.sme,
    overview: signoff.overview,
    learning_outcomes: signoff.learningOutcomes,
    training_materials: signoff.materials,
    assessment_items: signoff.assessment,
    evidence_items: signoff.evidence,
    outcome: signoff.outcome,
    assessed_by: signoff.assessedBy,
    sign_name: signoff.signName,
    sign_date: signoff.signDate,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("signoffs").update(row).eq("module_id", moduleId);
  if (error) throw error;
}

export async function addAdminEmail(email, addedBy) {
  const { error } = await supabase.from("admin_emails").insert({ email: email.trim().toLowerCase(), added_by: addedBy });
  if (error) throw error;
}
export async function removeAdminEmail(email) {
  const { error } = await supabase.from("admin_emails").delete().eq("email", email);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   Training Library — the capability framework, external credential
   pathways, and module guides shown in the Training Library tab.
   Readable by anyone signed in; only admins can edit.
----------------------------------------------------------------- */

export async function fetchTrainingLibrary() {
  const { data, error } = await supabase.from("training_library_levels").select("*").order("sort_order");
  if (error) throw error;
  return (data || []).map((r) => ({
    level: r.level,
    sortOrder: r.sort_order,
    capabilities: r.capabilities || {},
    externalPathway: r.external_pathway || [],
    moduleGuides: r.module_guides || [],
  }));
}

export async function updateTrainingLibraryLevel(level, patch) {
  const row = { updated_at: new Date().toISOString() };
  if ("capabilities" in patch) row.capabilities = patch.capabilities;
  if ("externalPathway" in patch) row.external_pathway = patch.externalPathway;
  if ("moduleGuides" in patch) row.module_guides = patch.moduleGuides;
  const { error } = await supabase.from("training_library_levels").update(row).eq("level", level);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   Resource Library — topic folders (Flora, Fauna, GIS, etc.), each
   holding one sub-folder per career level, each holding a list of
   resources (plain text or uploaded files). Readable by anyone
   signed in; only admins can add/remove folder contents.
----------------------------------------------------------------- */

export async function fetchResourceFolders() {
  const { data, error } = await supabase.from("resource_folders").select("*").order("sort_order");
  if (error) throw error;
  return (data || []).map((r) => ({
    topic: r.topic, level: r.level,
    resources: r.resources || [],
    modules: r.modules || [],
    quizzes: r.quizzes || [],
  }));
}

// field is "resources" | "modules" | "quizzes"
export async function updateResourceFolder(topic, level, field, items) {
  const { error } = await supabase
    .from("resource_folders")
    .update({ [field]: items, updated_at: new Date().toISOString() })
    .eq("topic", topic).eq("level", level);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   Assigned Onboarding — modules an admin drafts for one specific
   staff member. Invisible to that person until an admin unlocks
   the module; once unlocked they can tick/note but never rename.
----------------------------------------------------------------- */

export async function fetchAssignedModules(staffUserId) {
  const [{ data: modules, error: e1 }, { data: topics, error: e2 }, { data: progress, error: e3 }] = await Promise.all([
    supabase.from("assigned_modules").select("*").eq("staff_user_id", staffUserId).order("sort_order"),
    supabase.from("assigned_topics").select("*").order("sort_order"),
    supabase.from("assigned_topic_progress").select("*"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const progressByTopic = Object.fromEntries((progress || []).map((p) => [p.topic_id, p]));
  const topicsByModule = {};
  (topics || []).forEach((t) => { (topicsByModule[t.module_id] ||= []).push(t); });

  return (modules || []).map((m) => ({
    id: m.id, title: m.title, sme: m.sme || "", unlocked: m.unlocked,
    topics: (topicsByModule[m.id] || []).map((t) => ({
      id: t.id, title: t.title,
      done: progressByTopic[t.id]?.done ?? false,
      date: progressByTopic[t.id]?.item_date ?? "",
      notes: progressByTopic[t.id]?.notes ?? "",
    })),
  }));
}

// For the current signed-in user, viewing their own assignment.
export async function fetchMyAssignedModules() {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  return fetchAssignedModules(userId);
}

export async function addAssignedModule(staffUserId, title, sme, sortOrder, createdBy) {
  const { data, error } = await supabase.from("assigned_modules")
    .insert({ staff_user_id: staffUserId, title, sme, sort_order: sortOrder, created_by: createdBy })
    .select().single();
  if (error) throw error;
  return data;
}
export async function updateAssignedModule(moduleId, patch) {
  const { error } = await supabase.from("assigned_modules")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", moduleId);
  if (error) throw error;
}
export async function deleteAssignedModule(moduleId) {
  const { error } = await supabase.from("assigned_modules").delete().eq("id", moduleId);
  if (error) throw error;
}

export async function addAssignedTopic(moduleId, title, sortOrder) {
  const { data: topic, error } = await supabase.from("assigned_topics")
    .insert({ module_id: moduleId, title, sort_order: sortOrder }).select().single();
  if (error) throw error;
  const { error: e2 } = await supabase.from("assigned_topic_progress").insert({ topic_id: topic.id });
  if (e2) throw e2;
  return topic;
}
export async function updateAssignedTopic(topicId, title) {
  const { error } = await supabase.from("assigned_topics").update({ title }).eq("id", topicId);
  if (error) throw error;
}
export async function deleteAssignedTopic(topicId) {
  const { error } = await supabase.from("assigned_topics").delete().eq("id", topicId);
  if (error) throw error;
}

// Staff-only: their own progress on their own unlocked topics.
export async function saveAssignedProgress(topicId, patch) {
  const row = { updated_at: new Date().toISOString() };
  if ("done" in patch) row.done = patch.done;
  if ("date" in patch) row.item_date = patch.date;
  if ("notes" in patch) row.notes = patch.notes;
  const { error } = await supabase.from("assigned_topic_progress").update(row).eq("topic_id", topicId);
  if (error) throw error;
}
