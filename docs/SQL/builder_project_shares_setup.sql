-- builder_project_shares_setup.sql
-- Loop Queue task 86bcu6t1c: one project shares its saved sections, page
-- templates or themes with another of the same person's projects.
--
--   builder_project_shares   one row per (source project, target project, type).
--
-- project_id is the SOURCE — the project doing the sharing — so the table is
-- tenant-scoped like every other Builder table and carries BOTH tenant columns
-- (CLAUDE.md landmine 12). lib/builderProjectSharesStore.js writes both
-- explicitly rather than through scopedInsertRow, and reads the rows back.
--
-- Sharing copies nothing. The target project only reads the source's items
-- through GET /api/builder/shared/:type, and copies one into itself later with
-- an explicit Import. Deleting a row makes those items disappear from the
-- target's list at once.
--
-- object_type is checked here as well as in the store, so a typo from any
-- caller is refused by the database rather than stored as a share nothing
-- reads.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key.
--
-- Idempotent: running the whole file twice changes nothing. Apply in the
-- Supabase SQL editor of the STARCASTER project and log the run in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.

create table if not exists public.builder_project_shares (
  id                  uuid primary key default gen_random_uuid(),
  project_id          text not null,
  owner_user_id       text not null,
  target_project_id   text not null,
  object_type         text not null
    check (object_type in ('saved_sections', 'page_templates', 'themes')),
  created_by_user_id  text not null default '',
  created_at          timestamptz not null default now(),
  constraint builder_project_shares_not_self check (project_id <> target_project_id)
);

create unique index if not exists builder_project_shares_pair_key
  on public.builder_project_shares (project_id, target_project_id, object_type);

-- The receiving side's read: "who shares <type> with me?"
create index if not exists builder_project_shares_target_idx
  on public.builder_project_shares (target_project_id, object_type);

alter table public.builder_project_shares enable row level security;
