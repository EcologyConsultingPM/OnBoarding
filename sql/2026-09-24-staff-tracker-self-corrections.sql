-- Staff can correct their own submitted tracker entries. Every correction and
-- ad hoc entry for work on another active project remains auditable.
begin;

alter table public.project_tracker_entry_audit
  drop constraint if exists project_tracker_entry_audit_action_check;

alter table public.project_tracker_entry_audit
  add constraint project_tracker_entry_audit_action_check
  check (action in ('corrected', 'voided', 'staff_corrected', 'ad_hoc_entered'));

commit;
