-- Project recycle bin.
--
-- DELETE on a project has always been all-or-nothing: a project with any
-- delivery record (allocations, activities, schedule items, tracker history)
-- is refused with 409 and the administrator is told to archive it instead.
-- That guard is correct — a hard delete would cascade away real delivery and
-- WHS records — but it left no way to get a project off the list, and archiving
-- is a *status*, not a removal.
--
-- Soft delete separates the two ideas:
--   archived    = finished work, retained as a completed record
--   deleted_at  = removed from view, restorable, purgeable when genuinely empty
--
-- Idempotent.

alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- Every list query filters on deleted_at is null, so this is the hot path.
create index if not exists projects_not_deleted_idx
  on public.projects (status) where deleted_at is null;

create index if not exists projects_deleted_idx
  on public.projects (deleted_at desc) where deleted_at is not null;

comment on column public.projects.deleted_at is
  'Soft delete. Non-null hides the project everywhere; the row and its delivery record are retained and can be restored. Permanent deletion is only permitted when no dependent records exist.';
