-- team_invitations_setup.sql
-- Phase 1: team member email invitations + link contacts to app users.
-- Depends on: auth_supabase_setup.sql, projects_multitenancy_setup.sql,
--             contacts table, dev_team_setup.sql
--
-- Apply in Supabase SQL Editor, then record in docs/Markdown Files/MIGRATIONS_APPLIED.md

begin;

-- Link CRM contact records to login accounts (set when invite is accepted).
alter table public.contacts
  add column if not exists auth_user_id text null references public.app_auth_users(id) on delete set null;

create index if not exists idx_contacts_auth_user_id
  on public.contacts(auth_user_id);

create table if not exists public.team_invitations (
  id text primary key,
  project_id text not null,
  contact_id text not null references public.contacts(id) on delete cascade,
  dev_team_id uuid null references public.dev_team(id) on delete set null,
  email text not null,
  token_hash text not null,
  membership_role text not null,
  status text not null default 'pending',
  invited_by_user_id text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  accepted_user_id text null references public.app_auth_users(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint team_invitations_membership_role_check
    check (membership_role in ('admin', 'editor')),
  constraint team_invitations_status_check
    check (status in ('pending', 'accepted', 'expired', 'revoked'))
);

-- One active pending invite per contact per project.
create unique index if not exists idx_team_invitations_pending_project_contact
  on public.team_invitations (project_id, contact_id)
  where status = 'pending';

create index if not exists idx_team_invitations_token_hash
  on public.team_invitations (token_hash);

create index if not exists idx_team_invitations_project_id
  on public.team_invitations (project_id);

create index if not exists idx_team_invitations_dev_team_id
  on public.team_invitations (dev_team_id);

alter table public.team_invitations enable row level security;

drop policy if exists "Allow all access on team invitations" on public.team_invitations;

create policy "Allow all access on team invitations"
  on public.team_invitations
  for all
  to public
  using (true)
  with check (true);

commit;
