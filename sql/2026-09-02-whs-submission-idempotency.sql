begin;

alter table public.whs_forms
  add column if not exists submission_key text;

-- Keep the earliest exact submission. Do not remove a duplicate that already
-- has an audit record; those rows require an administrator decision instead.
with ranked as (
  select
    id,
    row_number() over (
      partition by created_by, form_type, title, site, form_date, details, notifiable_flag
      order by created_at asc, id asc
    ) as row_number
  from public.whs_forms
)
delete from public.whs_forms form
using ranked duplicate
where form.id = duplicate.id
  and duplicate.row_number > 1
  and not exists (
    select 1
    from public.whs_audits audit
    where audit.form_id = form.id
  );

update public.whs_forms
set submission_key = md5(
  concat_ws(
    '|',
    created_by::text,
    form_type,
    title,
    coalesce(site, ''),
    coalesce(form_date::text, ''),
    notifiable_flag::text,
    details::text
  )
)
where submission_key is null;

create unique index if not exists whs_forms_created_by_submission_key_uidx
  on public.whs_forms (created_by, submission_key)
  where submission_key is not null;

commit;
