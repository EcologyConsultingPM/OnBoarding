begin;
alter table public.regulatory_sources add column if not exists locked boolean not null default false;
alter table public.regulatory_sources add column if not exists archived_at timestamptz;
create index if not exists regulatory_sources_active_type_idx on public.regulatory_sources(active, fetch_type, updated_at desc);
select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;
commit;
