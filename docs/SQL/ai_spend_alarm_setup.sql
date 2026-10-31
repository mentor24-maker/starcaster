-- AI Quota 4/5 (ClickUp 86bcvj7zm): the spending alarm on Settings › AI Quota.
--
-- ONE row for the whole account (id = 'account'), not one per project: the
-- alarm guards the Anthropic bill, and that bill is every project's calls plus
-- the Mac Mini's. A per-project limit could not be compared with it.
-- project_id / owner_user_id record which project and which person last saved
-- the settings (CLAUDE.md landmine 12 — both columns, always written together).
--
-- The *_alarm_at columns are the alarm's memory between scheduled runs: when
-- each kind of alert last went out, so it repeats at most once per 6 hours and
-- clears (posting one "back to normal" line) on the first quiet check.
-- Vercel has no disk that survives a run, so this state has to live here.

create table if not exists public.ai_spend_alarm (
  id                   text        primary key default 'account',
  project_id           text,
  owner_user_id        text,
  daily_limit_usd      numeric     not null default 5,
  spike_multiple       numeric     not null default 3,
  alert_email          text        not null default '',
  over_limit_alarm_at  timestamptz,
  spike_alarm_at       timestamptz,
  unreadable_alarm_at  timestamptz,
  last_check_at        timestamptz,
  last_check           jsonb       not null default '{}'::jsonb,
  updated_at           timestamptz not null default now(),
  constraint ai_spend_alarm_single_row check (id = 'account'),
  constraint ai_spend_alarm_limit_positive check (daily_limit_usd > 0),
  constraint ai_spend_alarm_multiple_sane check (spike_multiple >= 1)
);

-- Server-only table (service key); no browser reads it. RLS on with no
-- policies, like every other table since 2026-08-18.
alter table public.ai_spend_alarm enable row level security;
