-- Allow the separately protected Quote Pipeline financial sub-domain to be stored
-- in the existing portal visibility table during controlled staff account setup.
-- This alters only the allow-list constraint; it does not modify existing users
-- or visibility choices.

alter table public.portal_visibility_overrides
  drop constraint if exists portal_visibility_overrides_resource_key_check;

alter table public.portal_visibility_overrides
  add constraint portal_visibility_overrides_resource_key_check
  check (resource_key in (
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
    'admin.quote_pipeline.financials',
    'admin.remote_operations',
    'admin.whs',
    'admin.whs_monitoring',
    'admin.internal_governance',
    'admin.service_requests',
    'admin.learning',
    'admin.species',
    'admin.regulatory_watch',
    'admin.portal_management'
  ));

select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;
