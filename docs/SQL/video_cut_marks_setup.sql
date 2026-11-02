-- video_cut_marks_setup.sql
-- What each recording should cut: one row per source file.
-- Loop Queue task 86bcwaw80 (Reel Spinner 1a).
--
-- Reel Spinner step 1 is "find what to cut". Nothing edits video until the
-- last step of the pipeline: every stage writes DECISIONS. A cut mark is a
-- decision — "from 12.40 s to 12.71 s is an 'uh'" — never a trimmed file.
--
-- Nothing writes here yet (1c does) and nothing shows it (1d does).
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

create table if not exists public.video_cut_marks (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null,
  owner_user_id   text,
  -- The source these marks cut. Deleting the source deletes its marks; marks
  -- against a file that is no longer in the catalog cut nothing.
  source_id       uuid not null references public.video_sources (id) on delete cascade,
  -- What the find-the-cuts step concluded:
  --   done    it looked, and `marks` is the answer (an empty list is a real
  --           answer: nothing worth cutting)
  --   failed  it tried and could not; `reason` says why
  -- "Not looked at yet" is the ABSENCE of a row, never a third state, so a
  -- source can never read as checked because of a default.
  state           text not null
                  check (state in ('done', 'failed')),
  reason          text,
  -- Which version of the cut rules produced these marks, so a later rule
  -- change can find the old rows and redo them.
  rules_version   text,
  -- Which speech-to-text model produced the word-for-word transcript.
  model           text,
  duration_s      numeric,
  -- The word-for-word transcript, 'um's and all. Kept apart from
  -- video_transcripts ON PURPOSE: that table's clean text is what search and
  -- the Transcript view read, and fillers would pollute both.
  verbatim_text   text not null default '',
  -- [{ start, end, word, p }], seconds; p is the model's confidence, 0..1.
  verbatim_words  jsonb not null default '[]'::jsonb,
  -- [{ start, end, kind, keep_s, words, why }], seconds.
  --   kind    pause | filler | repeat | false_start
  --   keep_s  how much of a pause stays in (a pause is shortened, not removed)
  --   words   the words the mark covers, as said
  --   why     one plain sentence a person can read
  marks           jsonb not null default '[]'::jsonb,
  -- Total seconds the marks remove.
  cut_s           numeric not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One set of marks per source, per project — and the column pair the store's
-- upsert names in `on_conflict=project_id,source_id`. Per project, never global
-- (the messaging_topics fossil, 2026-08-10).
create unique index if not exists idx_video_cut_marks_project_source
  on public.video_cut_marks (project_id, source_id);

create index if not exists idx_video_cut_marks_project_id
  on public.video_cut_marks (project_id);

create or replace function public.video_cut_marks_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists video_cut_marks_touch_updated_at on public.video_cut_marks;
create trigger video_cut_marks_touch_updated_at
  before update on public.video_cut_marks
  for each row execute function public.video_cut_marks_touch_updated_at();

alter table public.video_cut_marks enable row level security;
