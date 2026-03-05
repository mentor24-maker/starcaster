-- Run this in Supabase SQL editor before using /api/promo-leads/* endpoints.

-- Main leads table (if you already have one, skip create and apply ALTER statements).
create table if not exists public.promo_leads (
  id bigint generated always as identity primary key,
  email text not null unique,
  first_name text,
  last_name text,
  phone text,
  company text,
  source text,
  status text default 'new',
  notes text,
  tags text[] default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure existing table has required columns for custom-field flow.
alter table public.promo_leads
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.promo_leads
  add column if not exists updated_at timestamptz not null default now();

-- Metadata table that powers the "custom fields" config tool.
create table if not exists public.promo_lead_field_configs (
  id bigint generated always as identity primary key,
  key text not null unique,
  label text not null,
  type text not null default 'text',
  required boolean not null default false,
  is_active boolean not null default true,
  position integer not null default 0,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful index for key lookups.
create index if not exists idx_promo_lead_field_configs_active
  on public.promo_lead_field_configs (is_active, position, key);

