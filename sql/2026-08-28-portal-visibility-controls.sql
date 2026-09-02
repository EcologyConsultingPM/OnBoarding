-- Individual portal domain and sub-domain visibility controls.
-- Additive only. No existing staff, portal access, project or learning data is changed.
-- This file is review-only until an authorised administrator explicitly approves
-- application to the connected Supabase project.

create table if not exists public.portal_visibility_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_key text not null check (resource_key in (
    'staff.projects',
    'staff.notifications',
    'staff.projects.activities',
    'staff.projects.tracker',
    'staff.service_requests',
    'staff.timesheets',
    'staff.forms',
    'staff.forms.governance',
    'staff.learning',
    'staff.species',
    'staff.remote_operations',
    'staff.onboarding',
    'admin.projects',
    'admin.projects.setup',
    'admin.projects.tracker',
    'admin.projects.health',
    'admin.quote_pipeline',
    'admin.remote_operations',
    'admin.whs',
    'admin.whs_monitoring',
    'admin.internal_governance',
    'admin.service_requests',
    'admin.learning',
    'admin.species',
    'admin.regulatory_watch',
    'admin.portal_management'
  )),
  is_visible boolean not null,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_key)
);

create index if not exists portal_visibility_overrides_user_idx
  on public.portal_visibility_overrides (user_id, resource_key);
create index if not exists portal_visibility_overrides_updated_idx
  on public.portal_visibility_overrides (updated_at desc);

alter table public.portal_visibility_overrides enable row level security;

-- Intentionally no browser-client policies. The protected server route validates the
-- signed-in identity, accepts changes only from aaron.dooley@ecologyconsulting.au,
-- and obtains recipients from the active Staff List.
