begin;
-- Remove the former allow-list before safely moving a legacy resource key.
alter table public.portal_visibility_overrides
drop constraint if exists portal_visibility_overrides_resource_key_check;
-- Preserve each user’s existing Service Requests visibility when moving it from
-- the historical My Projects sub-domain to the standalone staff domain.
insert into public.portal_visibility_overrides (user_id, resource_key, is_visible, updated_by, created_at, updated_at)
select user_id, 'staff.service_requests', is_visible, updated_by, created_at, now()
from public.portal_visibility_overrides
where resource_key = 'staff.projects.service_requests'
on conflict (user_id, resource_key) do update
set is_visible = excluded.is_visible, updated_by = excluded.updated_by, updated_at = now();
delete from public.portal_visibility_overrides where resource_key = 'staff.projects.service_requests';
alter table public.portal_visibility_overrides
add constraint portal_visibility_overrides_resource_key_check
check (resource_key in (
  'staff.projects','staff.notifications','staff.projects.activities','staff.projects.tracker','staff.service_requests','staff.service_requests.history','staff.timesheets','staff.forms','staff.forms.governance','staff.learning','staff.learning.assignments','staff.species','staff.remote_operations','staff.onboarding',
  'admin.projects','admin.projects.setup','admin.projects.tracker','admin.projects.health','admin.projects.capacity','admin.projects.capacity.edit',
  'admin.quote_pipeline','admin.quote_pipeline.financials','admin.quote_pipeline.deliverables','admin.quote_pipeline.draft_projects','admin.quote_pipeline.commercial_reporting',
  'admin.remote_operations','admin.whs','admin.whs_monitoring','admin.internal_governance',
  'admin.service_requests','admin.service_requests.approvals','admin.service_requests.history',
  'admin.learning','admin.learning.governance','admin.species','admin.species.bionet_watchlists',
  'admin.regulatory_watch','admin.regulatory_watch.sources','admin.regulatory_watch.source_health','admin.regulatory_watch.review_queue',
  'admin.portal_management','admin.portal_management.audit_log','admin.portal_management.commercial_margins','admin.portal_management.psychosocial'
));
select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;
commit;
