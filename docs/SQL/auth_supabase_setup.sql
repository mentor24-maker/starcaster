-- Persistent auth tables for APP login/register on Vercel
-- Run in Supabase SQL Editor (project used by app.isitas.org)

create table if not exists public.app_auth_users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_auth_sessions (
  token text primary key,
  user_id text not null references public.app_auth_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_app_auth_users_email on public.app_auth_users (email);
create index if not exists idx_app_auth_sessions_user_id on public.app_auth_sessions (user_id);
create index if not exists idx_app_auth_sessions_expires_at on public.app_auth_sessions (expires_at);
