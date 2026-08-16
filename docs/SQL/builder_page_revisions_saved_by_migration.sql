-- Record WHO saved each page revision (2026-08-15). Slice B of the
-- concurrent-edit safety work.
--
-- WHY THIS EXISTS
-- builder_page_revisions records what a page looked like but not who put it
-- that way. With one person editing a site that is merely incomplete; with two
-- it is the difference between a usable history and a wall of identical rows.
--
-- On 2026-08-15 two people had the Delray home page open at the same time. One
-- added an "EVENTS" section; the other saved a copy loaded before that change
-- and the section vanished. The history had banked the lost version, so it was
-- recoverable — but the panel showed FIVE consecutive rows all reading
-- "41 sections · 84 modules", and answering "which of these is his?" took a
-- hand-written script that pulled layout JSON out of production and diffed it.
-- A name on each row answers it at a glance.
--
-- saved_by_name is denormalised on purpose, exactly like section_count and
-- module_count: the history list must render without joining anything. A user
-- who later changes their display name leaves older revisions reading the name
-- they had at the time, which is the correct answer for an audit trail anyway.
--
-- Nullable, no default, no backfill. Every existing row keeps NULL, which means
-- "saved before this shipped" and renders as an em dash. There is nothing to
-- migrate.
--
-- The application also runs WITHOUT these columns. builderPageRevisionsStore
-- swallows history failures rather than failing the save it is recording, and
-- the writer strips these columns and retries when PostgREST rejects them —
-- the same pattern theme_id, is_private, search_priority and
-- propagation_run_id all follow. So applying this SQL turns the names on;
-- skipping it leaves the history working exactly as it does now.
--
-- Table name: the UI calls it Builder, the database calls it
-- builder_page_revisions (CLAUDE.md's naming table). Overridable via
-- SUPABASE_BUILDER_PAGE_REVISIONS_TABLE — if that env var is set on this
-- deployment, run this against whatever it names instead.

ALTER TABLE builder_page_revisions
  ADD COLUMN IF NOT EXISTS saved_by TEXT;

ALTER TABLE builder_page_revisions
  ADD COLUMN IF NOT EXISTS saved_by_name TEXT;

COMMENT ON COLUMN builder_page_revisions.saved_by IS
  'User id of whoever made the save that replaced this version. NULL = recorded before this column existed, or an unauthenticated/system write.';

COMMENT ON COLUMN builder_page_revisions.saved_by_name IS
  'Display name (falling back to email) as it stood at save time, denormalised so the history list renders without a join.';
