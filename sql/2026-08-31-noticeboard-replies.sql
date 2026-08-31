-- Ecology Consulting Portal
-- Additive Noticeboard replies
--
-- Published Noticeboard items retain their existing approval workflow. Replies
-- are separate, attributable discussion records attached only to a notice.

begin;

create table if not exists public.notice_replies (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notice_replies_notice_created_idx
  on public.notice_replies (notice_id, created_at asc);

alter table public.notice_replies enable row level security;

-- Replies are read and written through authenticated server routes that check
-- a user's visibility to the source notice. Direct client table access remains
-- disabled.
drop policy if exists notice_replies_direct_access on public.notice_replies;

commit;
