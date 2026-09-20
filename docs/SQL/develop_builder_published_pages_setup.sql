-- The live snapshot of each page: publishing writes here (2026-08-16).
--
-- WHAT THIS IS FOR
-- Today a visitor is served the page rows the operator is editing. There is no
-- moment called "publish" — a save reaches the public site immediately, and a
-- shared-section save reaches every page that uses it through a fan-out loop.
-- That loop is what failed on 2026-07-21 (46 Marinoff pages rewritten with no
-- preview) and 2026-07-22 (killed part-way by the serverless function
-- freezing: 30 pages updated, 20 stale, reported as "the footer won't save").
--
-- This table is the other half of the operator's Draft/Published model,
-- 2026-08-16, in his words:
--
--     Draft resolves live      — you change a theme or a header and see it
--                                immediately.
--     Published materializes   — the built row is a snapshot of the resolved
--                                result, frozen until you publish again.
--
-- So the editing contract does not change at all. Publishing takes a
-- photograph of what it produced.
--
-- CAREFUL: TWO DIFFERENT MEANINGS OF "PUBLISHED"
-- builder_landing_page.is_published already exists and means "this page is
-- part of the site rather than a hidden draft". It is a VISIBILITY flag and is
-- unrelated to whether a build exists. A page can be is_published = true and
-- have never been built (it has simply never been published yet), and the
-- public site falls back to the draft row for exactly that case. The two names
-- colliding is unfortunate and is worth settling when the Publish button makes
-- it visible to the operator.
--
-- WHAT A ROW HOLDS
-- `payload` is the page as the public API would have answered it: frame
-- sections already resolved against their masters, theme shell attached. The
-- endpoint serves it as-is, so a visitor's request does no resolving and no
-- lookup of shared sections.
--
-- `source_updated_at` records what the draft's updated_at was at the moment it
-- was built. That is the whole of the staleness check: draft newer than that
-- means the page has unpublished changes. Step 3 shows a count of them.
--
-- ONE ROW PER PAGE, replaced on each publish. Keeping previous builds so the
-- live site can be rolled back is step 5, and wants its own table rather than
-- a version column here.
--
-- WHEN A ROW GOES AWAY -- and when it deliberately does not
-- Deleting a page deletes its snapshot (PR #532, lib/builderPagesStore.js
-- deletePage). Nothing else does, and that is a decision rather than an
-- oversight:
--
--     unpublishing a page (is_published -> false)   keeps its snapshot
--     marking a page private (is_private -> true)   keeps its snapshot
--     changing a page's slug                        keeps its snapshot
--
-- Asked of the operator on 2026-09-14 as a three-way choice -- drop the
-- snapshot, shelve it somewhere unservable, or keep it and say so -- and
-- answered: keep it and say so. This is the saying so.
--
-- None of the three is a serving bug. resolvePublicPageIdForSlug will not
-- resolve an address to an unpublished or private page, so those snapshots are
-- unreachable to a visitor; a renamed page's snapshot is fetched by page id and
-- serves pre-rename content until the next publish, which is exactly what
-- publishing promises. What is left is retention, and it was measured against
-- production the day the decision was taken: ONE row and 26 kB in the
-- "exists, unpublished" bucket, and zero rows in the other two.
--
-- The price of the alternative is what settled it. A visitor is served "the
-- build if there is one, the draft if not", so dropping the snapshot on
-- unpublish means a page taken private and put back serves its DRAFT -- every
-- unpublished edit going live the moment it is republished, before anybody
-- presses Publish. That is a permanent change to what Publish promises, paid
-- for 26 kB.
--
-- So: unpublishing HIDES a page, it does not erase what was published of it.
-- Erasing is what deleting the page is for. If this ever needs revisiting, the
-- thing to build first is a surface listing snapshots whose page is gone or
-- hidden, with a way to clear them -- which is what would have made Delray's
-- 51 rows from deleted pages visible instead of nobody noticing.

-- BOTH tenant columns, and owner_user_id is not optional decoration.
-- lib/projectScope.js decides whether to stamp a tenant by probing
-- `select=project_id,owner_user_id`, so a table carrying only project_id fails
-- that probe and scopedInsertRow writes rows with NO tenant at all — silently,
-- because the insert still succeeds. That is exactly what happened here on the
-- first run (10 rows, every project_id blank) and it is why every published
-- page then read back as unpublished. builder_page_revisions has the same gap
-- and the same symptom in production.
create table if not exists public.builder_published_pages (
  id bigserial primary key,
  project_id text not null default '',
  owner_user_id text not null default '',
  page_id bigint not null,

  -- Denormalised so the public endpoint can find a page by address without
  -- reading builder_landing_page at all.
  slug text not null default '',

  -- The page exactly as it should be served.
  payload jsonb not null default '{}'::jsonb,

  -- The draft's updated_at when this build was taken. Compare against the
  -- draft to know whether the page has unpublished changes.
  source_updated_at timestamptz,

  -- Groups every page built by one Publish, so a publish can be reported,
  -- resumed and (later) rolled back as one thing.
  build_id text not null default '',

  published_at timestamptz not null default now()
);

-- `create table if not exists` does nothing to a table that already exists, so
-- name the tenant columns separately too. Safe to re-run.
alter table public.builder_published_pages
  add column if not exists project_id text not null default '';
alter table public.builder_published_pages
  add column if not exists owner_user_id text not null default '';

-- One build per page. The publish path upserts on this.
create unique index if not exists builder_published_pages_page_idx
  on public.builder_published_pages (page_id);

-- The public site's only lookup: this project, this address.
create index if not exists builder_published_pages_project_slug_idx
  on public.builder_published_pages (project_id, slug);

create index if not exists builder_published_pages_build_idx
  on public.builder_published_pages (build_id);

comment on table public.builder_published_pages is
  'The live snapshot of each page, written by Publish. Distinct from builder_landing_page.is_published, which is a visibility flag. A page with no row here has never been published and is served from its draft.';
