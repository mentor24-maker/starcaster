-- builder_project_shares_pages.sql
-- Loop Queue task 86bcw3m94: a project shares specific website PAGES with
-- another of the same person's projects, alongside the three library types.
--
-- The library types share EVERYTHING of a type, so one row per
-- (source, target, type) was enough. A page share names one page, so each row
-- gains `object_id`: blank for the library types, the page's id for
-- object_type = 'pages'. The unique key widens to include it, or a project
-- could share only one page with each other project.
--
-- Until this runs, lib/builderProjectSharesStore.js refuses a save that ticks
-- any page — by name, naming this file — BEFORE it clears anything, so the
-- sections, templates and themes already shared are left exactly as they are.
--
-- Run AFTER builder_project_shares_setup.sql. Idempotent: running the whole
-- file twice changes nothing. Apply in the Supabase SQL editor of the
-- STARCASTER project and log the run in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.

alter table public.builder_project_shares
  add column if not exists object_id text not null default '';

alter table public.builder_project_shares
  drop constraint if exists builder_project_shares_object_type_check;

alter table public.builder_project_shares
  add constraint builder_project_shares_object_type_check
  check (object_type in ('saved_sections', 'page_templates', 'themes', 'pages'));

drop index if exists public.builder_project_shares_pair_key;

create unique index if not exists builder_project_shares_object_key
  on public.builder_project_shares (project_id, target_project_id, object_type, object_id);
