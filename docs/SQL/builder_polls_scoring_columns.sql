-- Normie / Would You Rather scoring import columns for builder_polls.
-- Apply manually in Supabase SQL editor after polls_setup.sql.
-- Source CSV: docs/CSV/normie_200_would_you_rather_scoring_system.xlsm - Starcaster Import.csv

alter table public.builder_polls
  add column if not exists external_id text,
  add column if not exists personality_system text,
  add column if not exists trait_dimension text,
  add column if not exists scoring_logic text,
  add column if not exists weight numeric(10, 4) default 1,
  add column if not exists reverse_scored boolean default false,
  add column if not exists ai_interpretation_tag text;

comment on column public.builder_polls.external_id is 'Stable import id (e.g. NORM-001) from scoring CSV Question ID';
comment on column public.builder_polls.personality_system is 'e.g. MBTI, Big Five, DISC';
comment on column public.builder_polls.trait_dimension is 'Trait or dimension label from scoring CSV';
comment on column public.builder_polls.scoring_logic is 'Human-readable scoring rules for this poll';
comment on column public.builder_polls.weight is 'Scoring weight (default 1)';
comment on column public.builder_polls.reverse_scored is 'Whether choice scoring is reversed';
comment on column public.builder_polls.ai_interpretation_tag is 'Tag for AI interpretation of vote patterns';

create unique index if not exists idx_builder_polls_external_id
  on public.builder_polls (external_id)
  where external_id is not null;

alter table public.builder_poll_options
  add column if not exists score_code text;

comment on column public.builder_poll_options.score_code is 'Personality/scoring code for this option (e.g. I, E, High Openness)';

create index if not exists idx_builder_polls_personality_system
  on public.builder_polls (personality_system);

create index if not exists idx_builder_polls_category
  on public.builder_polls (category);
