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
update public.contact_personas
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.segments
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.campaigns
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.channels
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.develop_themes
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.develop_email_templates
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.develop_landing_page
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.develop_extensions
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
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
update public.develop_extensions_manager
set
  project_id = (select id from target_project),
  owner_user_id = 'mentorofaio'
where project_id is null
  and exists (select 1 from target_project);
