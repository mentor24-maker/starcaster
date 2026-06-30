alter table if exists public.builder_themes
  add column if not exists top_margin integer not null default 0;

alter table if exists public.builder_themes
  add column if not exists bottom_margin integer not null default 0;

alter table if exists public.builder_themes
  add column if not exists side_margins integer not null default 0;
