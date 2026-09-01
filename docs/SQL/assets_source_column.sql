-- Records HOW an asset arrived, so media added through the Admin Media
-- Manager can be found on its own inside the general gallery.
--
-- Deliberately NOT backfilled. Existing rows keep '', which reads as "origin
-- not recorded" — the truth. Guessing an origin for 550 historical rows would
-- put a false claim in a column whose only job is to be trusted.
--
-- 'Who added it' is already answered by assets.owner_user_id; this column is
-- only about which surface the upload came through.

begin;

alter table public.assets
  add column if not exists source text not null default '';

-- The gallery filter reads this column with an equality match on top of the
-- project scope, so the index is (project_id, source), not source alone.
create index if not exists idx_assets_project_source
  on public.assets (project_id, source);

commit;
