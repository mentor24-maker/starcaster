-- Project Admin: project-scoped admin users and sessions.
-- Separate from platform (starcaster.pro) auth — team members log in with
-- project-specific credentials rather than a full platform account.
-- Supabase-only; no file-based fallback.

-- ---------------------------------------------------------------------------
-- app_project_admin_users
-- ---------------------------------------------------------------------------

create table if not exists public.app_project_admin_users (
  id            text        primary key,
  project_id    text        not null,
  email         text        not null,
  password_hash text        not null,
  role          text        not null default 'editor',  -- 'editor' | 'admin'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One account per email per project (not globally unique — same person can
-- have credentials for multiple projects).
create unique index if not exists idx_project_admin_users_project_email
  on public.app_project_admin_users (project_id, email);

create index if not exists idx_project_admin_users_project_id
  on public.app_project_admin_users (project_id);

create or replace function public.set_project_admin_users_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_project_admin_users_updated_at on public.app_project_admin_users;
create trigger trg_project_admin_users_updated_at
  before update on public.app_project_admin_users
  for each row execute function public.set_project_admin_users_updated_at();

-- ---------------------------------------------------------------------------
-- app_project_admin_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.app_project_admin_sessions (
  token         text        primary key,
  admin_user_id text        not null references public.app_project_admin_users(id) on delete cascade,
  project_id    text        not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index if not exists idx_project_admin_sessions_admin_user_id
  on public.app_project_admin_sessions (admin_user_id);

create index if not exists idx_project_admin_sessions_project_id
  on public.app_project_admin_sessions (project_id);

create index if not exists idx_project_admin_sessions_expires_at
  on public.app_project_admin_sessions (expires_at);
