-- substack_notes_browser_check.sql
-- YouTube outreach 7/7 (Loop Queue task 86bcda6dt), review round 1: where the
-- Mini's posting worker writes what it found the last time it checked that its
-- browser is signed in to Substack as Dane of Earth, so the Substack Notes
-- screen can say it without reaching the Mini.
--
-- The same four columns, with the same meanings, as
-- youtube_outreach_browser_check.sql adds to youtube_outreach_settings. The
-- check runs hourly whether or not anything posts to Substack yet (Substack
-- Notes 6/7 adds the posting), so the screen knows the sign-in is good before
-- the first Note goes out, not after it fails.
--
--   browser_state        signed_in | signed_out | wrong_account | gateway_down
--                        | cannot_tell. Blank means the Mini has never checked.
--   browser_message      the sentence the screen shows, in plain words.
--   browser_checked_at   when that check ran. A check hours old is itself the
--                        finding: the worker that writes it has stopped.
--   browser_signed_in_at the last time a check found it signed in.
--
-- Written by the worker only (lib/substackNotesStore.js recordBrowserCheck),
-- never by the screen's Save, which sends only the settings.
--
-- `add column if not exists` throughout, so running this twice changes nothing.

alter table public.substack_notes_settings add column if not exists browser_state text not null default '';
alter table public.substack_notes_settings add column if not exists browser_message text not null default '';
alter table public.substack_notes_settings add column if not exists browser_checked_at timestamptz;
alter table public.substack_notes_settings add column if not exists browser_signed_in_at timestamptz;
