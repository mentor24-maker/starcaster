-- substack_notes_draft_options.sql
-- Outreach wizard 11/19 (Loop Queue task 86bcrmbmy): Write a draft — and both
-- scheduled passes (topic drafts and new-content Notes) — offer THREE Notes or
-- replies to choose from instead of one, and the one Dane picked is recorded.
-- The same shape Reddit got in 9/19 (reddit_comments_draft_options.sql) and
-- YouTube in 10/19 (youtube_outreach_draft_options.sql).
--
-- Run AFTER substack_notes_setup.sql. Adds two columns to substack_notes_items,
-- both with defaults, so every existing row reads exactly as before (an older
-- draft simply has no options and shows its one draft the way it always did).
--
--   draft_options  the Notes or replies the AI wrote, in the order shown:
--                  [{ text, angle, rule: { ok: true } }] for each one kept, and
--                  [{ angle, dropped: true, rule: { ok: false, reason, problems } }]
--                  for each one dropped because it broke a rule twice (its words
--                  are not kept — nobody should be able to pick it).
--   chosen_option  which entry of draft_options Dane picked (0, 1 or 2), set on
--                  Approve. Null when he approved a draft written before options
--                  existed. The words he approved, after his edits, are
--                  final_text, as before.
--
-- Nothing else changes. Idempotent: running the whole file twice changes nothing.

alter table public.substack_notes_items add column if not exists draft_options jsonb not null default '[]'::jsonb;
alter table public.substack_notes_items add column if not exists chosen_option integer;
