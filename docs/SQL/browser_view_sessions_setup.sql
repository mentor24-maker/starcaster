-- browser_view_sessions_setup.sql
-- Outreach wizard 4/19 · sign-in window slice 2 (Loop Queue task 86bcrmbc9).
-- One row per sign-in window a project admin opens onto the Mac Mini's
-- browser: who opened it, for which site, when, when it closed, how long it
-- lasted and why it closed. The plan is docs/LIVE_BROWSER_VIEW.md (§4, §9).
--
--   open -> closed      closed by the viewer (finished, idle, time-limit,
--                       browser-gone, error), by Starcaster when the Mini
--                       could not be reached or refused the pass, or swept
--                       as not-reported once a window must have ended.
--
-- The pass itself is NEVER stored — only its SHA-256 (`pass_hash`), the same
-- as the door keeper keeps it (workers/browser-door/door.js). The pass is
-- shown to the admin's browser once, in the answer to the open request.
--
-- BOTH tenant columns (CLAUDE.md landmine 12) — lib/projectScope.js probes for
-- project_id AND owner_user_id together, and a table carrying only one makes
-- scopedInsertRow silently stamp NEITHER. project_id is text, never uuid
-- (DOCTRINE 5.13). RLS on with no policies, like every table since the
-- 2026-08-17 lockdown; the Node server reads it with the service key.
--
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: every statement is `if not exists`, so running the whole file
-- twice changes nothing.

create table if not exists public.browser_view_sessions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null,
  owner_user_id      text,

  -- Who opened it, copied at open time so the log still reads after a rename.
  opened_by          text not null,
  opened_by_email    text not null default '',
  site               text not null
                     check (site in ('google', 'youtube', 'substack', 'reddit')),

  pass_hash          text not null unique,
  pass_expires_at    timestamptz not null,

  status             text not null default 'open'
                     check (status in ('open', 'closed')),
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz,
  closed_by          text not null default '',
  close_reason       text not null default ''
                     check (close_reason in ('', 'finished', 'idle', 'time-limit', 'browser-gone', 'error',
                                             'not-configured', 'door-unreachable', 'door-refused', 'not-reported')),
  duration_seconds   integer,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_browser_view_sessions_project_id
  on public.browser_view_sessions (project_id);

create index if not exists idx_browser_view_sessions_project_status
  on public.browser_view_sessions (project_id, status);

alter table public.browser_view_sessions enable row level security;
