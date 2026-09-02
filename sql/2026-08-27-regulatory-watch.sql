begin;

create table if not exists public.regulatory_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  title text not null,
  category text not null check (category in ('whs', 'biodiversity', 'flora_fauna', 'environmental_reform')),
  authority_name text not null,
  source_url text not null,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_http_status integer,
  last_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.regulatory_updates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.regulatory_sources(id) on delete set null,
  title text not null,
  summary text not null,
  source_url text not null,
  source_published_at timestamptz,
  detected_at timestamptz not null default now(),
  fingerprint text,
  affected_domains text[] not null default array[]::text[],
  severity text not null default 'review' check (severity in ('critical', 'action', 'review', 'information')),
  status text not null default 'new' check (status in ('new', 'reviewing', 'assessed', 'actioned', 'not_applicable')),
  assigned_reviewer_id uuid,
  review_due_date date,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  staff_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, fingerprint)
);

create index if not exists regulatory_updates_status_detected_idx
  on public.regulatory_updates (status, detected_at desc);
create index if not exists regulatory_updates_source_idx
  on public.regulatory_updates (source_id, detected_at desc);

alter table public.regulatory_sources enable row level security;
alter table public.regulatory_updates enable row level security;

-- There are intentionally no direct browser policies. The protected server API
-- verifies the caller is an Ecology Consulting administrator before using the
-- service role. Staff see only an approved notification in portal_events.

insert into public.regulatory_sources (source_key, title, category, authority_name, source_url) values
  ('nsw_whs_legislation', 'NSW WHS legislation and changes', 'whs', 'SafeWork NSW', 'https://www.safework.nsw.gov.au/legal-obligations/legislation'),
  ('nsw_bam', 'Biodiversity Assessment Method and updates', 'biodiversity', 'NSW Environment', 'https://www.environment.nsw.gov.au/topics/animals-and-plants/biodiversity-offsets-scheme/about/biodiversity-assessment-method'),
  ('nsw_threatened_species_surveys', 'Threatened species surveys and assessments', 'flora_fauna', 'NSW Environment', 'https://www.environment.nsw.gov.au/topics/animals-and-plants/threatened-species/about-threatened-species/surveys-and-assessments'),
  ('commonwealth_environment_reforms', 'EPBC Act and environmental protection reforms', 'environmental_reform', 'DCCEEW / National EPA', 'https://www.dcceew.gov.au/environment/epbc/epbc-act-reform'),
  ('nsw_bionet_threatened_species', 'NSW BioNet threatened biodiversity profiles', 'flora_fauna', 'NSW Environment / BioNet', 'https://threatenedspecies.bionet.nsw.gov.au/'),
  ('nsw_biodiversity_conservation_trust', 'NSW Biodiversity Conservation Trust updates', 'biodiversity', 'NSW Biodiversity Conservation Trust', 'https://www.nsw.gov.au/departments-and-agencies/dcceew/nsw-biodiversity-conservation-trust'),
  ('nsw_plants_animals', 'NSW plants and animals updates', 'flora_fauna', 'NSW Government / DCCEEW', 'https://www.nsw.gov.au/environment-land-and-water/plants-and-animals'),
  ('act_conservator_flora_fauna', 'ACT Office of the Conservator of Flora and Fauna', 'flora_fauna', 'ACT Government', 'https://www.act.gov.au/directorates-and-agencies/city-and-environment-directorate/office-of-the-conservator-of-flora-and-fauna')
on conflict (source_key) do nothing;

commit;
