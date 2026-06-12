-- Adds Builder publish fields to landing pages (ported from Normie's pages table).
-- Table name defaults to develop_landing_page (override: SUPABASE_DEVELOP_LANDING_PAGES_TABLE).
-- Run in the Supabase SQL editor. Safe to re-run.
alter table develop_landing_page add column if not exists slug text;
alter table develop_landing_page add column if not exists is_published boolean default true;
create unique index if not exists develop_landing_page_slug_project_idx
  on develop_landing_page (project_id, slug)
  where slug is not null and slug <> '';
