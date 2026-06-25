-- app_projects_favicon.sql
-- Store project favicon on the project row (shared for all members), separate from logo.

begin;

alter table public.app_projects
  add column if not exists favicon_data_url text not null default '';

comment on column public.app_projects.favicon_data_url is 'Project favicon (data URL or https URL). Used for browser tab icon when this project is active.';

commit;
