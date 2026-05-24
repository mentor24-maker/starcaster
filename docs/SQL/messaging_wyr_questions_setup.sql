-- WYR (Would You Rather) questions for campaigns — imported from CSV (Question, Topic, Category).
-- Record kind: messaging_wyr_question

create table if not exists public.messaging_wyr_questions (
  id bigserial primary key,
  question text not null,
  topic text not null default '',
  category text not null default '',
  object_kind text not null default 'messaging_wyr_question',
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_wyr_questions_topic
  on public.messaging_wyr_questions (topic);

create index if not exists idx_messaging_wyr_questions_category
  on public.messaging_wyr_questions (category);

create index if not exists idx_messaging_wyr_questions_project_id
  on public.messaging_wyr_questions (project_id);

create index if not exists idx_messaging_wyr_questions_created_at
  on public.messaging_wyr_questions (created_at desc);

create or replace function public.set_messaging_wyr_questions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_wyr_questions_updated_at on public.messaging_wyr_questions;
create trigger trg_messaging_wyr_questions_updated_at
before update on public.messaging_wyr_questions
for each row
execute function public.set_messaging_wyr_questions_updated_at();
