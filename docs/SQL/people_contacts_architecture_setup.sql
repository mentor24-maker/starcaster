-- people_contacts_architecture_setup.sql
-- Global people identities + project-scoped contact memberships (contacts rows).
--
-- Depends on: projects_multitenancy_setup.sql, contacts table
-- Optional: team_invitations_setup.sql (auth_user_id on contacts); this script adds missing columns.
-- Apply in Supabase SQL Editor, then record in docs/Markdown Files/MIGRATIONS_APPLIED.md
--
-- After apply: one email → one people row; each project links via contacts.person_id.
-- Unique per project: (project_id, person_id). Legacy (project_id, email) index may remain.

begin;

-- ---------------------------------------------------------------------------
-- Global person (canonical profile)
-- ---------------------------------------------------------------------------
create table if not exists public.people (
  id              text        not null primary key,
  email           text        null,
  first_name      text        not null default '',
  middle_name     text        not null default '',
  last_name       text        not null default '',
  company         text        not null default '',
  phone           text        not null default '',
  city            text        not null default '',
  country         text        not null default '',
  entity_type     text        not null default 'Human',
  auth_user_id    text        null,
  website         text        not null default '',
  youtube         text        not null default '',
  instagram       text        not null default '',
  tiktok          text        not null default '',
  facebook        text        not null default '',
  x               text        not null default '',
  bluesky         text        not null default '',
  patreon         text        not null default '',
  linkedin        text        not null default '',
  custom_fields   jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists idx_people_email_lower
  on public.people (lower(email))
  where email is not null and trim(email) <> '';

create index if not exists idx_people_auth_user_id
  on public.people (auth_user_id);

-- ---------------------------------------------------------------------------
-- Link memberships → people
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists person_id text null references public.people(id) on delete restrict;

create index if not exists idx_contacts_person_id
  on public.contacts (person_id);

-- Ensure contacts has columns referenced by the backfill (safe if already applied).
alter table public.contacts add column if not exists auth_user_id text null;
alter table public.contacts add column if not exists middle_name text null default '';
alter table public.contacts add column if not exists entity_type text null default 'Human';
alter table public.contacts add column if not exists company text null default '';
alter table public.contacts add column if not exists phone text null default '';
alter table public.contacts add column if not exists city text null default '';
alter table public.contacts add column if not exists country text null default '';
alter table public.contacts add column if not exists website text null default '';
alter table public.contacts add column if not exists youtube text null default '';
alter table public.contacts add column if not exists instagram text null default '';
alter table public.contacts add column if not exists tiktok text null default '';
alter table public.contacts add column if not exists facebook text null default '';
alter table public.contacts add column if not exists x text null default '';
alter table public.contacts add column if not exists bluesky text null default '';
alter table public.contacts add column if not exists patreon text null default '';
alter table public.contacts add column if not exists linkedin text null default '';
alter table public.contacts add column if not exists custom_fields jsonb null default '{}'::jsonb;
alter table public.contacts add column if not exists updated_at timestamptz null default now();

-- Optional FK on people.auth_user_id when app_auth_users exists
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'app_auth_users'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'people'
      and constraint_name = 'people_auth_user_id_fkey'
  ) then
    alter table public.people
      add constraint people_auth_user_id_fkey
      foreign key (auth_user_id)
      references public.app_auth_users(id)
      on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill people from existing contacts
-- ---------------------------------------------------------------------------

-- 1) One person per distinct non-empty email (earliest contact row wins field values)
insert into public.people (
  id,
  email,
  first_name,
  middle_name,
  last_name,
  company,
  phone,
  city,
  country,
  entity_type,
  auth_user_id,
  website,
  youtube,
  instagram,
  tiktok,
  facebook,
  x,
  bluesky,
  patreon,
  linkedin,
  custom_fields,
  created_at,
  updated_at
)
select
  'person_' || substr(md5(lower(trim(c.email))), 1, 24),
  lower(trim(c.email)),
  coalesce(c.first_name, ''),
  coalesce(c.middle_name, ''),
  coalesce(c.last_name, ''),
  coalesce(c.company, ''),
  coalesce(c.phone, ''),
  coalesce(c.city, ''),
  coalesce(c.country, ''),
  coalesce(nullif(trim(c.entity_type), ''), 'Human'),
  c.auth_user_id,
  coalesce(c.website, ''),
  coalesce(c.youtube, ''),
  coalesce(c.instagram, ''),
  coalesce(c.tiktok, ''),
  coalesce(c.facebook, ''),
  coalesce(c.x, ''),
  coalesce(c.bluesky, ''),
  coalesce(c.patreon, ''),
  coalesce(c.linkedin, ''),
  coalesce(c.custom_fields, '{}'::jsonb),
  coalesce(c.created_at, now()),
  coalesce(c.updated_at, now())
from (
  select distinct on (lower(trim(email)))
    *
  from public.contacts
  where email is not null and trim(email) <> ''
  order by lower(trim(email)), created_at asc nulls last, id asc
) c
on conflict (id) do nothing;

update public.contacts c
set person_id = p.id
from public.people p
where c.person_id is null
  and c.email is not null
  and trim(c.email) <> ''
  and lower(trim(c.email)) = lower(trim(p.email));

-- 2) Contacts without email: one synthetic person per membership row
insert into public.people (
  id,
  email,
  first_name,
  middle_name,
  last_name,
  company,
  phone,
  city,
  country,
  entity_type,
  auth_user_id,
  website,
  youtube,
  instagram,
  tiktok,
  facebook,
  x,
  bluesky,
  patreon,
  linkedin,
  custom_fields,
  created_at,
  updated_at
)
select
  'person_for_' || c.id,
  null,
  coalesce(c.first_name, ''),
  coalesce(c.middle_name, ''),
  coalesce(c.last_name, ''),
  coalesce(c.company, ''),
  coalesce(c.phone, ''),
  coalesce(c.city, ''),
  coalesce(c.country, ''),
  coalesce(nullif(trim(c.entity_type), ''), 'Human'),
  c.auth_user_id,
  coalesce(c.website, ''),
  coalesce(c.youtube, ''),
  coalesce(c.instagram, ''),
  coalesce(c.tiktok, ''),
  coalesce(c.facebook, ''),
  coalesce(c.x, ''),
  coalesce(c.bluesky, ''),
  coalesce(c.patreon, ''),
  coalesce(c.linkedin, ''),
  coalesce(c.custom_fields, '{}'::jsonb),
  coalesce(c.created_at, now()),
  coalesce(c.updated_at, now())
from public.contacts c
where c.person_id is null
on conflict (id) do nothing;

update public.contacts c
set person_id = 'person_for_' || c.id
where c.person_id is null;

-- Prefer auth_user_id on people when copied from any linked contact
update public.people p
set auth_user_id = src.auth_user_id
from (
  select distinct on (person_id) person_id, auth_user_id
  from public.contacts
  where person_id is not null and auth_user_id is not null
  order by person_id, updated_at desc nulls last
) src
where p.id = src.person_id
  and p.auth_user_id is null
  and src.auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- Membership uniqueness: one contact row per person per project
-- ---------------------------------------------------------------------------
create unique index if not exists idx_contacts_project_person
  on public.contacts (project_id, person_id)
  where person_id is not null and project_id is not null;

-- Multi-project memberships: drop global email unique; email canonical on people.
alter table public.contacts
  alter column email drop not null;

drop index if exists public.contacts_email_unique_idx;

drop index if exists public.idx_contacts_project_email;
create unique index if not exists idx_contacts_project_email
  on public.contacts (project_id, email)
  where project_id is not null
    and email is not null
    and trim(email) <> '';

alter table public.people enable row level security;
drop policy if exists "Allow all access on people" on public.people;
create policy "Allow all access on people"
  on public.people for all to public using (true) with check (true);

commit;
