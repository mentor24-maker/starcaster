create table if not exists public.develop_landing_page (
  id bigserial primary key,
  name text not null default '',
  template_kind text not null default 'fixed',
  template_id text not null default '',
  primary_color text not null default '',
  background_color text not null default '',
  accent_color text not null default '',
  form_id text not null default '',
  lead_magnet_id text not null default '',
  headline_id text not null default '',
  pitch_id text not null default '',
  cta_id text not null default '',
  website_banner_image_id text not null default '',
  background_image_id text not null default '',
  feature_image_id text not null default '',
  highlight_image_id text not null default '',
  feature_headline_id text not null default '',
  feature_subheading_id text not null default '',
  feature_title text not null default '',
  feature_copy text not null default '',
  highlight_headline_id text not null default '',
  highlight_pitch_id text not null default '',
  highlight_title text not null default '',
  highlight_copy text not null default '',
  body_headline_id text not null default '',
  body_subheading_id text not null default '',
  body_pitch_id text not null default '',
  logo_wide_id text not null default '',
  logo_square_id text not null default '',
  layout_sections jsonb not null default '[]'::jsonb,
  content_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.develop_landing_page
  add column if not exists content_overrides jsonb not null default '{}'::jsonb;

alter table public.develop_landing_page
  add column if not exists highlight_image_id text not null default '';

alter table public.develop_landing_page
  add column if not exists feature_headline_id text not null default '';

alter table public.develop_landing_page
  add column if not exists feature_subheading_id text not null default '';

alter table public.develop_landing_page
  add column if not exists feature_title text not null default '';

alter table public.develop_landing_page
  add column if not exists feature_copy text not null default '';

alter table public.develop_landing_page
  add column if not exists highlight_headline_id text not null default '';

alter table public.develop_landing_page
  add column if not exists highlight_pitch_id text not null default '';

alter table public.develop_landing_page
  add column if not exists highlight_title text not null default '';

alter table public.develop_landing_page
  add column if not exists highlight_copy text not null default '';

alter table public.develop_landing_page
  add column if not exists body_headline_id text not null default '';

alter table public.develop_landing_page
  add column if not exists body_subheading_id text not null default '';

alter table public.develop_landing_page
  add column if not exists body_pitch_id text not null default '';

create index if not exists develop_landing_page_name_idx
  on public.develop_landing_page (name);

create index if not exists develop_landing_page_template_id_idx
  on public.develop_landing_page (template_id);

create or replace function public.set_develop_landing_page_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_develop_landing_page_updated_at on public.develop_landing_page;

create trigger trg_develop_landing_page_updated_at
before update on public.develop_landing_page
for each row
execute function public.set_develop_landing_page_updated_at();
