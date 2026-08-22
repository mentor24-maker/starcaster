-- project_bug_reports_setup.sql
-- Intake table for the in-app Bug Report module (Loop Queue task 1/5).
-- A public visitor, or a signed-in tenant admin/staff, submits a report;
-- this table stores it. No admin browsing UI yet — that is a later task.
--
-- Carries BOTH project_id and owner_user_id (CLAUDE.md landmine 12): a
-- table with only one of the two makes lib/projectScope.js's column probe
-- fail, and scopedInsertRow then silently stops stamping either column —
-- every insert would land untenanted with no error.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown
-- (docs/SQL/enable_rls_lockdown.sql): all reads/writes go through the Node
-- server with the Supabase service key, which bypasses RLS, so this is safe
-- and keeps Supabase's security-advisor findings from reopening.

create table if not exists public.project_bug_reports (
  id                     uuid primary key default gen_random_uuid(),
  project_id             text not null,
  owner_user_id          text,
  description            text not null,
  page_url               text not null default '',
  user_agent             text not null default '',
  viewer_tier            text not null default 'public' check (viewer_tier in ('public', 'client', 'staff')),
  screenshot_asset_ids   jsonb not null default '[]'::jsonb,
  status                 text not null default 'new' check (status in ('new', 'forwarded', 'failed_forward')),
  created_at             timestamptz not null default now()
);

create index if not exists idx_project_bug_reports_project_id on public.project_bug_reports (project_id);
create index if not exists idx_project_bug_reports_status on public.project_bug_reports (status);

alter table public.project_bug_reports enable row level security;
