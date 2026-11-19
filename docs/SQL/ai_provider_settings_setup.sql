-- AI switch 2 (SC-844): the AI provider switch on Settings › APIs.
-- FEATURE: the AI provider switch on Settings › APIs cannot save, so every AI feature stays on Anthropic
--
-- ONE row for the whole platform (id = 'platform'), not one per project: it
-- decides which AI account every call bills, the website's and the Mac Mini's.
-- lib/aiClient.js reads it (cached 60 seconds) through
-- lib/aiProviderSettingsStore.js; when the row is missing or unreadable the
-- door falls back to the AI_PROVIDER_ORDER setting, which is today's behaviour.
--
--   providers         ordered list: [{ "id", "enabled", "fast", "strong" }]
--   custom_providers  extra OpenAI-style services: [{ "id", "label", "baseUrl", "keyEnv" }]
--                     keyEnv is the NAME of the setting that holds the key —
--                     never a key value (docs/DOCTRINE.md §4.1).
--
-- project_id / owner_user_id record which project and which person last saved
-- it (CLAUDE.md landmine 12 — both columns, always written together).
--
-- Safe to run twice: every statement is create-if-missing or add-if-missing.

create table if not exists public.ai_provider_settings (
  id                text        primary key default 'platform',
  project_id        text,
  owner_user_id     text,
  providers         jsonb       not null default '[]'::jsonb,
  custom_providers  jsonb       not null default '[]'::jsonb,
  updated_at        timestamptz not null default now(),
  constraint ai_provider_settings_single_row check (id = 'platform')
);

alter table public.ai_provider_settings add column if not exists project_id text;
alter table public.ai_provider_settings add column if not exists owner_user_id text;
alter table public.ai_provider_settings add column if not exists providers jsonb not null default '[]'::jsonb;
alter table public.ai_provider_settings add column if not exists custom_providers jsonb not null default '[]'::jsonb;
alter table public.ai_provider_settings add column if not exists updated_at timestamptz not null default now();

-- Server-only table (service key); no browser reads it. RLS on with no
-- policies, like every other table since 2026-08-18.
alter table public.ai_provider_settings enable row level security;
