-- Additive schema parity for notification and project-assignment routes.
-- These columns already exist in the current production database; keeping the
-- DDL in the repository makes a clean deployment/recovery reproduce them.

alter table public.portal_events
  add column if not exists deferred_until timestamptz;

alter table public.project_activities
  add column if not exists notified_at timestamptz;

alter table public.service_requests
  drop constraint if exists service_requests_request_type_check;
alter table public.service_requests
  add constraint service_requests_request_type_check
  check (request_type in ('leave', 'training', 'equipment', 'task', 'other', 'whs_incident', 'whs_near_miss', 'remote_issue'));
