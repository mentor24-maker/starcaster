alter table if exists public.builder_themes
  add column if not exists page_background jsonb;
