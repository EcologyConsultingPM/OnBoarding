-- Controlled enquiry-to-quote workflow.
-- Review-only until an authorised administrator approves application to the
-- verified Ecology Consulting Supabase project. Existing issued quote records
-- are retained; this adds the requested Withdrawn status to the existing
-- issued-quote lifecycle.

alter table public.quote_pipeline
  drop constraint if exists quote_pipeline_status_check;

alter table public.quote_pipeline
  add constraint quote_pipeline_status_check
  check (status in ('pending', 'successful', 'unsuccessful', 'withdrawn'));

create table if not exists public.quote_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  client_name text not null,
  company text,
  client_email text,
  client_phone text,
  preferred_contact_method text,
  project_name text,
  project_location text,
  local_government_area text,
  state text,
  enquiry_description text,
  required_services text,
  development_type text,
  site_constraints text,
  project_drivers text,
  consent_authority text,
  authority_comments text,
  biodiversity_information_request text,
  ref_bar_requirements text,
  planning_pathway text,
  additional_agency_requirements text,
  enquiry_received_on date not null default current_date,
  client_required_by date,
  approval_timeframes text,
  urgency text not null default 'medium' check (urgency in ('low', 'medium', 'high', 'critical')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_name text,
  status text not null default 'awaiting_review' check (status in ('awaiting_review', 'awaiting_contact', 'ready_to_generate', 'quote_drafting', 'transferred', 'withdrawn')),
  client_contacted boolean not null default false,
  contact_date date,
  contact_notes text,
  scope_confirmed text,
  project_number text unique,
  quote_number text unique,
  quote_draft_link text,
  attachments jsonb not null default '[]'::jsonb,
  quote_pdf_path text,
  quote_sent boolean not null default false,
  quote_sent_on date,
  quote_recipient_email text,
  transferred_quote_id uuid references public.quote_pipeline(id) on delete set null,
  transferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_drafts_status_idx on public.quote_drafts (status, updated_at desc);
create index if not exists quote_drafts_assigned_idx on public.quote_drafts (assigned_to, updated_at desc);
create index if not exists quote_drafts_received_idx on public.quote_drafts (enquiry_received_on desc);
alter table public.quote_drafts enable row level security;

-- The API uses the service role only after validating the signed-in portal user.
-- No browser-client policies are created here.

insert into storage.buckets (id, name, public)
values ('quote-draft-attachments', 'quote-draft-attachments', false)
on conflict (id) do nothing;

create sequence if not exists public.quote_draft_project_number_seq start with 1000;
create sequence if not exists public.quote_draft_number_seq start with 400;

create or replace function public.generate_quote_draft_numbers(p_draft_id uuid)
returns table (project_number text, quote_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year text := to_char(current_date, 'YYYY');
begin
  update public.quote_drafts as draft
  set
    project_number = coalesce(draft.project_number, current_year || '-' || nextval('public.quote_draft_project_number_seq')::text),
    quote_number = coalesce(draft.quote_number, 'Q-' || current_year || '-' || nextval('public.quote_draft_number_seq')::text),
    status = 'quote_drafting',
    updated_at = now()
  where draft.id = p_draft_id
    and draft.client_contacted = true
    and draft.contact_date is not null
    and nullif(trim(coalesce(draft.contact_notes, '')), '') is not null
    and nullif(trim(coalesce(draft.scope_confirmed, '')), '') is not null;

  if not found then
    raise exception 'Client contact date, contact notes and confirmed scope are required before quote numbers can be generated.';
  end if;

  return query
  select q.project_number, q.quote_number
  from public.quote_drafts q
  where q.id = p_draft_id;
end;
$$;

create or replace function public.transfer_quote_draft_to_pipeline(p_draft_id uuid, p_actor_id uuid)
returns table (quote_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_record public.quote_drafts%rowtype;
  inserted_quote_id uuid;
begin
  select * into draft_record
  from public.quote_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'Draft enquiry was not found.';
  end if;
  if draft_record.transferred_quote_id is not null then
    return query select draft_record.transferred_quote_id;
    return;
  end if;
  if draft_record.status <> 'quote_drafting' or draft_record.project_number is null or draft_record.quote_number is null then
    raise exception 'Generate the project and quote numbers before transferring an issued quote.';
  end if;
  if draft_record.quote_sent is not true or draft_record.quote_sent_on is null or nullif(trim(coalesce(draft_record.quote_recipient_email, '')), '') is null or draft_record.quote_pdf_path is null then
    raise exception 'Record the sent date, recipient email and attached quote PDF before transferring the quote.';
  end if;

  insert into public.quote_pipeline (
    created_by, client, project, project_folder_link, quote_link, hyperlink,
    initial_sent, sent_on, status, comments, fully_invoiced, superseded
  ) values (
    p_actor_id,
    coalesce(nullif(trim(draft_record.client_name), ''), nullif(trim(draft_record.company), '')),
    coalesce(nullif(trim(draft_record.project_name), ''), draft_record.project_number),
    draft_record.quote_draft_link,
    null,
    null,
    true,
    draft_record.quote_sent_on::text,
    'pending',
    concat_ws(' · ', 'Quote ' || draft_record.quote_number, nullif(trim(draft_record.enquiry_description), ''), 'Transferred from Quotes to be Drafted'),
    false,
    false
  ) returning id into inserted_quote_id;

  update public.quote_drafts
  set transferred_quote_id = inserted_quote_id,
      transferred_at = now(),
      status = 'transferred',
      updated_at = now()
  where id = p_draft_id;

  return query select inserted_quote_id;
end;
$$;

revoke all on function public.generate_quote_draft_numbers(uuid) from public;
revoke all on function public.transfer_quote_draft_to_pipeline(uuid, uuid) from public;
grant execute on function public.generate_quote_draft_numbers(uuid) to service_role;
grant execute on function public.transfer_quote_draft_to_pipeline(uuid, uuid) to service_role;

select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;
