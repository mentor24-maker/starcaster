-- undo_substack_miner_in_wavecenter_project.sql
-- ONE-OFF, for the Supabase project named "WaveCenter" ONLY — NOT Starcaster.
--
-- On 2026-10-12 substack_miner_setup.sql was run in the WaveCenter project by
-- mistake (an agent's instructions named the org, WaveCenter, as if it were the
-- project). That created two empty tables there. This removes them.
--
-- Two guards, and it stops rather than guessing:
--   1. If this database has Starcaster's builder tables, it is the Starcaster
--      project, where these tables belong — stop, drop nothing.
--   2. If either table holds any rows, stop, drop nothing.

do $$
declare
  n bigint;
begin
  if to_regclass('public.builder_published_pages') is not null then
    raise exception 'STOPPED: this looks like the Starcaster database (it has builder_published_pages). The Substack tables belong here. Nothing was removed. Switch to the WaveCenter project and run it there.';
  end if;

  if to_regclass('public.substack_candidates') is not null then
    execute 'select count(*) from public.substack_candidates' into n;
    if n > 0 then
      raise exception 'STOPPED: substack_candidates has % row(s). Nothing was removed.', n;
    end if;
  end if;

  if to_regclass('public.substack_miner_settings') is not null then
    execute 'select count(*) from public.substack_miner_settings' into n;
    if n > 0 then
      raise exception 'STOPPED: substack_miner_settings has % row(s). Nothing was removed.', n;
    end if;
  end if;

  drop table if exists public.substack_candidates;
  drop table if exists public.substack_miner_settings;
  raise notice 'Removed the two Substack Miner tables from this project.';
end $$;
