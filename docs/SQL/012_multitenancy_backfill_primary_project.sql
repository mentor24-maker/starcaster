-- 012_multitenancy_backfill_primary_project.sql
-- OPTIONAL: Assign legacy NULL project_id rows to one StarCaster project.
-- Run in the StarCaster Supabase project (not the Normie app database unless shared on purpose).
--
-- 1) Find your project id:
--    select id, name, slug from public.app_projects order by created_at;
-- 2) Find your user id:
--    select id, email from public.app_auth_users;
-- 3) Replace the placeholders below and uncomment the updates you need.

/*
update public.contacts
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.engage_social_posts
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.direct_acquire_runs
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.x_acquire_runs
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.reddit_acquire_runs
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.acquire_youtube_details
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.acquire_youtube_comments
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.acquire_youtube_videos
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;

update public.acquire_youtube_topics
  set project_id = 'YOUR_PROJECT_ID', owner_user_id = 'YOUR_USER_ID'
  where project_id is null;
*/

-- After backfill, set STRICT_PROJECT_SCOPE=true in ~/WebApps/starcaster/.env
-- and in the StarCaster Vercel project (not Normie's .env.local).
