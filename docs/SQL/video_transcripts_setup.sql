-- video_transcripts_setup.sql
-- Where a recording's transcript lives: one row per source file.
-- Loop Queue task 86bcdejyr (Studio Phase 2 · transcription · 1 of 6).
--
-- Nothing transcribes yet. This file only creates the place the transcribe
-- step (2 of 6, 3 of 6) writes to, and the Footage screen (4 and 5 of 6) reads.
-- Apply it AFTER docs/SQL/video_studio_setup.sql: source_id points at
-- video_sources.
--
-- BOTH tenant columns (CLAUDE.md landmine 12). lib/projectScope.js decides
-- whether to stamp a tenant by probing for project_id AND owner_user_id
-- together; with only one, scopedInsertRow silently stamps neither and the rows
-- land with no tenant at all.
--
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key, which bypasses it.
--
-- Idempotent: every statement is `if not exists` or is itself a no-op when
-- already true, so running the whole file twice changes nothing.

create table if not exists public.video_transcripts (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  owner_user_id  text,
  -- The source this is the transcript OF. Deleting the source deletes its
  -- transcript; a transcript of a file that is no longer in the catalog is
  -- text nobody can play back against.
  source_id      uuid not null references public.video_sources (id) on delete cascade,
  -- What the transcribe step concluded, constrained because these three ARE
  -- the answer the Footage screen shows:
  --   done      there is a transcript
  --   failed    it tried and could not; `reason` says why
  --   no_audio  the file has no speech to transcribe (not a failure)
  -- "Not transcribed yet" is the ABSENCE of a row, never a fourth state, so a
  -- source can never read as transcribed because of a default.
  state          text not null
                 check (state in ('done', 'failed', 'no_audio')),
  reason         text,
  language       text,
  -- Which speech-to-text model produced it, so a transcript made by an older
  -- model can be found and redone.
  model          text,
  duration_s     numeric,
  -- The full transcript as one string.
  text           text not null default '',
  -- [{ start, end, text }], seconds from the start of the file.
  segments       jsonb not null default '[]'::jsonb,
  -- [{ start, end, word, p }], seconds; p is the model's confidence, 0..1.
  words          jsonb not null default '[]'::jsonb,
  -- For search (5 of 6). 'simple', not 'english', ON PURPOSE: the search
  -- returns the SEGMENTS that contain the words, and lib/videoTranscriptsStore.js
  -- finds those by matching words itself. With English stemming the database
  -- would match "prices" for "pricing" and the segment pass would not, so a
  -- recording would come back as a hit with no moment to jump to. 'simple'
  -- lower-cases and splits; both halves then agree on what a match is.
  search_tsv     tsvector generated always as (to_tsvector('simple', coalesce(text, ''))) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One transcript per source, per project — and the column pair the store's
-- upsert names in `on_conflict=project_id,source_id`. Per project, never global
-- (the messaging_topics fossil, 2026-08-10).
create unique index if not exists idx_video_transcripts_project_source
  on public.video_transcripts (project_id, source_id);

create index if not exists idx_video_transcripts_project_id
  on public.video_transcripts (project_id);

create index if not exists idx_video_transcripts_search
  on public.video_transcripts using gin (search_tsv);

create or replace function public.video_transcripts_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists video_transcripts_touch_updated_at on public.video_transcripts;
create trigger video_transcripts_touch_updated_at
  before update on public.video_transcripts
  for each row execute function public.video_transcripts_touch_updated_at();

alter table public.video_transcripts enable row level security;
