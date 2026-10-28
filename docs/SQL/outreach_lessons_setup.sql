-- outreach_lessons_setup.sql
-- Outreach wizard 13/19 (Loop Queue task 86bcrmbpm): the plain-sentence
-- lessons the drafters write with ("Never open with a compliment"), turned
-- out of Dane's past choices (outreach_feedback, slice 12) or written by him.
-- lib/outreachLessons.js reads and writes them; every drafter adds the lessons
-- that are ON to its prompt, after the canon.
--
--   channel     'youtube' | 'substack' | 'reddit', or 'all' for every channel
--   text        the lesson, one line, in plain words
--   enabled     on or off — an off lesson is never in a prompt
--   source      'suggested' (proposed from his feedback) | 'dane' (his own)
--   edited      a suggested lesson he changed — a refresh never replaces it
--   why         the sentence naming the feedback behind it
--               ("from 4 rejections tagged \"too salesy\"")
--   evidence    that feedback, as it was when the lesson was proposed:
--               a list of { feedbackId, action, reasons, note, createdAt }
--
-- And on each channel's drafts, `lessons_used`: the lessons that were ON when
-- the draft was written, as a list of { id, text }. Rows drafted before this
-- ran read back as '[]', which is true: there were no lessons then.
--
-- BOTH tenant columns (CLAUDE.md landmine 12), written explicitly by the
-- store. project_id is text, never uuid (DOCTRINE 5.13). RLS on with no
-- policies for the app, like every table since the 2026-08-17 lockdown.
--
-- Run BEFORE the code is live. Until then a draft is refused with a message
-- naming this file — never written without its lessons record.
--
-- The last block gives `starcaster_readonly` (the login `npm run db:refresh`
-- copies production with) sight of the rows; skipped where it does not exist.
--
-- Touches nothing that exists beyond adding the three columns. Idempotent:
-- running the whole file twice changes nothing.

create table if not exists public.outreach_lessons (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  owner_user_id  text not null,

  channel        text not null
                 check (channel in ('all', 'youtube', 'substack', 'reddit')),
  text           text not null,
  enabled        boolean not null default true,
  source         text not null default 'suggested'
                 check (source in ('suggested', 'dane')),
  edited         boolean not null default false,
  why            text not null default '',
  evidence       jsonb not null default '[]'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_outreach_lessons_project_channel
  on public.outreach_lessons (project_id, channel);

alter table public.outreach_lessons enable row level security;

alter table public.reddit_comment_items
  add column if not exists lessons_used jsonb not null default '[]'::jsonb;

alter table public.youtube_outreach_comments
  add column if not exists lessons_used jsonb not null default '[]'::jsonb;

alter table public.substack_notes_items
  add column if not exists lessons_used jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'starcaster_readonly')
     and not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'outreach_lessons'
          and policyname = 'starcaster_readonly_select'
     ) then
    execute 'grant select on public.outreach_lessons to starcaster_readonly';
    execute 'create policy starcaster_readonly_select on public.outreach_lessons '
         || 'for select to starcaster_readonly using (true)';
  end if;
end $$;
