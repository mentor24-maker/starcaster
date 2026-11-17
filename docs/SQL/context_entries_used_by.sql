-- context_entries_used_by.sql
-- FEATURE: Reel Spinner cannot tell which Context notes describe the channel, so it cannot score clips
-- RUN AFTER docs/SQL/context_entries_setup.sql
--
-- Ticket SC-826 (Reel Spinner 2a). Each Assets › Context entry gets a list of
-- the tools switched on to read it ("Reel Spinner reads this" on the page).
-- The allowed values are one list in lib/contextUses.js; the store refuses
-- anything else, so this column is never free text in practice.
--
-- Empty by default: an entry nobody switched on is read by no tool.
-- No new table, so no tenant columns and no new RLS rule: the existing
-- starcaster_readonly read rule on context_entries already covers it.
--
-- Idempotent: running the whole file twice changes nothing. Apply in the
-- Supabase SQL editor of the STARCASTER project.

alter table public.context_entries add column if not exists used_by text[] not null default '{}';
