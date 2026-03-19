-- Adds persistent YouTube miner response context to profile settings
alter table if exists public.app_profiles
  add column if not exists youtube_response_context text not null default '';

