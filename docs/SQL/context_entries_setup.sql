-- context_entries_setup.sql
-- FEATURE: Assets › Context, where each project keeps written reference material for agents; without it, the Context page says its table is missing and nothing can be saved there.
--
-- Ticket SC-808 (slice 1 of 3). One row per reference entry a project keeps
-- for agent sessions to read. Slice 1 writes notes only: a title and rich text.
-- SC-809 adds file uploads (kind 'file', using the file_* columns below, empty
-- until then); SC-810 adds a command agent sessions use to read the entries.
--
-- BOTH tenant columns (CLAUDE.md landmine 12). lib/projectScope.js probes for
-- project_id AND owner_user_id together; a table with only one fails the probe.
-- project_id is text, never uuid (DOCTRINE 5.13): project ids are slugs.
-- lib/contextStore.js writes both itself and always filters on project_id.
--
-- RLS on, matching every table since the 2026-08-17 lockdown. The app reaches
-- the table through the Node server with the service key, which bypasses RLS.
-- ONE read rule, for the read-only login `npm run context` uses in production
-- (SC-810, starcaster_readonly, the same block canon_documents_setup.sql has).
-- Under RLS a login with no rule sees zero rows and NO error, so without it
-- every project would read as "No context entries", exit 0.
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: running the whole file twice changes nothing. Apply in the
-- Supabase SQL editor of the STARCASTER project.

create table if not exists public.context_entries (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,
  title                text not null,
  kind                 text not null default 'note'
                       check (kind in ('note', 'file')),
  body_html            text not null default '',
  -- Filled in by SC-809 (file uploads); empty on every note.
  file_url             text not null default '',
  file_name            text not null default '',
  file_type            text not null default '',
  file_size            bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists context_entries_project_idx
  on public.context_entries (project_id, updated_at desc);

alter table public.context_entries enable row level security;

-- The read rule for starcaster_readonly (SC-810). Skipped where that login does
-- not exist (a fresh local database), and where the rule is already there, so
-- a file that was run before can be run again to add it.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'starcaster_readonly')
     and not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'context_entries'
          and policyname = 'starcaster_readonly_select'
     ) then
    execute 'grant select on public.context_entries to starcaster_readonly';
    execute 'create policy starcaster_readonly_select on public.context_entries '
         || 'for select to starcaster_readonly using (true)';
  end if;
end $$;
