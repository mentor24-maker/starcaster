alter table if exists public.develop_landing_pages
  add column if not exists theme_id text;
