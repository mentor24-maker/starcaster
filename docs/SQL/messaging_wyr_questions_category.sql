-- Add category column to messaging_wyr_questions (separate from topic).

alter table if exists public.messaging_wyr_questions
  add column if not exists category text not null default '';

create index if not exists idx_messaging_wyr_questions_category
  on public.messaging_wyr_questions (category);
