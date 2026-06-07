-- contacts_drop_global_email_unique.sql
-- Required for multi-project contact memberships (same person / email on multiple projects).
--
-- The legacy index contacts_email_unique_idx enforces email globally on contacts.
-- With people + person_id, email is canonical on public.people; contacts rows are
-- per-project memberships.
--
-- Run in Supabase SQL Editor after people_contacts_architecture_setup.sql

begin;

-- Allow membership rows without duplicating email on contacts (resolved via people join).
alter table public.contacts
  alter column email drop not null;

-- Remove global unique on email (superseded by per-project uniqueness).
drop index if exists public.contacts_email_unique_idx;

-- Per-project email uniqueness (when email is stored on the membership row).
drop index if exists public.idx_contacts_project_email;
create unique index if not exists idx_contacts_project_email
  on public.contacts (project_id, email)
  where project_id is not null
    and email is not null
    and trim(email) <> '';

commit;
