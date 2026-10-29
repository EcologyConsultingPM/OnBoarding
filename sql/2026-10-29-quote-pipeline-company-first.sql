-- Ecology Consulting Portal
-- Company-first issued quote presentation and optional controlled linkage to the
-- Quote Drafts workspace. Existing pipeline records stay intact.

begin;

alter table public.quote_pipeline
  add column if not exists company text,
  add column if not exists quote_draft_id uuid references public.quote_drafts(id) on delete set null;

-- Restore the relationship and company where a prior controlled transfer already
-- recorded the issued quote ID on its source draft. Older manual records retain
-- their existing client value as a display fallback in the application.
update public.quote_pipeline pipeline
set company = coalesce(pipeline.company, draft.company),
    quote_draft_id = coalesce(pipeline.quote_draft_id, draft.id)
from public.quote_drafts draft
where draft.transferred_quote_id = pipeline.id;

create index if not exists quote_pipeline_company_idx
  on public.quote_pipeline (company, updated_at desc);
create index if not exists quote_pipeline_quote_draft_idx
  on public.quote_pipeline (quote_draft_id)
  where quote_draft_id is not null;
create unique index if not exists quote_pipeline_quote_draft_unique
  on public.quote_pipeline (quote_draft_id)
  where quote_draft_id is not null;

-- Keep the controlled transfer route company-first and record its source draft.
-- The scalar client field remains the primary contact name for legacy reports.
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
    created_by, company, client, project, quote_draft_id,
    project_folder_link, quote_link, hyperlink,
    initial_sent, sent_on, status, comments, fully_invoiced, superseded
  ) values (
    p_actor_id,
    nullif(trim(draft_record.company), ''),
    nullif(trim(draft_record.client_name), ''),
    coalesce(nullif(trim(draft_record.project_name), ''), draft_record.project_number),
    draft_record.id,
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

revoke all on function public.transfer_quote_draft_to_pipeline(uuid, uuid) from public;
grant execute on function public.transfer_quote_draft_to_pipeline(uuid, uuid) to service_role;

select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;

commit;
