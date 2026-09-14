-- A project's default theme is chosen on purpose, not by save order
-- (task 86bbzybx6).
--
-- Before this, a page with no theme of its own rendered with whichever theme
-- in its project was SAVED most recently, so saving any theme could recolour
-- every such page. `is_default` marks the one theme those pages use.
--
-- The backfill flags each project's CURRENT most-recently-saved theme — the
-- one those pages already show today — so running this changes nothing any
-- visitor sees. From then on the default only moves when someone picks
-- "Make default" on the Themes page. Safe to run twice.

alter table if exists public.builder_themes
  add column if not exists is_default boolean not null default false;

-- Only projects with no default yet, so a re-run never moves a choice made
-- since. Rows with no project (pre-project legacy) are left unflagged: the
-- app lists them alongside a project's own themes, and a flagged legacy row
-- could outrank the theme those pages show today.
--
-- The trigger is switched off for this one statement. It stamps updated_at =
-- now() on every update, and a theme's updated_at is what the Publish panel
-- compares against each page's last build (lib/builderPublishStore.js,
-- publishSourceStamp) — so letting it fire would list every page that uses
-- the default (49 on Delray) as "changes to publish" when nothing changed.
begin;
set local session_replication_role = replica;

with newest as (
  select distinct on (project_id)
         id
    from public.builder_themes t
   where t.project_id is not null
     and not exists (
           select 1 from public.builder_themes d
            where d.is_default
              and d.project_id = t.project_id
         )
   order by project_id, updated_at desc, created_at desc
)
update public.builder_themes b
   set is_default = true
  from newest
 where b.id = newest.id;

commit;
