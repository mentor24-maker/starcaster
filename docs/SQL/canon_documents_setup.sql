-- canon_documents_setup.sql
-- Reddit comments 1/4 (Loop Queue task 86bch3jmr): a copy of Dane of Earth's
-- canon — his voice, DEO and the ecosystem overview — inside Starcaster's
-- database, so a drafter running on Vercel can read it. The originals live in
-- Dane's vault (`~/vault/doctrine/`), which the live app cannot reach.
--
-- One row per document per project. `npm run canon:sync` (scripts/sync_canon.mjs)
-- writes them from the vault; nothing else does. Dane chose the documents on
-- 2026-10-12: Dane of Earth + Voice, DEO, and the Ecosystem overview.
--
--   doc_key        stable name, e.g. DANE-OF-EARTH — the upsert key with project_id
--   body           the markdown, exactly as it is in the vault
--   source_path    where it came from, relative to the vault (doctrine/VOICE.md)
--   content_hash   sha256 of body; the sync compares it to say "unchanged"
--   synced_at      when this row's copy was last taken
--
-- BOTH tenant columns (CLAUDE.md landmine 12) — lib/projectScope.js probes for
-- project_id AND owner_user_id together. project_id is text, never uuid
-- (DOCTRINE 5.13). RLS on with no policies for the app, like every table since
-- the 2026-08-17 lockdown; the Node server reads it with the service key.
--
-- The last block gives `starcaster_readonly` (the login `npm run db:refresh`
-- copies production with) sight of the rows. Without it an RLS table copies
-- down EMPTY rather than failing. It is skipped where that login does not exist.
--
-- Touches nothing that exists. Idempotent: running the whole file twice
-- changes nothing.

create table if not exists public.canon_documents (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  owner_user_id  text not null,
  doc_key        text not null,
  title          text not null default '',
  body           text not null,
  source_path    text not null default '',
  content_hash   text not null,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, doc_key)
);

create index if not exists idx_canon_documents_project_id
  on public.canon_documents (project_id);

alter table public.canon_documents enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'starcaster_readonly')
     and not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'canon_documents'
          and policyname = 'starcaster_readonly_select'
     ) then
    execute 'grant select on public.canon_documents to starcaster_readonly';
    execute 'create policy starcaster_readonly_select on public.canon_documents '
         || 'for select to starcaster_readonly using (true)';
  end if;
end $$;
