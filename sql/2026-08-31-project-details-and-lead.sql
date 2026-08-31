-- Ecology Consulting Portal
-- Project setup detail enhancements
--
-- Additive only: retains existing project, allocation, activity, tracker and
-- Timesheet history while supporting the complete project setup brief.

begin;

alter table public.projects
  add column if not exists scope_of_works text,
  add column if not exists project_lead_user_id uuid references auth.users(id) on delete set null,
  add column if not exists sharepoint_label text;

create index if not exists projects_project_lead_user_idx
  on public.projects (project_lead_user_id)
  where project_lead_user_id is not null;

comment on column public.projects.scope_of_works is
  'Controlled project scope / agreed work description.';
comment on column public.projects.project_lead_user_id is
  'Assigned Project Manager or technical lead selected from the Staff List.';
comment on column public.projects.sharepoint_label is
  'Editable display text for the official project workspace hyperlink.';

commit;
