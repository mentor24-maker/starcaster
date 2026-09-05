-- One tag table, and every tag knows where it came from.
--
-- Starcaster had two tag registries: public.messaging_tags (149 rows, two
-- projects, in use since March) and public.asset_tags (created 2026-09-01 by
-- docs/SQL/asset_tags_setup.sql, and never written to — 0 rows). This column
-- is what lets the second one fold into the first: tags created through a
-- client's own admin back-end are written here with source = 'client-admin',
-- and tags created in the Starcaster back-end keep the behaviour they have.
--
-- Deliberately NOT backfilled. The 149 existing rows keep '', which reads as
-- "origin not recorded" — the truth. Guessing an origin for rows that predate
-- the column would put a false claim in a column whose only job is to be
-- trusted. Same decision, same reason, as docs/SQL/assets_source_column.sql.
--
-- asset_tags itself is NOT dropped here. That is a separate file, run only
-- once this is live and the 0-row count has been re-confirmed at that moment.

begin;

alter table public.messaging_tags
  add column if not exists source text not null default '';

-- Read with an equality match on top of the project scope, so the index is
-- (project_id, source), not source alone.
create index if not exists idx_messaging_tags_project_source
  on public.messaging_tags (project_id, source);

-- Uniqueness carried over from asset_tags, which had it and messaging_tags did
-- not. PER PROJECT and case-insensitive: two tenants may both have a "Courts"
-- tag, and one tenant must not end up with "Courts" and "courts" as separate
-- entries — a list that splits like that is useless within a month.
--
-- The check below runs FIRST and refuses with a readable message rather than
-- letting the index build fail with a raw constraint-violation dump. Measured
-- against a same-day mirror of production on 2026-09-04: 149 rows, 0 exact
-- duplicates, 0 case-insensitive duplicates, 0 null project_id. If this raises,
-- production has drifted since that reading and the listed rows need merging
-- by hand before the index can exist.
do $$
declare
  clashes int;
  sample  text;
begin
  select count(*), coalesce(string_agg(detail, '; '), '')
    into clashes, sample
    from (
      select project_id || ' / ' || lower(tag) || ' x' || count(*) as detail
        from public.messaging_tags
       group by project_id, lower(tag)
      having count(*) > 1
       limit 10
    ) dupes;

  if clashes > 0 then
    raise exception
      'messaging_tags has % duplicate (project_id, lower(tag)) group(s) — merge them before adding the unique index. First few: %',
      clashes, sample;
  end if;
end $$;

create unique index if not exists idx_messaging_tags_project_tag
  on public.messaging_tags (project_id, lower(tag));

commit;
