with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_topics
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_formats
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_tags
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_keywords
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_headlines
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_subheadings
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_taglines
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_pitches
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_articles
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_reports
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_white_papers
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_ebooks
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_tweets
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_emails
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_posts
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_descriptions
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_transcripts
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_comments
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_hashtags
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);

with target_project as (
  select
    id,
    created_by_user_id
  from public.app_projects
  where lower(coalesce(name, '')) = lower('IZIT:APP')
     or lower(coalesce(slug, '')) = lower('izit-app')
  order by created_at asc nulls last
  limit 1
)
update public.messaging_ctas
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);
