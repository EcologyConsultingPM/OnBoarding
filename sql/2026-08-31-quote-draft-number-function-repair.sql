-- Repair for the initial controlled quote-number function.
-- Qualifies quote_drafts fields so PL/pgSQL output-column names cannot shadow them.

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
  select draft.project_number, draft.quote_number
  from public.quote_drafts as draft
  where draft.id = p_draft_id;
end;
$$;

revoke all on function public.generate_quote_draft_numbers(uuid) from public;
grant execute on function public.generate_quote_draft_numbers(uuid) to service_role;
select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;
