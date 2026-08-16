-- Say what each page revision CHANGED, not just how big it was (2026-08-15).
-- Slice C of the concurrent-edit safety work.
--
-- WHY THIS EXISTS
-- The Page History list shows a timestamp, who saved it, and totals. On
-- 2026-08-15 the Delray home page had FIVE consecutive rows all reading
-- "41 sections · 84 modules". Every one of them was accurate and none of them
-- helped: the operator had just overwritten a collaborator's work and could
-- not tell which row held it. Answering that took a hand-written script that
-- pulled layout JSON out of production and diffed it by hand.
--
-- This column holds one line saying what the save that REPLACED this version
-- did to it -- 'Removed "Events"', 'Added "Hero"', 'Edited "Footer"'. That is
-- computable at write time and nowhere else cheaply: recordPageRevision is the
-- one place that holds both the version being banked and the version replacing
-- it, in the same call, already in memory.
--
-- Computed once on write, never on read. The whole point of the denormalised
-- section_count / module_count columns is that the history list never has to
-- load layout_sections, which routinely runs to 140KB on a built-out home
-- page. A summary derived at list time would throw that away.
--
-- Nullable, no default, no backfill. Existing rows keep NULL and render with
-- their counts alone, exactly as they do today. There is nothing to migrate.
--
-- The application also runs WITHOUT this column: builderPageRevisionsStore
-- swallows history failures rather than failing the save it is recording, and
-- the writer strips the column and retries when PostgREST rejects it -- the
-- same pattern theme_id, is_private, search_priority, propagation_run_id and
-- saved_by all follow.
--
-- Table name: the UI calls it Builder, the database calls it
-- builder_page_revisions (CLAUDE.md's naming table). Overridable via
-- SUPABASE_BUILDER_PAGE_REVISIONS_TABLE -- if that env var is set on this
-- deployment, run this against whatever it names instead.

ALTER TABLE builder_page_revisions
  ADD COLUMN IF NOT EXISTS change_summary TEXT;

COMMENT ON COLUMN builder_page_revisions.change_summary IS
  'One line describing what the save that replaced this version did to it, computed at write time. NULL = recorded before this column existed.';
