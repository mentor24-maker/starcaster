-- Per-page revision history (2026-08-14).
--
-- WHY THIS EXISTS
-- Until now the Builder kept no per-page history of any kind. The only way
-- back from a bad page save was builder_page_snapshots, which stores EVERY
-- page in one row and restores all of them together -- so undoing one page's
-- mistake rolls back everyone else's work too. On 2026-08-14 the Delray home
-- page lost 35 sections to a template apply and the recovery was a full
-- database restore. The same shape cost real work on 2026-07-22 (footer) and
-- 2026-07-21 (Marinoff canonical menu, 46 pages).
--
-- WHAT IT STORES
-- The state a page was in BEFORE each layout-changing save. The live row is
-- always the current state; this table is the trail behind it. That ordering
-- matters: it means the first save after this ships captures the good
-- pre-existing layout, so pages are protected immediately with no backfill.
--
-- The summary columns (section_count, module_count, layout_bytes) are
-- denormalised so the history list can render without pulling layout_sections,
-- which routinely runs to 140KB on a built-out home page.
--
-- Table name: the UI calls it Builder, the database calls it
-- builder_landing_page (CLAUDE.md's naming table). Overridable via
-- SUPABASE_BUILDER_PAGE_REVISIONS_TABLE.
--
-- The application also runs WITHOUT this table: every write is best-effort and
-- a failure is swallowed rather than failing the page save
-- (lib/builderPageRevisionsStore.js), and the History panel reports itself
-- unavailable. Applying this SQL turns the feature on; skipping it leaves the
-- app working exactly as it does today.

create table if not exists public.builder_page_revisions (
  id bigserial primary key,
  project_id text not null default '',
  page_id bigint not null,

  -- The page as it stood before the save that produced this row.
  name text not null default '',
  slug text not null default '',
  template_id text not null default '',
  theme_id text,
  layout_sections jsonb not null default '[]'::jsonb,
  page_background jsonb,
  theme jsonb,

  -- Summary, so the list view never has to read layout_sections.
  section_count integer not null default 0,
  module_count integer not null default 0,
  layout_bytes integer not null default 0,

  -- 'save' | 'propagate' | 'revert' -- what the write was doing.
  reason text not null default 'save',

  created_at timestamptz not null default now()
);

-- The list view is always "newest first, for one page".
create index if not exists builder_page_revisions_page_created_idx
  on public.builder_page_revisions (page_id, created_at desc);

create index if not exists builder_page_revisions_project_id_idx
  on public.builder_page_revisions (project_id);

comment on table public.builder_page_revisions is
  'Per-page layout history. Each row is the state a page held BEFORE a layout-changing save. Pruned to the newest 25 per page by lib/builderPageRevisionsStore.js.';
