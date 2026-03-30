alter table if exists public.messaging_headlines
  add column if not exists quality_score integer;
