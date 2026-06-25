-- app_projects_domain.sql
-- Custom domain mapping: one hostname per project for public Builder site routing.

begin;

alter table public.app_projects
  add column if not exists domain text not null default '';

create unique index if not exists idx_app_projects_domain_unique
  on public.app_projects (lower(domain))
  where domain <> '';

comment on column public.app_projects.domain is
  'Public site hostname (e.g. benvin.org). Empty = no custom domain. Unique when set.';

commit;
