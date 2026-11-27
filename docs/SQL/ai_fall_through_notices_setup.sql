-- FEATURE: every copy of the server posts its own "AI calls are using X" notice to the bus, so the same notice repeats instead of once per six hours
--
-- SC-925: when an AI provider runs out of credit or refuses its key, the AI
-- door (lib/aiClient.js) posts "AI calls are using X" to the bus at most once
-- per provider per six hours. Until this table exists that limit is kept in
-- each server copy's own memory, so every Vercel copy posts its own notice and
-- a cold start forgets it. One row per provider holds when its notice was last
-- posted; every copy reads and writes it through
-- lib/aiProviderSettingsStore.js (claimFallThroughNotice and friends).
--
--   provider        the AI provider's id ('anthropic', 'openai', ...)
--   last_posted_at  when the notice was last posted; null = nothing posted, or
--                   the provider has answered again since
--
-- A copy claims a notice with an update that only succeeds while
-- last_posted_at is null or older than six hours, so two copies deciding at
-- the same moment post one notice between them.
--
-- Platform-wide, like ai_provider_settings: project_id / owner_user_id are
-- present (CLAUDE.md landmine 12) and left empty, because no tenant owns a
-- provider's bill.
--
-- Until this file runs, the door behaves exactly as before: it limits by each
-- copy's own memory and logs that it did.
--
-- Safe to run twice: every statement is create-if-missing or add-if-missing.

create table if not exists public.ai_fall_through_notices (
  provider        text        primary key,
  project_id      text,
  owner_user_id   text,
  last_posted_at  timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.ai_fall_through_notices add column if not exists project_id text;
alter table public.ai_fall_through_notices add column if not exists owner_user_id text;
alter table public.ai_fall_through_notices add column if not exists last_posted_at timestamptz;
alter table public.ai_fall_through_notices add column if not exists updated_at timestamptz not null default now();

-- Server-only table (service key); no browser reads it. RLS on with no
-- policies, like every other table since 2026-08-18.
alter table public.ai_fall_through_notices enable row level security;
