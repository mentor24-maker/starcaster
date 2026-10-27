-- reddit_comments_draft_options.sql
-- Outreach wizard 9/19 (Loop Queue task 86bcrmbke): Write with AI offers THREE
-- replies to choose from instead of one, and the one Dane picked is recorded.
--
-- Run AFTER reddit_comments_setup.sql and reddit_comments_posting.sql. Adds two
-- columns to reddit_comment_items, both with defaults, so every existing row
-- reads exactly as before (an older draft simply has no options and shows its
-- one draft the way it always did).
--
--   draft_options  the replies the AI wrote, in the order shown:
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

alter table public.reddit_comment_items add column if not exists draft_options jsonb not null default '[]'::jsonb;
alter table public.reddit_comment_items add column if not exists chosen_option integer;
