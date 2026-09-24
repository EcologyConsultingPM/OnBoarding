-- Structured learning-module content and evidence-based competency workflow.
-- Additive only: existing library nodes and learning assignments remain intact.
begin;

alter table public.ld_nodes
  add column if not exists module_content jsonb not null default '{}'::jsonb;

alter table public.learning_assignments
  add column if not exists assignment_note text,
  add column if not exists submission_note text,
  add column if not exists assessment_note text,
  add column if not exists competency_scope text;

commit;
