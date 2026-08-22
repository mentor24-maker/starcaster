-- Group the pages rewritten by ONE shared-section save into one undoable run
-- (2026-08-15). Slice 4 of the Upstream/Downstream operating model.
--
-- Saving a saved-section master rewrites that section on every page that
-- follows it. Each of those rewrites already banks a restore point in
-- builder_page_revisions tagged reason = 'propagate', so nothing is lost — but
-- the rows are unrelated to each other, so undoing one save means finding and
-- restoring every affected page by hand, one at a time. On 2026-07-21 a single
-- master save rewrote 46 Marinoff pages and there was no way back; on
-- 2026-08-15 another reached 35 Delray pages unannounced.
--
-- This column is the missing thread between those rows: every revision minted
-- by one propagation carries the same id, so "Undo this update" can restore the
-- whole run as a single action.
--
-- Nullable, no default, no backfill, on purpose. Every existing revision row
-- keeps a NULL here and behaves exactly as it does today — a NULL simply means
-- "this revision was not part of a fan-out", which is true of every ordinary
-- page save. There is nothing to migrate.
--
-- The application also runs WITHOUT this column. builderPageRevisionsStore
-- swallows history failures rather than failing the save it is recording
-- (a deliberate choice: a history write must never break a page save), and the
-- writer strips the column and retries when PostgREST rejects it, following the
-- same pattern as theme_id, is_private and search_priority. So applying this
-- SQL turns the grouped undo on; skipping it leaves today's per-page undo
-- working exactly as it does now.
--
-- Table name: the UI calls it Builder, the database calls it
-- builder_page_revisions (CLAUDE.md's naming table). Overridable via
-- SUPABASE_BUILDER_PAGE_REVISIONS_TABLE — if that env var is set on this
-- deployment, run this against whatever it names instead.

ALTER TABLE builder_page_revisions
  ADD COLUMN IF NOT EXISTS propagation_run_id TEXT;

COMMENT ON COLUMN builder_page_revisions.propagation_run_id IS
  'Shared id across every revision minted by one canonical-section propagation, so the whole fan-out can be undone as a single run. NULL = an ordinary single-page save.';

-- Restoring a run looks up every revision carrying one id. Partial index
-- because the overwhelming majority of revisions are ordinary saves with NULL
-- here, and those rows never take part in this lookup.
CREATE INDEX IF NOT EXISTS builder_page_revisions_propagation_run_idx
  ON builder_page_revisions (propagation_run_id)
  WHERE propagation_run_id IS NOT NULL;
