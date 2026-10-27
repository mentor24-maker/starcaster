-- outreach_canon_used.sql
-- Outreach wizard 8/19 (Loop Queue task 86bcrmbje): YouTube comments and
-- Substack Notes are now written from Dane of Earth's canon, the same way
-- Reddit comments are (lib/canonPrompt.js). Each draft records which canon
-- documents it was written from, as reddit_comments.canon_used already does:
-- a list of { docKey, syncedAt }.
--
-- Run BEFORE the code that writes it is live. Until then a YouTube or Substack
-- draft is written but refused at save, with a message naming this file
-- (lib/canonPrompt.js explainMissingCanonColumn) — never saved without it.
--
-- Rows drafted before this ran read back as '[]': they were written from the
-- free-text voice setting alone, and nothing records otherwise.
--
-- Idempotent: running it twice changes nothing.

alter table public.youtube_outreach_comments
  add column if not exists canon_used jsonb not null default '[]'::jsonb;

alter table public.substack_notes_items
  add column if not exists canon_used jsonb not null default '[]'::jsonb;
