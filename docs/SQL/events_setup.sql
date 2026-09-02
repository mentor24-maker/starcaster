-- Event Calendar: the events table.
-- Project-scoped (multi-tenant). Run once per environment. Idempotent.
--
-- One row per event. This is the table the `event-manager` admin module
-- writes and the public calendar / event-detail modules (next tickets) read.
--
-- Both tenant columns are here on purpose (CLAUDE.md landmine 12): a table
-- carrying only project_id fails lib/projectScope.js's probe and rows land
-- with no tenant at all.

create table if not exists public.events (
  id                  text        primary key,
  project_id          text        not null,
  owner_user_id       text,

  -- what
  title               text        not null default '',
  slug                text        not null default '',
  status              text        not null default 'draft',   -- draft | published | cancelled
  description         text        not null default '',        -- rich HTML
  excerpt             text        not null default '',        -- short summary for cards / list views
  image_url           text        not null default '',
  image_alt           text        not null default '',
  url                 text        not null default '',        -- tickets, registration, external page
  featured            boolean     not null default false,

  -- when
  starts_at           timestamptz,
  ends_at             timestamptz,
  all_day             boolean     not null default false,
  timezone            text        not null default '',        -- IANA name, e.g. America/Denver

  -- where
  location_name       text        not null default '',
  location_address    text        not null default '',
  location_url        text        not null default '',        -- map link

  -- who
  organizer_name      text        not null default '',
  organizer_contact   text        not null default '',        -- email or phone

  -- SEO
  seo_title           text        not null default '',
  seo_description     text        not null default '',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_events_project_id
  on public.events (project_id);

create index if not exists idx_events_status_project
  on public.events (project_id, status);

-- primary sort for calendar queries
create index if not exists idx_events_starts_at
  on public.events (project_id, starts_at);

-- slugs must be unique within a project (skip empty slugs during backfills)
create unique index if not exists idx_events_slug_project
  on public.events (project_id, slug)
  where slug <> '';

create or replace function public.set_events_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.set_events_updated_at();

-- RLS on with no policies, matching the 2026-08-17 lockdown: the service key
-- used by the app bypasses RLS; anon/authenticated roles see nothing.
alter table public.events enable row level security;
