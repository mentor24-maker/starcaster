-- Events: repeating programs, instructors and venue categories.
--
-- One file for the whole event-recurrence epic (tickets 86bbzt259, 86bbzt25g,
-- 86bbzt25j), so it is applied once. Written for Delray Beach Tennis's weekly
-- program guide: "Drills & Games I — Wayne L — Mon–Sat 8:30–10:00am",
-- colour-coded by venue.
--
-- Additive only. Four new columns with defaults on `events`, one new table.
-- No existing row is rewritten: every existing event reads back as a
-- non-repeating event with no instructor and no category, which is exactly
-- what it is. Idempotent — `if not exists` throughout.

-- A weekly rule, or null for a one-off event:
--   { "freq": "weekly", "interval": 1, "weekdays": [1,3], "until": "2026-12-19" }
-- The first date and the time of day come from starts_at / ends_at, read in
-- the event's own `timezone`.
alter table public.events add column if not exists recurrence jsonb;

-- Single dates that differ from the rule, keyed by local date:
--   [ { "date": "2026-09-14", "cancelled": true },
--     { "date": "2026-09-16", "startTime": "09:00", "endTime": "10:00", "instructor": "Danny Z" } ]
alter table public.events add column if not exists recurrence_overrides jsonb not null default '[]'::jsonb;

alter table public.events add column if not exists instructor text not null default '';

-- '' = no category. Not a foreign key: deleting a category must leave its
-- events standing, and the store reads an unknown id as "no category".
alter table public.events add column if not exists category_id text not null default '';

-- Venues / program categories, with the colour the calendar paints them.
create table if not exists public.event_categories (
  id            text        primary key,
  project_id    text        not null,
  owner_user_id text,
  name          text        not null default '',
  color         text        not null default '',
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_event_categories_project
  on public.event_categories (project_id, sort_order);

create or replace function public.set_event_categories_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_event_categories_updated_at on public.event_categories;
create trigger trg_event_categories_updated_at
  before update on public.event_categories
  for each row execute function public.set_event_categories_updated_at();

-- RLS on with no policies, matching the 2026-08-17 lockdown.
alter table public.event_categories enable row level security;
