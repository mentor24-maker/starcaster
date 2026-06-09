-- website_peers_last_acquired_at_migration.sql
-- Adds last_acquired_at to website_peers (replaces legacy last_harvested_at when present).
-- Run once in Supabase SQL editor for each environment (local/preview/prod).

begin;

alter table public.website_peers
  add column if not exists last_acquired_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'website_peers'
      and column_name = 'last_harvested_at'
  ) then
    update public.website_peers
    set last_acquired_at = coalesce(last_acquired_at, last_harvested_at, updated_at, created_at, now())
    where last_acquired_at is null;
  else
    update public.website_peers
    set last_acquired_at = coalesce(last_acquired_at, updated_at, created_at, now())
    where last_acquired_at is null;
  end if;
end $$;

alter table public.website_peers
  alter column last_acquired_at set default now();

update public.website_peers
set last_acquired_at = coalesce(last_acquired_at, updated_at, created_at, now())
where last_acquired_at is null;

alter table public.website_peers
  alter column last_acquired_at set not null;

commit;
