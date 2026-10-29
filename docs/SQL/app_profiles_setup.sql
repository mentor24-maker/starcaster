-- Per-user profile settings for Settings > Profile
create table if not exists public.app_profiles (
  user_id text primary key,
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  logo_data_url text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_profiles_email on public.app_profiles (email);

-- Every public table is RLS-on with no policies since 2026-08-18 (the server
-- reads with the service key, which bypasses RLS). Added 2026-10-28 (task
-- 86bcu8ftx) — this file had never been applied, so it predated that rule.
alter table public.app_profiles enable row level security;
