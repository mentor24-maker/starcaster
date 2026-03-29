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
update public.assets
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
update public.asset_categories
set
  project_id = (select id from target_project),
  owner_user_id = coalesce(owner_user_id, (select created_by_user_id from target_project))
where project_id is null
  and exists (select 1 from target_project);
