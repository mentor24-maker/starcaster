alter table if exists public.develop_landing_page
  add column if not exists template_kind text not null default 'fixed';

alter table if exists public.develop_landing_page
  add column if not exists layout_sections jsonb not null default '[]'::jsonb;

update public.develop_landing_page
set template_kind = 'fixed'
where coalesce(nullif(trim(template_kind), ''), '') = '';
