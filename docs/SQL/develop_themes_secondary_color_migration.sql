alter table if exists public.develop_themes
  add column if not exists secondary_color text;
