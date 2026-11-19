-- FEATURE: Outreach and the other feature groups cannot have their own AI provider, so all of them use the main order
-- RUN AFTER docs/SQL/ai_provider_settings_setup.sql
--
-- AI provider groups 1 (SC-872): one more field on the AI provider switch's
-- single row, so each group of features (Outreach, Studio / Reel Spinner,
-- Writing, Acquire, Everything else; the list is lib/aiFeatureGroups.js) can
-- follow the main order or have its own.
--
--   group_orders  { "<group id>": [{ "id", "enabled", "fast", "strong" }] }
--                 A group that is not named here follows the main order.
--                 Empty (the default) means every group follows the main
--                 order, which is exactly how the switch behaved before.
--
-- It changes nothing that exists: one new field, empty by default.
-- Safe to run twice: add-if-missing.

alter table public.ai_provider_settings add column if not exists group_orders jsonb not null default '{}'::jsonb;
