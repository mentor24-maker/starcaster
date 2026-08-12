-- app_invitations_setup.sql
-- Invite-only registration: a platform invitation, optionally carrying the
-- project the invited person should land in.
--
-- Why this is not team_invitations: that table requires a contacts row and a
-- project, because it invites an existing CRM contact onto a project team.
-- This one invites an email address that the platform has never seen, and the
-- project is optional.
--
-- Depends on: auth_supabase_setup.sql, projects_multitenancy_setup.sql
-- Apply in Supabase SQL Editor, then record in docs/Markdown Files/MIGRATIONS_APPLIED.md

begin;

create table if not exists public.app_invitations (
  id text primary key,
  email text not null,
  -- Null means "no workspace chosen yet". The invited person lands on the
  -- no-workspace page, which points them back at whoever invited them.
  project_id text null,
  -- Role granted in project_id when the invite is accepted. Ignored when
  -- project_id is null.
  project_role text not null default 'member',
  token_hash text not null,
  status text not null default 'pending',
  invited_by_user_id text not null references public.app_auth_users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  accepted_user_id text null references public.app_auth_users(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint app_invitations_project_role_check
    check (project_role in ('owner', 'member')),
  constraint app_invitations_status_check
    check (status in ('pending', 'accepted', 'expired', 'revoked'))
);

-- One live invitation per email address. Re-inviting revokes the old one
-- first, so a stale link can never be redeemed after a newer one is sent.
create unique index if not exists idx_app_invitations_pending_email
  on public.app_invitations (lower(email))
  where status = 'pending';

-- Registration looks an invitation up by token on every attempt.
create index if not exists idx_app_invitations_token_hash
  on public.app_invitations (token_hash);

create index if not exists idx_app_invitations_invited_by
  on public.app_invitations (invited_by_user_id);

create index if not exists idx_app_invitations_project_id
  on public.app_invitations (project_id);

alter table public.app_invitations enable row level security;

drop policy if exists "Allow all access on app invitations" on public.app_invitations;

-- Matches every other table here: the service key is the only thing that
-- reaches Postgres, and access is decided in routes/index.js.
create policy "Allow all access on app invitations"
  on public.app_invitations
  for all
  to public
  using (true)
  with check (true);

commit;
