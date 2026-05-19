-- Channels password encryption migration
-- Run once in Supabase SQL editor.

alter table if exists public.channels
  add column if not exists password_enc text null;

alter table if exists public.channels
  add column if not exists password_iv text null;

alter table if exists public.channels
  add column if not exists password_tag text null;

alter table if exists public.channels
  add column if not exists key_version text null;

alter table if exists public.channels
  alter column password set default '';
