-- Ecology Project Close Report. ADDITIVE; apply only to the approved Ecology
-- database after restoring that connection. Never apply to Solum. No external
-- jobs or financial/improvement records are deleted by this migration.
begin;

alter table public.project_closeouts
  add column if not exists report_data jsonb,
  add column if not exists report_revision integer not null default 0 check (report_revision >= 0),
  add column if not exists review_round integer not null default 1 check (review_round > 0),
  add column if not exists override_reason text,
  add column if not exists override_by uuid references auth.users(id) on delete set null,
  add column if not exists override_at timestamptz,
  add column if not exists applied_to_project boolean not null default false;

create table if not exists public.project_closeout_invitations (
  id uuid primary key default gen_random_uuid(),
  closeout_id uuid not null references public.project_closeouts(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  review_round integer not null default 1 check (review_round > 0),
  status text not null default 'pending' check (status in ('pending', 'draft', 'submitted', 'cancelled', 'closed')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (closeout_id, staff_user_id, review_round)
);
create index if not exists project_closeout_invitations_project_idx on public.project_closeout_invitations(project_id, review_round, status);
create index if not exists project_closeout_invitations_recipient_idx on public.project_closeout_invitations(staff_user_id, closeout_id, review_round desc);

-- Each reopened review round gets a NEW response row. Original submitted JSON
-- remains immutable; no legacy feedback is deleted or silently reset to draft.
alter table public.project_closeout_feedback
  add column if not exists review_round integer not null default 1 check (review_round > 0),
  add column if not exists invitation_id uuid references public.project_closeout_invitations(id) on delete restrict;
alter table public.project_closeout_feedback drop constraint if exists project_closeout_feedback_closeout_id_staff_user_id_key;
create unique index if not exists project_closeout_feedback_round_key on public.project_closeout_feedback(closeout_id, staff_user_id, review_round);

create table if not exists public.project_closeout_revisions (
  id uuid primary key default gen_random_uuid(),
  closeout_id uuid not null references public.project_closeouts(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  revision integer not null,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now(),
  unique(closeout_id, revision)
);

alter table public.project_closeout_invitations enable row level security;
alter table public.project_closeout_revisions enable row level security;
-- No browser-facing policies or broad grants. Existing legacy RLS is retained.
revoke all on public.project_closeout_invitations, public.project_closeout_revisions from public, anon, authenticated;
grant select, insert, update on public.project_closeout_invitations to service_role;
grant select, insert on public.project_closeout_revisions to service_role;

create or replace function public.project_closeout_is_team_member(p_project_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p join auth.users u on u.id = p_user_id
    where p.id = p_project_id and p.deleted_at is null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.raw_user_meta_data->>'staff_directory_active', 'true') <> 'false'
      and (
        p.project_lead_user_id = p_user_id or p.overseeing_senior_ecologist_user_id = p_user_id
        or exists (select 1 from public.project_allocations a where a.project_id = p.id and a.staff_user_id = p_user_id and a.active = true)
        or exists (
          select 1 from public.project_activities a join public.project_activity_assignees s on s.activity_id = a.id
          where a.project_id = p.id and a.is_active = true and s.staff_user_id = p_user_id
            and s.removed_at is null and s.acceptance_status not in ('removed', 'declined')
        )
        or exists (
          select 1 from public.project_activities a
          where a.project_id = p.id and a.is_active = true and a.staff_user_id = p_user_id
            and coalesce(a.acceptance_status, 'accepted') not in ('removed', 'declined')
            and not exists (select 1 from public.project_activity_assignees s where s.activity_id = a.id)
        )
      )
  );
$$;

create or replace function public.project_closeout_can_manage(p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u where u.id = p_actor_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and (
      lower(u.email) in ('aaron.dooley@ecologyconsulting.au', 'tony.webster@ecologyconsulting.au')
      or (exists (select 1 from public.admin_emails a where lower(a.email) = lower(u.email))
          and not exists (select 1 from public.portal_visibility_overrides v where v.user_id = u.id and v.resource_key = 'admin.projects' and v.is_visible = false))
    )
  );
$$;

-- Defence in depth: RPCs receive only canonical report JSON from the API, but
-- reject malformed/oversized JSON even when called directly by service tooling.
create or replace function public.project_closeout_validate_json(p_report jsonb, p_feedback boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; section text; row_value jsonb; val jsonb; allowed text[]; dt text; n numeric;
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' or octet_length(p_report::text) > 32000000 then
    raise exception 'CLOSEOUT_INVALID_INPUT: A valid report or response object is required.';
  end if;
  if p_feedback then
    if exists (select 1 from jsonb_object_keys(p_report) as t(key) where key not in ('hurdles', 'lessons')) then
      raise exception 'CLOSEOUT_INVALID_INPUT: Responses may contain only hurdles and lessons.';
    end if;
  else
    foreach k in array array['name','number','client','start','end','closedBy','approvedBy','closeDate'] loop
      val := p_report->k;
      if val is not null and (jsonb_typeof(val) <> 'string' or length(p_report->>k) > 5000) then
        raise exception 'CLOSEOUT_INVALID_INPUT: Report text must be at most 5000 characters.';
      end if;
      if k in ('start','end','closeDate') and coalesce(p_report->>k, '') <> '' then
        dt := p_report->>k;
        if dt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid report date.'; end if;
        begin
          if to_char(dt::date, 'YYYY-MM-DD') <> dt then raise exception 'invalid date'; end if;
        exception when others then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid report date.'; end;
      end if;
    end loop;
  end if;
  foreach section in array (case when p_feedback then array['hurdles','lessons'] else array['deliverables','seniors','ecologists','hurdles','lessons'] end) loop
    val := p_report->section;
    if val is null then continue; end if;
    if jsonb_typeof(val) <> 'array' then raise exception 'CLOSEOUT_INVALID_INPUT: Report rows must be arrays.'; end if;
    if jsonb_array_length(val) > (case section when 'seniors' then 3 when 'ecologists' then 10 else 100 end) then
      raise exception 'CLOSEOUT_INVALID_INPUT: Too many report rows.';
    end if;
    allowed := case section when 'deliverables' then array['title','budget','hrs','actual'] when 'seniors' then array['name','role'] when 'ecologists' then array['name','role'] when 'hurdles' then array['hurdle','impact','resolution'] else array['lesson','action','owner','due','status'] end;
    for row_value in select value from jsonb_array_elements(val) loop
      if jsonb_typeof(row_value) <> 'object' then raise exception 'CLOSEOUT_INVALID_INPUT: Each report row must be an object.'; end if;
      foreach k in array allowed loop
        val := row_value->k;
        if val is null then continue; end if;
        if section = 'deliverables' and k in ('budget','hrs','actual') then
          if jsonb_typeof(val) not in ('number', 'string') then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid numeric field.'; end if;
          if row_value->>k = '' then continue; end if;
          if length(row_value->>k) > 5000 or (row_value->>k) !~ '^([0-9]+(\.[0-9]*)?|\.[0-9]+)$' then raise exception 'CLOSEOUT_INVALID_INPUT: Numbers must be non-negative decimals.'; end if;
          begin
            n := (row_value->>k)::numeric;
            if n > 1.7976931348623157e308::numeric then raise exception 'number too large'; end if;
          exception when others then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid numeric field.'; end;
        else
          if jsonb_typeof(val) <> 'string' or length(row_value->>k) > 5000 then raise exception 'CLOSEOUT_INVALID_INPUT: Row text must be at most 5000 characters.'; end if;
          if section = 'lessons' and k = 'status' and (row_value->>k) not in ('Open','In progress','Complete') then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid lesson status.'; end if;
          if k = 'due' and coalesce(row_value->>k, '') <> '' then
            dt := row_value->>k;
            if dt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid lesson due date.'; end if;
            begin
              if to_char(dt::date, 'YYYY-MM-DD') <> dt then raise exception 'invalid date'; end if;
            exception when others then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid lesson due date.'; end;
          end if;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

-- All state transitions, invitations, staff writes and improvement mutations use
-- one project lock order. The project/closeout/audit/revision/events either all
-- commit or all roll back. expectedRevision is mandatory for master mutations.
create or replace function public.mutate_project_closeout(
  p_project_id uuid,
  p_actor_id uuid,
  p_action text,
  p_expected_revision integer,
  p_payload jsonb default '{}'::jsonb,
  p_staff_audience boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.projects%rowtype;
  c public.project_closeouts%rowtype;
  i public.project_closeout_invitations%rowtype;
  f public.project_closeout_feedback%rowtype;
  improvement public.project_improvement_actions%rowtype;
  before_c jsonb;
  before_f jsonb;
  before_project jsonb;
  report jsonb;
  recipient uuid;
  reason_text text;
  pending integer;
  invited integer := 0;
  actor_admin boolean;
  master_action boolean;
  t timestamptz := now();
  next_status text;
begin
  if p_action is null or p_action not in ('save_report','lock_report','submit_report','reopen_report','invite_team','override_close','save_feedback','submit_feedback','archive_project','upsert_improvement','archive_improvement','legacy_update') then
    raise exception 'CLOSEOUT_INVALID_INPUT: Unknown close-out action.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 32000000 then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid request payload.'; end if;
  if p_actor_id is null or not exists (select 1 from auth.users u where u.id = p_actor_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= t)) then raise exception 'CLOSEOUT_FORBIDDEN: A valid signed-in actor is required.'; end if;
  actor_admin := public.project_closeout_can_manage(p_actor_id) and not coalesce(p_staff_audience, false);
  master_action := p_action not in ('save_feedback','submit_feedback','upsert_improvement','archive_improvement');
  if p_action not in ('save_feedback','submit_feedback') and not actor_admin then raise exception 'CLOSEOUT_FORBIDDEN: Only authorised project administrators can manage the report.'; end if;
  if p_action in ('save_feedback','submit_feedback') and not coalesce(p_staff_audience, false) then raise exception 'CLOSEOUT_FORBIDDEN: Use your invited staff workspace for your own response.'; end if;
  select * into p from public.projects where id = p_project_id and deleted_at is null for update;
  if not found then raise exception 'CLOSEOUT_NOT_FOUND: Project not found.'; end if;
  before_project := jsonb_build_object('status', p.status);
  select * into c from public.project_closeouts where project_id = p_project_id for update;
  if master_action and (p_expected_revision is null or p_expected_revision < 0) then raise exception 'CLOSEOUT_INVALID_INPUT: expectedRevision is required.'; end if;
  if master_action and p_expected_revision <> coalesce(c.report_revision, 0) then
    raise exception 'CLOSEOUT_REVISION_CONFLICT: The report has changed. Reload before saving (current revision %).', coalesce(c.report_revision, 0);
  end if;
  if c.id is null and p_action in ('save_feedback','submit_feedback','reopen_report','invite_team','archive_project') then raise exception 'CLOSEOUT_STATE_CONFLICT: Save a report before this action.'; end if;
  if p.status = 'archived' or c.status = 'archived' then raise exception 'CLOSEOUT_LOCKED: Archived projects cannot be changed or implicitly unarchived.'; end if;

  if p_action in ('upsert_improvement','archive_improvement') then
    if c.locked_at is not null or c.status = 'closed' then raise exception 'CLOSEOUT_LOCKED: Reopen the close-out before changing improvement actions.'; end if;
    if nullif(p_payload->>'closeoutId', '') is not null and not exists (select 1 from public.project_closeouts where id = (p_payload->>'closeoutId')::uuid and project_id = p_project_id) then raise exception 'CLOSEOUT_INVALID_INPUT: The close-out does not belong to this project.'; end if;
    if nullif(p_payload->>'actionId', '') is not null then
      select * into improvement from public.project_improvement_actions where id = (p_payload->>'actionId')::uuid and project_id = p_project_id and is_active = true for update;
      if not found then raise exception 'CLOSEOUT_NOT_FOUND: Improvement action not found in this project.'; end if;
      if improvement.locked then raise exception 'CLOSEOUT_LOCKED: This improvement action is locked.'; end if;
      before_f := to_jsonb(improvement);
    elsif p_action = 'archive_improvement' then raise exception 'CLOSEOUT_INVALID_INPUT: An improvement action is required.';
    end if;
    if p_action = 'archive_improvement' then
      update public.project_improvement_actions set is_active = false, status = 'archived', updated_by = p_actor_id, updated_at = t where id = improvement.id returning * into improvement;
    else
      if nullif(trim(p_payload->>'title'), '') is null or length(p_payload->>'title') > 5000 or length(coalesce(p_payload->>'description', '')) > 5000 then raise exception 'CLOSEOUT_INVALID_INPUT: A valid improvement title and description are required.'; end if;
      if coalesce(p_payload->>'status','draft') not in ('draft','assigned','in_progress','completed','verified','archived') then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid improvement status.'; end if;
      if nullif(p_payload->>'assignedTo', '') is not null and not public.project_closeout_is_team_member(p_project_id, (p_payload->>'assignedTo')::uuid) then raise exception 'CLOSEOUT_NOT_TEAM: Improvement assignees must be current project team members.'; end if;
      if improvement.id is null then
        insert into public.project_improvement_actions(project_id, closeout_id, title, description, assigned_to, status, due_date, created_by, updated_by)
        values (p_project_id, nullif(p_payload->>'closeoutId','')::uuid, trim(p_payload->>'title'), p_payload->>'description', nullif(p_payload->>'assignedTo','')::uuid, coalesce(p_payload->>'status','draft'), nullif(p_payload->>'dueDate','')::date, p_actor_id, p_actor_id) returning * into improvement;
      else
        update public.project_improvement_actions set closeout_id = nullif(p_payload->>'closeoutId','')::uuid, title = trim(p_payload->>'title'), description = p_payload->>'description', assigned_to = nullif(p_payload->>'assignedTo','')::uuid, status = coalesce(p_payload->>'status','draft'), due_date = nullif(p_payload->>'dueDate','')::date, updated_by = p_actor_id, updated_at = t where id = improvement.id returning * into improvement;
      end if;
    end if;
    insert into public.admin_audit_log(actor_id, action, entity_type, entity_id, project_id, resource_key, before_data, after_data)
    values (p_actor_id, p_action, 'project_improvement_actions', improvement.id, p_project_id, 'admin.projects', before_f, to_jsonb(improvement));
    return jsonb_build_object('action', to_jsonb(improvement));
  end if;

  if c.id is null then
    insert into public.project_closeouts(project_id, created_by, updated_by) values (p_project_id, p_actor_id, p_actor_id) returning * into c;
  end if;
  before_c := to_jsonb(c);

  if p_action in ('save_feedback','submit_feedback') then
    if not public.project_closeout_is_team_member(p_project_id, p_actor_id) then raise exception 'CLOSEOUT_NOT_TEAM: You are no longer a current member of this project team.'; end if;
    if lower(coalesce((select email from auth.users where id = p_actor_id), '')) not in ('aaron.dooley@ecologyconsulting.au','tony.webster@ecologyconsulting.au') and exists (select 1 from public.portal_visibility_overrides v where v.user_id = p_actor_id and v.resource_key = 'staff.notifications' and v.is_visible = false) then raise exception 'CLOSEOUT_FORBIDDEN: Staff notifications access is disabled.'; end if;
    if c.locked_at is not null or c.status in ('closed','archived') then raise exception 'CLOSEOUT_LOCKED: This close-out is locked. Your saved work is retained.'; end if;
    select * into i from public.project_closeout_invitations where closeout_id = c.id and project_id = p_project_id and staff_user_id = p_actor_id and review_round = c.review_round for update;
    if not found then raise exception 'CLOSEOUT_NOT_INVITED: You are not invited to this review round.'; end if;
    if i.status = 'submitted' then raise exception 'CLOSEOUT_RESPONSE_SUBMITTED: Your submitted response is locked and retained for review.'; end if;
    if i.status not in ('pending','draft') then raise exception 'CLOSEOUT_NOT_INVITED: This invitation is no longer actionable.'; end if;
    select * into f from public.project_closeout_feedback where closeout_id = c.id and staff_user_id = p_actor_id and review_round = c.review_round for update;
    if not found then raise exception 'CLOSEOUT_STATE_CONFLICT: The invited response draft is missing.'; end if;
    if f.status = 'submitted' then raise exception 'CLOSEOUT_RESPONSE_SUBMITTED: Your submitted response is locked and retained for review.'; end if;
    perform public.project_closeout_validate_json(p_payload->'response', true);
    before_f := to_jsonb(f);
    update public.project_closeout_feedback set response = p_payload->'response', status = case p_action when 'submit_feedback' then 'submitted' else 'draft' end, submitted_at = case when p_action = 'submit_feedback' then t else null end, updated_at = t where id = f.id returning * into f;
    update public.project_closeout_invitations set status = case p_action when 'submit_feedback' then 'submitted' else 'draft' end, submitted_at = case when p_action = 'submit_feedback' then t else null end, updated_at = t where id = i.id returning * into i;
    if p_action = 'submit_feedback' then
      update public.portal_events set dismissed_at = t where source_table = 'project_closeout_invitations' and source_id = i.id and dismissed_at is null;
      -- Lead and the inviting administrator only. Never broadcast to all staff.
      insert into public.portal_events(recipient_id, event_type, severity, title, body, href, source_table, source_id)
      select distinct r.id, 'project_closeout_feedback_submitted', 'review', 'Project close-out response submitted', 'A team member has submitted their response for ' || p.name || '.', case when public.project_closeout_can_manage(r.id) then '/?portal=admin&workspace=adminprojects&projectView=closeout&projectId=' || p_project_id::text else '/staff/notifications' end, 'project_closeout_feedback', f.id
      from (select p.project_lead_user_id as id union select i.invited_by) r
      where r.id is not null and r.id <> p_actor_id and (r.id = p.project_lead_user_id or public.project_closeout_can_manage(r.id));
    end if;
    insert into public.admin_audit_log(actor_id, action, entity_type, entity_id, project_id, resource_key, before_data, after_data)
    values (p_actor_id, p_action, 'project_closeout_feedback', f.id, p_project_id, 'staff.notifications', before_f, to_jsonb(f));
    -- Personal saves do not bump the master revision or leak the master report.
    return jsonb_build_object('feedback', to_jsonb(f), 'invitation', to_jsonb(i), 'report_revision', c.report_revision);
  end if;

  if p_action not in ('reopen_report','archive_project') and ((c.locked_at is not null and p_action <> 'override_close') or c.status = 'closed') then
    raise exception 'CLOSEOUT_LOCKED: Reopen the close-out with a reason before editing.';
  end if;
  reason_text := nullif(trim(p_payload->>'reason'), '');
  if p_action in ('reopen_report','override_close') and (reason_text is null or length(reason_text) > 5000) then raise exception 'CLOSEOUT_INVALID_INPUT: A reason of at most 5000 characters is required.'; end if;

  if p_action in ('save_report','lock_report','submit_report') then
    report := p_payload->'report';
    perform public.project_closeout_validate_json(report, false);
    if p_action = 'submit_report' then
      if nullif(trim(report->>'name'),'') is null or nullif(trim(report->>'closedBy'),'') is null or nullif(trim(report->>'approvedBy'),'') is null or nullif(trim(report->>'closeDate'),'') is null or not exists (select 1 from jsonb_array_elements(coalesce(report->'deliverables','[]'::jsonb)) d where nullif(trim(d->>'title'),'') is not null) then raise exception 'CLOSEOUT_REPORT_INCOMPLETE: Complete project name, closed by, approved by, close date and at least one deliverable title.'; end if;
    end if;
    update public.project_closeouts set report_data = report, initiated_at = coalesce(initiated_at, t), status = case when status = 'not_started' then 'initiated' else status end where id = c.id returning * into c;
    if p_action = 'lock_report' then
      update public.project_closeouts set locked_at = t, locked_by = p_actor_id where id = c.id returning * into c;
    end if;
  end if;

  if p_action = 'invite_team' then
    if c.report_data is null then raise exception 'CLOSEOUT_STATE_CONFLICT: Save the report before inviting the team.'; end if;
    if jsonb_typeof(p_payload->'staffUserIds') is distinct from 'array' then raise exception 'CLOSEOUT_INVALID_INPUT: Select project team members.'; end if;
    if jsonb_array_length(p_payload->'staffUserIds') not between 1 and 500 then raise exception 'CLOSEOUT_INVALID_INPUT: Select between 1 and 500 team members.'; end if;
    for recipient in select distinct value::uuid from jsonb_array_elements_text(p_payload->'staffUserIds') loop
      if not public.project_closeout_is_team_member(p_project_id, recipient) then raise exception 'CLOSEOUT_NOT_TEAM: Invitations may only be sent to current project team members.'; end if;
      -- Existing pending/draft/submitted invitations and feedback are never reset.
      insert into public.project_closeout_invitations(closeout_id, project_id, staff_user_id, review_round, invited_by)
      values (c.id, p_project_id, recipient, c.review_round, p_actor_id)
      on conflict (closeout_id, staff_user_id, review_round) do nothing returning * into i;
      if i.id is not null then
        -- A pre-upgrade submitted feedback row is preserved and treated as an
        -- already submitted review rather than being overwritten by invitation.
        insert into public.project_closeout_feedback(closeout_id, staff_user_id, response, status, review_round, invitation_id)
        values (c.id, recipient, '{"hurdles":[],"lessons":[]}'::jsonb, 'draft', c.review_round, i.id)
        on conflict (closeout_id, staff_user_id, review_round) do nothing;
        select * into f from public.project_closeout_feedback where closeout_id = c.id and staff_user_id = recipient and review_round = c.review_round;
        update public.project_closeout_feedback set invitation_id = i.id where id = f.id and invitation_id is null;
        if f.status = 'submitted' then
          update public.project_closeout_invitations set status = 'submitted', submitted_at = f.submitted_at, updated_at = t where id = i.id;
        else
          insert into public.portal_events(recipient_id, event_type, severity, title, body, href, source_table, source_id)
          values (recipient, 'project_closeout_invited', 'action_required', 'Project close-out review: ' || p.name, 'Please add your own hurdles and lessons to the Project Close Report.', '/staff/project-closeout?projectId=' || p_project_id::text, 'project_closeout_invitations', i.id);
          invited := invited + 1;
        end if;
      end if;
    end loop;
    update public.project_closeouts set status = 'awaiting_reviews' where id = c.id returning * into c;
  end if;

  if p_action = 'legacy_update' then
    next_status := p_payload->>'status';
    if next_status is null or next_status not in ('not_started','initiated','awaiting_reviews','awaiting_manager_approval','closed') then raise exception 'CLOSEOUT_INVALID_INPUT: Invalid legacy close-out status.'; end if;
    if c.report_data is not null and next_status = 'closed' then raise exception 'CLOSEOUT_INVALID_INPUT: Use submit_report to validate and submit the saved template.'; end if;
    if next_status = 'closed' and (coalesce((p_payload->>'success_score')::integer, 0) not between 1 and 5 or nullif(trim(p_payload->>'client_outcome'),'') is null or nullif(trim(p_payload->>'delivery_summary'),'') is null or nullif(trim(p_payload->>'financial_review_notes'),'') is null or nullif(trim(p_payload->>'approval_note'),'') is null) then raise exception 'CLOSEOUT_REPORT_INCOMPLETE: Complete all legacy approval fields before closing.'; end if;
    update public.project_closeouts set status = next_status, success_score = (p_payload->>'success_score')::integer, client_outcome = p_payload->>'client_outcome', delivery_summary = p_payload->>'delivery_summary', lessons_learned = p_payload->>'lessons_learned', stakeholder_feedback = p_payload->>'stakeholder_feedback', financial_review_notes = p_payload->>'financial_review_notes', recommendations = p_payload->>'recommendations', approval_note = p_payload->>'approval_note', initiated_at = case when next_status <> 'not_started' then coalesce(initiated_at, t) else initiated_at end where id = c.id returning * into c;
  end if;

  if p_action = 'submit_report' or (p_action = 'legacy_update' and c.status = 'closed') then
    select count(*) into pending from public.project_closeout_invitations where closeout_id = c.id and review_round = c.review_round and status in ('pending','draft');
    if pending > 0 then raise exception 'CLOSEOUT_OUTSTANDING_REVIEWS: % invited team response(s) remain pending or draft. Wait for submission or use the explicit override with a reason.', pending; end if;
  end if;

  if p_action in ('submit_report','override_close') or (p_action = 'legacy_update' and c.status = 'closed') then
    update public.project_closeouts set status = 'closed', approved_at = t, approved_by = p_actor_id, locked_at = t, locked_by = p_actor_id,
      applied_to_project = case when p.status <> 'complete' then true else applied_to_project end,
      override_reason = case when p_action = 'override_close' then reason_text else override_reason end,
      override_by = case when p_action = 'override_close' then p_actor_id else override_by end,
      override_at = case when p_action = 'override_close' then t else override_at end
      where id = c.id returning * into c;
    update public.projects set status = 'complete', updated_at = t where id = p_project_id;
    update public.project_closeout_invitations set status = case when status in ('pending','draft') then 'cancelled' else status end, cancelled_at = case when status in ('pending','draft') then t else cancelled_at end, cancellation_reason = case when status in ('pending','draft') then 'Close-out completed: ' || p_action else cancellation_reason end, updated_at = t where closeout_id = c.id;
    update public.portal_events set dismissed_at = t where dismissed_at is null and (
      (source_table = 'project_closeout_invitations' and source_id in (select id from public.project_closeout_invitations where closeout_id = c.id))
      or (source_table = 'project_closeouts' and source_id = c.id)
      or (source_table = 'project_closeout_feedback' and source_id in (select id from public.project_closeout_feedback where closeout_id = c.id))
    );
  end if;

  if p_action = 'reopen_report' then
    if c.locked_at is null and c.status <> 'closed' then raise exception 'CLOSEOUT_STATE_CONFLICT: This close-out is already open.'; end if;
    -- Always start a new review round, including a draft lock. Old pending or
    -- submitted feedback remains read-only and requires explicit reinvitation.
    update public.project_closeout_invitations set status = case when status in ('pending','draft') then 'cancelled' else status end, cancelled_at = case when status in ('pending','draft') then t else cancelled_at end, cancellation_reason = case when status in ('pending','draft') then 'Report reopened for a new review round' else cancellation_reason end, updated_at = t where closeout_id = c.id;
    update public.portal_events set dismissed_at = t where dismissed_at is null and source_table = 'project_closeout_invitations' and source_id in (select id from public.project_closeout_invitations where closeout_id = c.id);
    if c.status = 'closed' and c.applied_to_project and p.status = 'complete' then update public.projects set status = 'active', updated_at = t where id = p_project_id; end if;
    update public.project_closeouts set status = 'initiated', locked_at = null, locked_by = null, review_round = review_round + 1, applied_to_project = false where id = c.id returning * into c;
  end if;

  if p_action = 'archive_project' then
    if c.status <> 'closed' or c.locked_at is null then raise exception 'CLOSEOUT_STATE_CONFLICT: Approve and lock the close-out before archiving this project.'; end if;
    if exists (select 1 from public.project_improvement_actions where project_id = p_project_id and is_active = true and status not in ('completed','verified','archived')) then raise exception 'CLOSEOUT_OPEN_IMPROVEMENTS: Complete or archive all improvement actions before archiving this project.'; end if;
    update public.project_closeouts set status = 'archived', archived_at = t, archived_by = p_actor_id where id = c.id returning * into c;
    update public.projects set status = 'archived', updated_at = t where id = p_project_id;
  end if;

  update public.project_closeouts set report_revision = report_revision + 1, updated_by = p_actor_id, updated_at = t where id = c.id returning * into c;
  insert into public.project_closeout_revisions(closeout_id, project_id, revision, action, actor_id, reason, before_data, after_data)
  values (c.id, p_project_id, c.report_revision, p_action, p_actor_id, reason_text, before_c, to_jsonb(c));
  insert into public.admin_audit_log(actor_id, action, entity_type, entity_id, project_id, resource_key, before_data, after_data, reason)
  values (p_actor_id, p_action, 'project_closeouts', c.id, p_project_id, 'admin.projects', jsonb_build_object('closeout', before_c, 'project', before_project), jsonb_build_object('closeout', to_jsonb(c), 'project', (select jsonb_build_object('status', status) from public.projects where id = p_project_id)), reason_text);
  return jsonb_build_object('closeout', to_jsonb(c), 'report_revision', c.report_revision, 'invited_count', invited, 'project_completed', c.status = 'closed', 'project_archived', c.status = 'archived', 'review_round', c.review_round);
end;
$$;

-- Never expose SECURITY DEFINER actor parameters to browser/authenticated roles.
revoke all on function public.project_closeout_is_team_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.project_closeout_can_manage(uuid) from public, anon, authenticated;
revoke all on function public.project_closeout_validate_json(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.mutate_project_closeout(uuid, uuid, text, integer, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.project_closeout_is_team_member(uuid, uuid) to service_role;
grant execute on function public.project_closeout_can_manage(uuid) to service_role;
grant execute on function public.project_closeout_validate_json(jsonb, boolean) to service_role;
grant execute on function public.mutate_project_closeout(uuid, uuid, text, integer, jsonb, boolean) to service_role;

comment on column public.project_closeouts.applied_to_project is 'True only if this close-out changed project status to complete; reopen restores active only in that case, never unarchives.';
comment on table public.project_closeout_revisions is 'Append-only report/state snapshots. Before and after data preserve legacy and override/reopen history; included in full public-schema backups.';
comment on column public.project_closeouts.review_round is 'Reopen increments the review round. Prior submitted and draft responses are retained; administrators explicitly invite the new round.';
select pg_notify('pgrst', 'reload schema');
commit;
