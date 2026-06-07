-- channels_openclaw_profile_migration.sql
-- OpenClaw browser profile name for channels that publish via browser automation (e.g. Facebook Personal).

alter table if exists public.channels
  add column if not exists openclaw_profile text not null default '';

create index if not exists idx_channels_openclaw_profile
  on public.channels (openclaw_profile)
  where openclaw_profile <> '';
