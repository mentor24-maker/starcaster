-- FEATURE: Reel Spinner has nowhere to keep scored clips, matched recordings or edits, so steps 2 to 6 cannot run
-- RUN AFTER docs/SQL/video_studio_setup.sql
--
-- video_reel_spinner_setup.sql
-- Where Reel Spinner steps 2 to 6 keep their decisions. Task SC-827
-- (Reel Spinner 2b).
--
--   video_moments      the scored moments of each recording, one row per source
--   video_audio_pairs  which two recordings were made together (an iPhone take
--                      and its Zoom recording), how far apart they start, and
--                      whose sound the edit uses
--   video_edits        each output — a full video or a short clip — as it moves
--                      from rough cut to YouTube
--
-- Like the cut marks (docs/SQL/video_cut_marks_setup.sql), every row here is a
-- set of DECISIONS. No row holds an edited file: a rough cut lives on Drive and
-- this table holds its Drive file id, nothing more.
--
-- Nothing writes here yet. The stores are lib/videoMomentsStore.js,
-- lib/videoAudioPairsStore.js and lib/videoEditsStore.js.
--
-- BOTH tenant columns on every table (CLAUDE.md landmine 12). lib/projectScope.js
-- decides whether to stamp a tenant by probing for project_id AND owner_user_id
-- together; with only one, scopedInsertRow silently stamps neither.
--
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key, which bypasses it.
--
-- Idempotent: every statement is `if not exists` or is itself a no-op when
-- already true, so running the whole file twice changes nothing.

-- ── video_moments ───────────────────────────────────────────────────────────

create table if not exists public.video_moments (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text not null,
  owner_user_id         text,
  source_id             uuid not null references public.video_sources (id) on delete cascade,
  -- What the scoring step concluded:
  --   done    it scored the recording, and `moments` is the answer (an empty
  --           list is a real answer: nothing worth a clip)
  --   failed  it tried and could not; `error` says why
  -- "Not scored yet" is the ABSENCE of a row, never a third state.
  status                text not null
                        check (status in ('done', 'failed')),
  -- [{ start_s, end_s, score, reasons, project, mood, quote }], seconds.
  --   score    0-100, how strong the moment is
  --   reasons  plain sentences saying why it scored that
  --   project  which project the moment speaks to
  moments               jsonb not null default '[]'::jsonb,
  summary               text,
  -- Which version of the brief the moments were scored against, so a changed
  -- brief can find the rows scored against the old one.
  brief_fingerprint     text,
  model                 text,
  rules_version         text,
  -- Set when Dane asks for a recording to be scored again; the Mini polls for it.
  rescore_requested_at  timestamptz,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One set of moments per source, per project — the store's upsert target.
create unique index if not exists idx_video_moments_project_source
  on public.video_moments (project_id, source_id);

create index if not exists idx_video_moments_project_id
  on public.video_moments (project_id);

create or replace function public.video_moments_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists video_moments_touch_updated_at on public.video_moments;
create trigger video_moments_touch_updated_at
  before update on public.video_moments
  for each row execute function public.video_moments_touch_updated_at();

alter table public.video_moments enable row level security;

-- ── video_audio_pairs ───────────────────────────────────────────────────────

create table if not exists public.video_audio_pairs (
  id               uuid primary key default gen_random_uuid(),
  project_id       text not null,
  owner_user_id    text,
  -- The two recordings. The store always files the pair in one order (the
  -- smaller id first), so A-with-B and B-with-A are one row, never two.
  source_a_id      uuid not null references public.video_sources (id) on delete cascade,
  source_b_id      uuid not null references public.video_sources (id) on delete cascade,
  -- How many seconds after A's first frame B's first frame was recorded
  -- (negative when B started first), and how far the two clocks have drifted
  -- apart by the end. Both are measured from A to B.
  offset_s         numeric,
  drift_s          numeric,
  -- 0..1, how sure the line-up is.
  confidence       numeric,
  -- Whose sound the edit uses: one of the two sources, or null for undecided.
  audio_source_id  uuid references public.video_sources (id) on delete set null,
  -- `measured` when the line-up chose the better sound, `dane` when he did. A
  -- later measurement never overwrites his choice.
  chosen_by        text not null default 'measured'
                   check (chosen_by in ('measured', 'dane')),
  --   done    the two were lined up
  --   failed  they could not be; `error` says why
  status           text not null
                   check (status in ('done', 'failed')),
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists idx_video_audio_pairs_project_pair
  on public.video_audio_pairs (project_id, source_a_id, source_b_id);

create index if not exists idx_video_audio_pairs_project_id
  on public.video_audio_pairs (project_id);

create or replace function public.video_audio_pairs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists video_audio_pairs_touch_updated_at on public.video_audio_pairs;
create trigger video_audio_pairs_touch_updated_at
  before update on public.video_audio_pairs
  for each row execute function public.video_audio_pairs_touch_updated_at();

alter table public.video_audio_pairs enable row level security;

-- ── video_edits ─────────────────────────────────────────────────────────────

create table if not exists public.video_edits (
  id                       uuid primary key default gen_random_uuid(),
  project_id               text not null,
  owner_user_id            text,
  source_id                uuid not null references public.video_sources (id) on delete cascade,
  -- full   the whole recording, cut
  -- short  one moment of it, cut; `moment_index` says which
  kind                     text not null
                           check (kind in ('full', 'short')),
  -- Which entry of video_moments.moments this short is. Null for a full edit.
  moment_index             integer,
  -- [{ start_s, end_s }], seconds: the parts of the source that stay in.
  keep_ranges              jsonb not null default '[]'::jsonb,
  -- Whose sound the edit uses (see video_audio_pairs).
  audio_source_id          uuid references public.video_sources (id) on delete set null,
  -- The edit's place in the pipeline. lib/videoEditsStore.js holds the allowed
  -- steps and refuses any other move:
  --   draft → rendering → review → approved | skipped | sent_back
  --   sent_back → rendering (a recut)    approved → finished → uploading → on_youtube
  --   any machine step → failed          failed → draft
  -- The website writes only the review half (approved / skipped / sent_back,
  -- dane_note and the YouTube text); the Mini polls for those, because the
  -- website cannot reach the Mini's queue.
  status                   text not null default 'draft'
                           check (status in ('draft', 'rendering', 'review', 'approved', 'skipped',
                                             'sent_back', 'finished', 'uploading', 'on_youtube', 'failed')),
  rough_cut_drive_file_id  text,
  dane_note                text,
  -- How many times Dane sent it back and it was cut again.
  recut_count              integer not null default 0,
  music_track              text,
  youtube_title            text,
  youtube_description      text,
  youtube_tags             jsonb not null default '[]'::jsonb,
  youtube_video_id         text,
  error                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- One full edit per source, and one short per moment, per project.
create unique index if not exists idx_video_edits_project_source_full
  on public.video_edits (project_id, source_id) where kind = 'full';

create unique index if not exists idx_video_edits_project_source_short
  on public.video_edits (project_id, source_id, moment_index) where kind = 'short';

create index if not exists idx_video_edits_project_status
  on public.video_edits (project_id, status);

create or replace function public.video_edits_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists video_edits_touch_updated_at on public.video_edits;
create trigger video_edits_touch_updated_at
  before update on public.video_edits
  for each row execute function public.video_edits_touch_updated_at();

alter table public.video_edits enable row level security;
