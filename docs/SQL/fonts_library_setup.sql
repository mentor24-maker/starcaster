-- fonts_library_setup.sql
-- Font Library 1/7 (Loop Queue task 86bchyd3n): somewhere to keep font files
-- that are not Google Fonts, so a site can use any free font a commercial
-- website is allowed to use.
--
--   fonts   one row per font family. Its files (one per weight/style) live in
--           blob storage; `styles` lists them.
--
-- Nothing reads this table yet. The Fonts screen is 2/7; the theme and module
-- pickers are 3/7; the starter pack is 4/7. This file only creates the place
-- they read.
--
-- Two kinds of row, told apart by `visibility`:
--
--   'platform'  Starcaster's shared library. Every project can read it; no
--               project can change or delete it. project_id and owner_user_id
--               are NULL. Written by scripts (the 4/7 starter pack), never by
--               the API.
--   'project'   A font one project uploaded. Read and written by that project
--               only. project_id is required.
--
-- BOTH tenant columns (CLAUDE.md landmine 12). lib/projectScope.js probes for
-- project_id AND owner_user_id together; a table carrying only one fails the
-- probe and scopedInsertRow silently stops stamping either. project_id is text,
-- never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- `licence` is limited to the three licences that allow use on a business
-- website. lib/fontLicence.js refuses anything else with a plain message
-- before the database is asked; the check here is the backstop.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key, which bypasses RLS.
--
-- `tags` has no database default: lib/fontsStore.js always writes it, and the
-- test fake that reads this file cannot read an array literal as a default.
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: every statement is `if not exists` or a no-op when already true,
-- so running the whole file twice changes nothing. Apply in the Supabase SQL
-- editor of the STARCASTER project and log the run in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.

create table if not exists public.fonts (
  id                   uuid primary key default gen_random_uuid(),
  -- The name people see and the name CSS uses ("Space Grotesk"). Letters,
  -- digits, single spaces and hyphens only (lib/fontLicence.js
  -- checkFontFamilyName), so it is safe inside a CSS string and a URL.
  family               text not null,
  slug                 text not null,
  category             text not null default 'sans'
                       check (category in ('serif', 'sans', 'display', 'monospace', 'handwriting')),
  -- [{ "weight": 400, "style": "normal", "url": "https://…/x.woff2",
  --    "format": "woff2", "pathname": "Fonts/…" }] — one file each.
  styles               jsonb not null default '[]'::jsonb,
  licence              text not null
                       check (licence in ('OFL-1.1', 'Apache-2.0', 'public-domain')),
  licence_text         text not null default '',
  source_url           text not null default '',
  -- Where it came from: Fontsource, Font Squirrel, Velvetyne, Upload, …
  source_name          text not null default '',
  tags                 text[] not null,
  preview_text         text not null default '',
  visibility           text not null default 'project'
                       check (visibility in ('platform', 'project')),
  project_id           text,
  owner_user_id        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- A slug is unique within its scope: once across the shared library, and once
-- per project among that project's own uploads. A project may upload its own
-- copy of a family the shared library also has.
create unique index if not exists fonts_platform_slug_key
  on public.fonts (slug) where visibility = 'platform';
create unique index if not exists fonts_project_slug_key
  on public.fonts (project_id, slug) where visibility = 'project';

create index if not exists fonts_project_idx
  on public.fonts (project_id);

alter table public.fonts enable row level security;
