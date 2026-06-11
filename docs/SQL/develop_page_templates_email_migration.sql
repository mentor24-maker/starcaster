-- Unify email templates into develop_page_templates (template_kind = 'email').

alter table if exists public.develop_page_templates
  add column if not exists email_function text;

alter table if exists public.develop_page_templates
  add column if not exists summary text not null default '';

alter table if exists public.develop_page_templates
  add column if not exists subject text not null default '';

alter table if exists public.develop_page_templates
  add column if not exists email_slug text;

create index if not exists develop_page_templates_email_function_idx
  on public.develop_page_templates (email_function)
  where template_kind = 'email';

create unique index if not exists develop_page_templates_email_slug_project_uidx
  on public.develop_page_templates (project_id, email_slug)
  where template_kind = 'email' and email_slug is not null and email_slug <> '';
