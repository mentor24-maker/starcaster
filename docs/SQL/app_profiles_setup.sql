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
