-- Ecology Consulting detailed deliverable activity library.
-- The application supplies the editable detailed WBS and default hours; these
-- rows ensure every supported service is selectable in Project Setup.
-- Safe to apply more than once.

insert into public.deliverable_templates (code, name, standard_activities, is_active)
select item.code, item.name, jsonb_build_array(), true
from (
  values
    ('FFA_REF', 'Flora and Fauna Assessment and REF ecology'),
    ('BOS', 'BOS assessment and advice memo'),
    ('PCA', 'Pre-clearing assessment and report'),
    ('CLEARING_SUPERVISION', 'Clearing supervision and report'),
    ('SBDAR', 'Streamlined BDAR'),
    ('DUE_DILIGENCE', 'Ecological due diligence assessment')
) as item(code, name)
where not exists (
  select 1 from public.deliverable_templates existing where existing.code = item.code
);

-- The WBS is intentionally generated only at the point a PM adds a
-- deliverable. The project manager can adjust staff, hours, dates and
-- dependencies; complete an activity; or remove any optional/non-applicable
-- item without changing the reusable library.
