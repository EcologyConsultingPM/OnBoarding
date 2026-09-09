-- Core Training quiz autosave.
-- Additive only. No existing staff, learning or assessment records are changed.
-- Apply only after explicit approval.

create table if not exists public.core_training_quiz_drafts (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id text not null check (quiz_id ~ '^core-(m|r|b)[0-9]{2}$'),
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_user_id, quiz_id)
);

create index if not exists core_training_quiz_drafts_staff_updated_idx
  on public.core_training_quiz_drafts (staff_user_id, updated_at desc);

alter table public.core_training_quiz_drafts enable row level security;

-- No browser-client policies are added. The protected server API checks the
-- signed-in staff identity and Learning & Development visibility before access.
