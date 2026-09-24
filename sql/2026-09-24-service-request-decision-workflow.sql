-- Simplified Service Desk workflow: a decision is approved or declined,
-- while closure and locking remain independent record controls.
begin;

alter table public.service_requests
  add column if not exists decision_status text;

alter table public.service_requests
  drop constraint if exists service_requests_decision_status_check;

alter table public.service_requests
  add constraint service_requests_decision_status_check
  check (decision_status is null or decision_status in ('approved', 'declined'));

-- Existing completed decisions retain their historical reviewer information.
update public.service_requests
set decision_status = case
  when status = 'approved' then 'approved'
  when status = 'declined' then 'declined'
  else null
end
where decision_status is null
  and status in ('approved', 'declined');

commit;
