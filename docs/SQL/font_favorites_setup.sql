-- font_favorites_setup.sql
-- Font Library 8 (Loop Queue task 86bchydpv): each person stars the fonts they
-- like, and the Fonts screen switches between Favourites and All fonts.
--
--   font_favorites   one row per (person, font) they starred.
--
-- A favourite belongs to the PERSON, not the project: Dane's stars follow him
-- across every site he works on, and a tenant admin's stars are their own. So
-- this table deliberately carries NO project_id / owner_user_id pair, and it is
-- never written through scopedInsertRow (CLAUDE.md landmine 12 — that helper
-- decides what to stamp by probing for both tenant columns, and must not be
-- relied on for a table that is per-user by design). lib/fontsStore.js writes
-- user_id from the signed-in session and reads the row back.
--
-- No foreign key to public.fonts on purpose. A star on a font that is later
-- deleted, or that belongs to a project the person is not working in right
-- now, is never shown: every read joins against the fonts the caller's project
-- can see. That also keeps "delete a font" a one-table write.
--
-- user_id is text, matching fonts.owner_user_id (DOCTRINE 5.13).
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key.
--
-- Idempotent: running the whole file twice changes nothing. Apply in the
-- Supabase SQL editor of the STARCASTER project and log the run in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.

create table if not exists public.font_favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  font_id     uuid not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists font_favorites_user_font_key
  on public.font_favorites (user_id, font_id);

alter table public.font_favorites enable row level security;
