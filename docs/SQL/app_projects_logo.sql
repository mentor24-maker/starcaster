-- app_projects_logo.sql
-- Store project logos on the project row (shared for all members), not per-user profile or browser.

begin;

alter table public.app_projects
  add column if not exists logo_data_url text not null default '';

comment on column public.app_projects.logo_data_url is 'Project logo (data URL or https URL). Visible to all project members.';

commit;
