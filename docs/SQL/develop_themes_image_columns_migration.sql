alter table if exists public.develop_themes
  add column if not exists logo_wide_id text not null default '';

alter table if exists public.develop_themes
  add column if not exists logo_square_id text not null default '';

alter table if exists public.develop_themes
  add column if not exists feature_image_id text not null default '';

alter table if exists public.develop_themes
  add column if not exists background_image_id text not null default '';
