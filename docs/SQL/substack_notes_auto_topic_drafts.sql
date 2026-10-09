-- substack_notes_auto_topic_drafts.sql
-- Substack Notes 5/7 (Loop Queue task 86bcet77n): the Settings switch "Draft
-- Notes from my topics on their own".
--
-- One new column on substack_notes_settings, default OFF, so nothing starts
-- drafting until Dane switches it on. It changes nothing that already exists:
-- every saved settings row reads back as switched off.
--
-- Until this runs, the store never writes the column unless the switch itself
-- is being saved (lib/substackNotesStore.js), so every other setting keeps
-- saving; saving the switch is refused with a message naming this file, and
-- the scheduled pass (lib/substackNotesRunDue.js) logs the same.
--
-- Idempotent: running it twice changes nothing.

alter table public.substack_notes_settings
  add column if not exists auto_topic_drafts boolean not null default false;
