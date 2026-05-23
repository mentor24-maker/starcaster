-- Per-project default URL for Campaign and Engage: Social posts.
-- Apply manually in Supabase SQL editor for each environment.

begin;

alter table public.app_projects
  add column if not exists project_url text not null default '',
  add column if not exists website text not null default '';

comment on column public.app_projects.project_url is 'Required project-level default URL for campaigns and social posts.';
comment on column public.app_projects.website is 'Compatibility alias for the project default URL.';

update public.app_projects
set project_url = website
where coalesce(project_url, '') = ''
  and coalesce(website, '') <> '';

update public.app_projects
set website = project_url
where coalesce(website, '') = ''
  and coalesce(project_url, '') <> '';

commit;
