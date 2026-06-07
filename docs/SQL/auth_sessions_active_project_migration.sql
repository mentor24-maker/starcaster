-- Add server-side active project to auth sessions (Phase 2 multitenancy)
-- Run in Supabase SQL Editor after 012_multitenancy_backfill_primary_project.sql

alter table public.app_auth_sessions
  add column if not exists active_project_id text null;

create index if not exists idx_app_auth_sessions_active_project_id
  on public.app_auth_sessions (active_project_id)
  where active_project_id is not null;

comment on column public.app_auth_sessions.active_project_id is
  'User-selected workspace for this session; validated against app_project_memberships on write.';
