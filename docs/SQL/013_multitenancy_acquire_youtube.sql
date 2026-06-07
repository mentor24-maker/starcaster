-- 013_multitenancy_acquire_youtube.sql
-- Project-scope Acquire: YouTube tables (videos, detail runs, comment runs, topics).
-- Apply in StarCaster Supabase after projects_multitenancy_setup.sql.
--
-- Prerequisite: YouTube tables must exist. If this script skips every table, run first:
--   docs/SQL/supabase_acquire_youtube_details.sql
-- With STRICT_PROJECT_SCOPE=true, rows with NULL project_id are hidden from new projects.

begin;

-- Add scope columns + indexes only when each target table exists
do $$
declare
  t text;
  tables text[] := array[
    'acquire_youtube_details',
    'acquire_youtube_comments',
    'acquire_youtube_videos',
    'acquire_youtube_topics'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = t
    ) then
      execute format(
        'alter table public.%I add column if not exists project_id text null, add column if not exists owner_user_id text null',
        t
      );
      execute format(
        'create index if not exists idx_%I_project_id on public.%I (project_id)',
        t,
        t
      );
      raise notice 'Project scope columns added for %', t;
    else
      raise notice 'Skipping %: table does not exist', t;
    end if;
  end loop;
end $$;

commit;

-- Optional backfill (replace placeholders) before enabling STRICT_PROJECT_SCOPE:
-- update public.acquire_youtube_details set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID' where project_id is null;
-- update public.acquire_youtube_comments set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID' where project_id is null;
-- update public.acquire_youtube_videos set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID' where project_id is null;
-- update public.acquire_youtube_topics set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID' where project_id is null;
