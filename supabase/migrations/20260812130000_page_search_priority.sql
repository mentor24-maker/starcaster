-- Per-page search ranking for the Site Search module (2026-08-12).
--
-- Five values, stored as text rather than an enum so adding a rung later is a
-- code change rather than a migration: 'pinned' | 'boosted' | 'normal' |
-- 'lowered' | 'hidden'.
--
-- Nullable with no default and no backfill on purpose. Every reader treats
-- NULL, '' and anything unrecognised as 'normal'
-- (lib/builder-client/page-search-priority.js), so the 60-page sites that predate this column
-- need no data migration and behave exactly as they do today.
--
-- Table name: the UI calls it Builder, the database calls it
-- builder_landing_page (CLAUDE.md's naming table). Overridable via
-- SUPABASE_BUILDER_LANDING_PAGES_TABLE — if that env var is set on this
-- deployment, run this against whatever it names instead.
--
-- The application also runs WITHOUT this column: lib/builderPagesStore.js
-- strips search_priority and retries when PostgREST rejects it, following the
-- same pattern as theme_id and is_private. So applying this SQL turns the
-- feature on; skipping it leaves the app working with the control absent.

ALTER TABLE builder_landing_page
  ADD COLUMN IF NOT EXISTS search_priority TEXT;

COMMENT ON COLUMN builder_landing_page.search_priority IS
  'Site Search ranking: pinned | boosted | normal | lowered | hidden. NULL = normal.';
