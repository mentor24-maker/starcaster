-- FEATURE: bookings cannot carry a Google Meet link or their Google Calendar event, and every booking read asks for these fields, so booking a meeting and the Booking Manager fail outright until it runs
-- RUN AFTER docs/SQL/booking_notifications.sql
--
-- booking_google_calendar.sql
-- Booking calendar, slice 5 of 6 (SC-913): each booking's Google Calendar
-- event and its Google Meet link, when the project has connected its Google
-- Calendar from the Booking Manager.
--
-- Adds to public.bookings:
--   google_event_id     the event's id on the connected Google Calendar, so a
--                       cancel or a move changes THAT event
--   meet_link           the Google Meet address, put in both emails and shown
--                       on the Booking Manager
--   google_sync_status  how the latest Google step went: 'synced' or 'failed'.
--                       NULL means Google was never involved (no calendar
--                       connected, or a booking made before this file ran).
--                       A 'failed' booked meeting shows "No Meet link yet"
--                       with a Retry button on the Booking Manager.
--   google_sync_error   what went wrong, in plain words, when 'failed'
--   google_synced_at    when that Google step was attempted
--
-- The Google sign-in itself is stored in project_connections (provider
-- 'google_calendar'), encrypted, like every other connection; this file does
-- not touch that table.
--
-- No new table, so no tenant columns and no RLS change: bookings already has
-- both tenant columns and RLS on (booking_setup.sql).
--
-- Idempotent: every statement is `if not exists`, so running the file twice
-- changes nothing.

alter table public.bookings add column if not exists google_event_id text;
alter table public.bookings add column if not exists meet_link text;
alter table public.bookings add column if not exists google_sync_status text check (google_sync_status in ('synced', 'failed'));
alter table public.bookings add column if not exists google_sync_error text;
alter table public.bookings add column if not exists google_synced_at timestamptz;
