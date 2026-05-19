-- Channels email migration
-- Run once in Supabase SQL editor.

alter table if exists public.channels
  add column if not exists email text not null default '';
