-- FEATURE: booking reminder emails never send, and the Reminders section of the Booking Manager cannot load or save, until this runs; booking a meeting and everything else on the Booking Manager keep working without it
-- RUN AFTER docs/SQL/booking_notifications.sql
--
-- booking_reminders.sql
-- Booking calendar, slice 6 of 6 (SC-914): reminder emails before each
-- booked meeting.
--
-- Adds to public.booking_calendars:
--   reminder_settings  { "enabled": true, "offsetsMinutes": [1440, 60],
--                        "notifyOwner": false } — whether reminders go out,
--                      how long before the meeting, and whether the site owner
--                      gets one too. NULL means "the defaults" (on, a day and
--                      an hour before, visitor only), so every calendar that
--                      exists today starts sending reminders the day this runs.
--                      Read and written only by lib/bookingRemindersStore.js,
--                      never by the calendar's other reads, so a missing column
--                      breaks reminders and nothing else.
--
-- New table public.booking_reminders: one row per reminder per person per
-- meeting time. It is what makes "send each reminder once" true:
--   the unique index on (booking_id, offset_minutes, starts_at, recipient)
--   means two passes racing for the same reminder cannot both claim it; the
--   loser's insert is refused and it moves on. starts_at is part of the key
--   so a meeting that MOVES gets fresh reminders for its new time.
--   status     'sending' (claimed, being sent), 'sent', 'failed' (retried on
--              the next pass, up to 3 attempts in all, then shown on the
--              Booking Manager), or 'skipped' (the meeting was cancelled or
--              moved between the claim and the send)
--   attempts   how many times a send was tried
--   last_error what went wrong, in plain words
--
-- BOTH tenant columns (CLAUDE.md landmine 12). RLS on, no policies, like
-- every table since the 2026-08-17 lockdown; the Node server uses the service
-- key.
--
-- Idempotent: every statement is `if not exists` or a no-op when already
-- true, so running the file twice changes nothing.

alter table public.booking_calendars add column if not exists reminder_settings jsonb;

create table if not exists public.booking_reminders (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text not null,
  owner_user_id         text,
  calendar_id           uuid not null references public.booking_calendars (id) on delete cascade,
  booking_id            uuid not null references public.bookings (id) on delete cascade,
  -- How long before the meeting this reminder is for, in minutes (1440 = a day).
  offset_minutes        integer not null,
  -- The meeting's start time this reminder was for.
  starts_at             timestamptz not null,
  recipient             text not null check (recipient in ('visitor', 'owner')),
  status                text not null default 'sending'
                        check (status in ('sending', 'sent', 'failed', 'skipped')),
  attempts              integer not null default 0,
  last_error            text,
  sent_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_booking_reminders_once
  on public.booking_reminders (booking_id, offset_minutes, starts_at, recipient);

create index if not exists idx_booking_reminders_calendar_status
  on public.booking_reminders (project_id, calendar_id, status);

create or replace function public.booking_reminders_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_reminders_touch_updated_at on public.booking_reminders;
create trigger booking_reminders_touch_updated_at
  before update on public.booking_reminders
  for each row execute function public.booking_reminders_touch_updated_at();

alter table public.booking_reminders enable row level security;
