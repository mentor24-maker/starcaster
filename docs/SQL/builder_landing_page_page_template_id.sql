-- Split the page-template reference off the overloaded template_id (2026-08-14).
--
-- WHAT WAS WRONG
-- builder_landing_page.template_id is ONE text column holding three unrelated
-- kinds of value. Measured across all 156 pages in production:
--
--     53 pages  a builder_page_templates row id   ("27", "47")
--     10 pages  a legacy layout name              ("standard-right-form", "home")
--     93 pages  empty
--
-- The Template dropdown in Page Details lists page templates by row id, so for
-- every page in the second group it matches no option and the browser renders
-- the field blank. A page that HAS a layout still reads as unset -- which is
-- how the Delray home page lost 35 sections on 2026-08-14: the field looked
-- empty, saving refused to proceed until it was filled, and filling it
-- replaced the page body.
--
-- WHAT THIS DOES
-- Adds page_template_id, meaning one thing only: which builder_page_templates
-- row this page was built from. Empty/NULL means "no page template", which is
-- a legitimate state (93 pages are in it today) and no longer an error.
--
-- PURELY ADDITIVE. template_id is left exactly as it is -- not cleared, not
-- rewritten. Nothing reads it to drive rendering (it is carried as an
-- identifier only), so leaving it costs nothing and keeps this reversible:
-- drop the column and every page is byte-identical to before.
--
-- WHAT COUNTS AS A TEMPLATE REFERENCE
-- Two kinds of value are real references, and both must migrate:
--
--   1. an all-digits builder_page_templates row id, and
--   2. 'standard-right-form', the BUILT-IN stub template that
--      routes/builder.js injects into the page-template list (since
--      2026-06-19). It is not a database row, but it IS an id the Template
--      dropdown offers and matches, so 8 pages legitimately point at it.
--
-- Missing (2) would have silently unset those 8 pages -- they would go from
-- showing "Standard Right-Form" to showing "No template", which is the same
-- class of lie this migration exists to end.
-- scripts/builder/pageTemplateId.test.js fails if a new built-in is added to
-- routes/builder.js without being added here.
--
-- The numeric case is unambiguous: verified against production, no
-- builder_page_templates row id is also a template slug, so all-digits can
-- only mean a row id. It additionally requires the template to exist IN THE
-- SAME PROJECT, so a numeric collision across tenants cannot mislink a page.
--
-- Only 'home' and 'home-fork-1' (1 page each) are left unmigrated. They name
-- no template, built-in or otherwise, so those two pages genuinely have no
-- page template -- and after this they say so instead of showing a blank that
-- reads as a field that failed to load.
--
-- Text, not a bigint foreign key, on purpose: every id on this path is handled
-- as a string by the application (lib/builderPagesStore.js), and a real FK
-- would need a delete policy for "what happens to pages when a template is
-- deleted" -- a product decision nobody has made yet. When that decision
-- exists, adding the constraint is a separate, smaller migration.
--
-- Table name: the UI calls it Builder, the database calls it
-- builder_landing_page (CLAUDE.md's naming table).
--
-- The application also runs WITHOUT this column: lib/builderPagesStore.js
-- strips page_template_id and retries when PostgREST rejects it, the same
-- pattern theme_id and search_priority use. Applying this turns the fix on;
-- skipping it leaves the app working exactly as it does today.

ALTER TABLE builder_landing_page
  ADD COLUMN IF NOT EXISTS page_template_id TEXT;

COMMENT ON COLUMN builder_landing_page.page_template_id IS
  'Which builder_page_templates row this page was built from. NULL/empty = no page template, which is a valid state. Distinct from template_id, which is a legacy layout name.';

-- Backfill (1): an all-digits template_id naming a real template in the SAME
-- project is a page-template reference that ended up in the wrong column.
UPDATE builder_landing_page AS p
   SET page_template_id = p.template_id
  FROM builder_page_templates AS t
 WHERE p.template_id ~ '^[0-9]+$'
   AND t.id = p.template_id::bigint
   AND t.project_id = p.project_id
   AND COALESCE(p.page_template_id, '') = '';

-- Backfill (2): the built-in stub templates, which are real ids in the
-- dropdown but have no row to join against. Keep this list in step with
-- BUILT_IN_PAGE_TEMPLATES in routes/builder.js.
UPDATE builder_landing_page AS p
   SET page_template_id = p.template_id
 WHERE p.template_id IN ('standard-right-form')
   AND COALESCE(p.page_template_id, '') = '';

CREATE INDEX IF NOT EXISTS builder_landing_page_page_template_id_idx
  ON builder_landing_page (page_template_id);

-- Expected on production as of 2026-08-14: 53 rows from (1), 8 from (2) = 61.
-- The 2 left unlinked ('home', 'home-fork-1') name no template at all.
-- To check afterwards:
--   SELECT count(*) FILTER (WHERE COALESCE(page_template_id,'') <> '') AS linked,
--          count(*) FILTER (WHERE COALESCE(page_template_id,'') =  '') AS unlinked
--     FROM builder_landing_page;
