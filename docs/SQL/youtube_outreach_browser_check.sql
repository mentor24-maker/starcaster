-- youtube_outreach_browser_check.sql
-- YouTube outreach 7/7 (Loop Queue task 86bcda6dt): where the Mini's posting
-- worker writes what it found the last time it checked its browser, so the
-- YouTube Outreach screen (and Observe) can say it without reaching the Mini.
--
-- Nothing on the internet can reach the Mini: OpenClaw listens on 127.0.0.1
-- only. So the Mini reports OUT, once an hour, onto the account's settings row
-- (youtube_outreach_setup.sql), and the screen reads the row. The settings row
-- is the right home because the check is per posting account, exactly like
-- the limits on that row.
--
--   browser_state        what the last check found:
--                          signed_in      signed in as the expected account
--                          signed_out     the browser is signed out
--                          wrong_account  signed in, as somebody else
--                          gateway_down   OpenClaw itself did not answer
--                          cannot_tell    it answered, but no verdict could be read
--                        Blank means the worker has never checked.
--   browser_message      the sentence the screen shows, in plain words.
--   browser_checked_at   when that check ran. A check hours old is itself the
--                        finding: the worker that writes it has stopped.
--   browser_signed_in_at the last time a check found it signed in — so
--                        "signed out since 3pm" can be said, not guessed.
--
-- Written by the worker only (lib/youtubeOutreachStore.js recordBrowserCheck),
-- never by the screen's Save, which sends only the limits.
--
-- `add column if not exists` throughout, so running this twice changes nothing.
-- No check constraint on browser_state: the worker is the only writer and the
-- store validates the value; a constraint would make a sixth state a migration.

alter table public.youtube_outreach_settings add column if not exists browser_state text not null default '';
alter table public.youtube_outreach_settings add column if not exists browser_message text not null default '';
alter table public.youtube_outreach_settings add column if not exists browser_checked_at timestamptz;
alter table public.youtube_outreach_settings add column if not exists browser_signed_in_at timestamptz;
