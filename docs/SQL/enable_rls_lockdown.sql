-- enable_rls_lockdown.sql
-- Turn on Row-Level Security for every public table that still lacks it —
-- 65 tables as of the 2026-08-17 production schema record.
--
-- Why: Supabase's weekly security scan ("Action required: security
-- vulnerabilities detected", arriving every Monday since at least 2026-07-07)
-- flags two critical findings on this database: rls_disabled_in_public and
-- sensitive_columns_exposed (app_auth_users, app_auth_sessions, contacts and
-- leads are all in the unlocked set). Without RLS, anyone holding the
-- publishable API key can read and write these tables directly, bypassing the
-- app entirely.
--
-- Why enabling RLS with NO policies is safe here: every query in this
-- codebase goes through the Node server (lib/supabase.js) using the service
-- key, and the service role bypasses RLS. The anon key is configured but
-- consumed by nothing (no realtime, no websockets, no browser client). 71
-- tables already run with RLS enabled and no app-visible difference. With RLS
-- on and no policies, the publishable/anon key gets nothing and the app keeps
-- working unchanged.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY on a table that already has it is a
-- no-op, so re-running this file is harmless.
--
-- Apply in Supabase SQL Editor, then record in docs/Markdown Files/MIGRATIONS_APPLIED.md

begin;

alter table public.acquire_youtube_comment_records enable row level security;
alter table public.acquire_youtube_comments enable row level security;
alter table public.acquire_youtube_details enable row level security;
alter table public.acquire_youtube_topics enable row level security;
alter table public.activity_log enable row level security;
alter table public.app_auth_sessions enable row level security;
alter table public.app_auth_users enable row level security;
alter table public.app_project_memberships enable row level security;
alter table public.app_projects enable row level security;
alter table public.asset_categories enable row level security;
alter table public.assets enable row level security;
alter table public.builder_email_templates enable row level security;
alter table public.builder_extensions enable row level security;
alter table public.builder_extensions_manager enable row level security;
alter table public.builder_forms enable row level security;
alter table public.builder_landing_page enable row level security;
alter table public.builder_modules enable row level security;
alter table public.builder_page_templates enable row level security;
alter table public.builder_themes enable row level security;
alter table public.campaign_events enable row level security;
alter table public.campaigns enable row level security;
alter table public.channels enable row level security;
alter table public.contact_field_configs enable row level security;
alter table public.contact_personas enable row level security;
alter table public.contact_sources enable row level security;
alter table public.contact_statuses enable row level security;
alter table public.contact_types enable row level security;
alter table public.contacts enable row level security;
alter table public.content_item_assets enable row level security;
alter table public.content_types enable row level security;
alter table public.engage_youtube_comment_agents enable row level security;
alter table public.leads enable row level security;
alter table public.memories enable row level security;
alter table public.messaging_articles enable row level security;
alter table public.messaging_comments enable row level security;
alter table public.messaging_content_items enable row level security;
alter table public.messaging_content_types enable row level security;
alter table public.messaging_ctas enable row level security;
alter table public.messaging_descriptions enable row level security;
alter table public.messaging_ebooks enable row level security;
alter table public.messaging_emails enable row level security;
alter table public.messaging_formats enable row level security;
alter table public.messaging_hashtags enable row level security;
alter table public.messaging_headlines enable row level security;
alter table public.messaging_keywords enable row level security;
alter table public.messaging_pitches enable row level security;
alter table public.messaging_posts enable row level security;
alter table public.messaging_prompts enable row level security;
alter table public.messaging_reports enable row level security;
alter table public.messaging_subheadings enable row level security;
alter table public.messaging_subject_lines enable row level security;
alter table public.messaging_taglines enable row level security;
alter table public.messaging_tags enable row level security;
alter table public.messaging_topics enable row level security;
alter table public.messaging_transcripts enable row level security;
alter table public.messaging_tweets enable row level security;
alter table public.messaging_white_papers enable row level security;
alter table public.promo_lead_field_configs enable row level security;
alter table public.segment_types enable row level security;
alter table public.segments enable row level security;
alter table public.training_rules_guides enable row level security;
alter table public.training_settings enable row level security;
alter table public.training_taxonomy enable row level security;
alter table public.website_peers enable row level security;
alter table public.youtube_comment_runs enable row level security;

commit;

-- Verify: this should return zero rows afterwards.
-- select tablename from pg_tables
--   where schemaname = 'public' and not rowsecurity
--   order by tablename;
