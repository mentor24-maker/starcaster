-- outreach_feedback_setup.sql
-- Outreach wizard 12/19 (Loop Queue task 86bcrmbnw): WHY Dane rejected a
-- draft, or what he did with one he approved, on every outreach channel. One
-- row per decision. Slice 13 turns these into lessons the drafters read; until
-- then nothing reads them but the reason picker, which offers the reasons he
-- has used before (lib/outreachFeedbackStore.js listReasons).
--
--   channel       'youtube' | 'substack' | 'reddit'
--   item_id       the decided row's id in that channel's own table
--   item_kind     Substack's 'note' / 'reply' / 'restack' / 'like'; '' elsewhere
--   action        rejected        — Reject (reason_tags empty = "no reason given",
--                                   which is what Skip records)
--                 approved-as-is  — approved the draft's own words
--                 approved-edited — approved after changing the words
--                 chose-option    — picked one of the options and approved it unchanged
--   reason_tags   the chips he clicked ("too salesy", or one of his own)
--   note          his optional sentence
--   draft_text    the words he was shown (the picked option, when he picked one)
--   final_text    the words he approved ('' on a rejection)
--   chosen_option which option he picked (its index in draftOptions), or null
--
-- BOTH tenant columns (CLAUDE.md landmine 12), written explicitly by the store
-- rather than through scopedInsertRow. project_id is text, never uuid
-- (DOCTRINE 5.13). RLS on with no policies for the app, like every table since
-- the 2026-08-17 lockdown; the Node server reads it with the service key.
--
-- Run BEFORE the code is live. Until then every decision still happens — the
-- draft is rejected or approved — and the screen says the reason was NOT
-- saved, naming this file. It is never reported as saved when it was not.
--
-- The last block gives `starcaster_readonly` (the login `npm run db:refresh`
-- copies production with) sight of the rows; without it an RLS table copies
-- down EMPTY rather than failing. Skipped where that login does not exist.
--
-- Touches nothing that exists. Idempotent: running the whole file twice
-- changes nothing.

create table if not exists public.outreach_feedback (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  owner_user_id  text not null,

  channel        text not null
                 check (channel in ('youtube', 'substack', 'reddit')),
  item_id        text not null,
  item_kind      text not null default '',
  action         text not null
                 check (action in ('rejected', 'approved-as-is', 'approved-edited', 'chose-option')),
  reason_tags    text[] not null default '{}',
  note           text not null default '',
  draft_text     text not null default '',
  final_text     text not null default '',
  chosen_option  integer,

  created_at     timestamptz not null default now()
);

create index if not exists idx_outreach_feedback_project_id
  on public.outreach_feedback (project_id);

create index if not exists idx_outreach_feedback_project_action
  on public.outreach_feedback (project_id, action);

alter table public.outreach_feedback enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'starcaster_readonly')
     and not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'outreach_feedback'
          and policyname = 'starcaster_readonly_select'
     ) then
    execute 'grant select on public.outreach_feedback to starcaster_readonly';
    execute 'create policy starcaster_readonly_select on public.outreach_feedback '
         || 'for select to starcaster_readonly using (true)';
  end if;
end $$;
