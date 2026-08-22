-- Give page revisions their tenant back (2026-08-16).
--
-- WHAT IS WRONG
-- Every row in builder_page_revisions carries a BLANK project_id. All 550 of
-- them in production, since the table shipped.
--
-- WHY, AND IT IS NOT OBVIOUS
-- lib/projectScope.js decides whether to stamp a tenant onto an insert by
-- probing the table for BOTH columns:
--
--     select=project_id,owner_user_id&limit=1
--
-- builder_page_revisions has project_id but no owner_user_id, so the probe
-- fails, supportsProjectColumns() returns false, and scopedInsertRow quietly
-- stops stamping either column. The insert still succeeds. Nothing errors,
-- nothing warns, and the rows land untenanted.
--
-- The same gap bit builder_published_pages on its very first run
-- (2026-08-16): ten rows written with a blank project_id, and every published
-- page then read back as unpublished. That one was caught within minutes
-- because the feature visibly did not work. This one was not, because reads
-- filter by page_id and skip the project scope too — so Page History behaves
-- correctly and the defect is invisible from the UI.
--
-- HOW BAD IS IT, HONESTLY
-- Nothing is broken and nothing is leaking today. page_id is globally unique,
-- so a page's history can only ever be that page's history. What is missing is
-- the tenant boundary as a property of the DATA: any future query that filters
-- by project_id finds nothing, and the defence-in-depth this repo expects of
-- every tenant-scoped table (CLAUDE.md, API conventions) is simply absent.
--
-- WHAT THIS DOES
--   1. adds owner_user_id, which is what makes scopedInsertRow start stamping
--      BOTH columns again, so new rows are tenanted from the moment this runs;
--   2. backfills project_id on the existing rows from the page each one
--      belongs to.
--
-- The backfill is safe: it only ever copies a page's own project onto that
-- page's own revisions, and it touches nothing that already has a value.
-- Re-running it is a no-op.

ALTER TABLE public.builder_page_revisions
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT NOT NULL DEFAULT '';

-- Backfill from the page the revision belongs to. A revision of a page that
-- has since been deleted keeps its blank project_id — there is nothing left to
-- learn the tenant from, and guessing would be worse than leaving it.
UPDATE builder_page_revisions AS r
   SET project_id = p.project_id
  FROM builder_landing_page AS p
 WHERE p.id = r.page_id
   AND COALESCE(r.project_id, '') = ''
   AND COALESCE(p.project_id, '') <> '';

CREATE INDEX IF NOT EXISTS builder_page_revisions_owner_user_id_idx
  ON public.builder_page_revisions (owner_user_id);

COMMENT ON COLUMN public.builder_page_revisions.owner_user_id IS
  'Present so lib/projectScope.js recognises this as a tenant-scoped table and stamps project_id on insert. Without it, scopedInsertRow silently writes rows with no tenant at all.';

-- Expected on production as of 2026-08-16: 550 rows updated, 0 left blank
-- (no revisions belong to deleted pages today).
-- To check afterwards:
--   SELECT count(*) FILTER (WHERE COALESCE(project_id,'') <> '') AS tenanted,
--          count(*) FILTER (WHERE COALESCE(project_id,'') =  '') AS blank
--     FROM builder_page_revisions;
