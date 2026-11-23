-- FEATURE: the booking calendar has nowhere to keep a project's opening hours or the meetings visitors book, so the Booking Manager and the booking module cannot work
--
-- booking_setup.sql
-- Booking calendar, slice 1 of 6 (SC-909).
--
--   booking_calendars  one row per calendar: its time zone, weekly opening
--                      hours, days off, meeting length, gap between meetings,
--                      minimum notice, how far ahead visitors may book, and the
--                      text visitors read
--   bookings           one row per booked meeting: when (in UTC), who, and the
--                      CRM contact the booking was filed under
--
-- The stores are lib/bookingStore.js (rows) and lib/bookingAvailability.js
-- (which times are free). Nothing on a live site reads these tables yet.
--
-- BOTH tenant columns on every table (CLAUDE.md landmine 12). lib/projectScope.js
-- decides whether to stamp a tenant by probing for project_id AND owner_user_id
-- together; with only one, scopedInsertRow silently stamps neither.
--
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key, which bypasses it.
--
-- Idempotent: every statement is `if not exists` or is itself a no-op when
-- already true, so running the whole file twice changes nothing.

-- ── booking_calendars ───────────────────────────────────────────────────────

create table if not exists public.booking_calendars (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text not null,
  owner_user_id         text,
  name                  text not null,
  -- An IANA zone ("America/Denver"). Opening hours are read in this zone.
  time_zone             text not null default 'America/Denver',
  -- { "mon": [{ "start": "09:00", "end": "17:00" }], ..., "sun": [] }
  -- An empty list is a day off.
  weekly_hours          jsonb not null default '{}'::jsonb,
  -- ["2026-12-25", ...] — whole days with no bookings, in the calendar's zone.
  blocked_dates         jsonb not null default '[]'::jsonb,
  meeting_minutes       integer not null default 30,
  gap_minutes           integer not null default 0,
  min_notice_minutes    integer not null default 240,
  days_ahead            integer not null default 60,
  -- { "heading": "...", "intro": "...", "confirmation": "..." }
  messaging             jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_booking_calendars_project
  on public.booking_calendars (project_id);

create or replace function public.booking_calendars_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_calendars_touch_updated_at on public.booking_calendars;
create trigger booking_calendars_touch_updated_at
  before update on public.booking_calendars
  for each row execute function public.booking_calendars_touch_updated_at();

alter table public.booking_calendars enable row level security;

-- ── bookings ────────────────────────────────────────────────────────────────

create table if not exists public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text not null,
  owner_user_id         text,
  calendar_id           uuid not null references public.booking_calendars (id) on delete cascade,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  visitor_name          text not null,
  visitor_email         text not null,
  visitor_phone         text,
  visitor_note          text,
  -- The project CRM contact this booking was filed under (crm_contacts.id).
  crm_contact_id        text,
  status                text not null default 'booked'
                        check (status in ('booked', 'cancelled')),
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- No double booking: one live meeting per start time per calendar. A
-- cancelled booking frees its time.
create unique index if not exists idx_bookings_calendar_start_booked
  on public.bookings (calendar_id, starts_at) where status = 'booked';

create index if not exists idx_bookings_project_calendar_start
  on public.bookings (project_id, calendar_id, starts_at);

create or replace function public.bookings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.bookings_touch_updated_at();

alter table public.bookings enable row level security;
