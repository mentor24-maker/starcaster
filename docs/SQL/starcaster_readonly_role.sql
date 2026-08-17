-- ---------------------------------------------------------------------------
-- starcaster_readonly — the production login `npm run db:refresh` reads from.
-- 2026-08-16
--
-- WHAT THIS IS FOR
-- Local development needs a copy of production to be useful. This creates a
-- login that can read everything and change nothing, so copying production
-- down cannot damage it — not through a bug in the refresh script, and not
-- through an agent running that script.
--
-- SAFE TO RUN AGAIN. Every statement is idempotent: it creates what is
-- missing, leaves what exists, and changes nothing about your data. Re-run it
-- after adding tables so the new ones are covered.
--
-- WHAT IT TOUCHES: nothing that exists. It adds one login and grants it the
-- right to read. It creates no tables, alters no columns, and moves no rows.
--
-- Parts 1 and 2 were applied by hand on 2026-08-16 before this file existed;
-- they are recorded here so the repo states what production actually has.
-- Part 3 is the new one.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. The login
-- ===========================================================================
-- The password is deliberately NOT in this file, and must never be added to
-- it. Set it separately — see docs/LOCAL_DEVELOPMENT.md.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'starcaster_readonly') then
    create role starcaster_readonly with login password 'CHANGE-ME-IMMEDIATELY';
    raise notice 'Created starcaster_readonly. Set its password now.';
  else
    raise notice 'starcaster_readonly already exists — left alone.';
  end if;
end $$;


-- ===========================================================================
-- 2. Permission to read
-- ===========================================================================

grant connect on database postgres to starcaster_readonly;
grant usage   on schema public    to starcaster_readonly;

grant select on all tables    in schema public to starcaster_readonly;

-- Sequences too: pg_dump reads each sequence's current value so that ID
-- numbering survives the copy. SELECT is a read. Writing to a sequence needs
-- USAGE or UPDATE, which are deliberately not granted here.
grant select on all sequences in schema public to starcaster_readonly;

-- Cover tables and sequences added later, so this never needs running twice
-- for the same reason.
alter default privileges in schema public grant select on tables    to starcaster_readonly;
alter default privileges in schema public grant select on sequences to starcaster_readonly;


-- ===========================================================================
-- 3. Permission to see the ROWS  ← the new part
-- ===========================================================================
-- 71 tables have row-level security switched on. Under that, being granted
-- SELECT is not enough: without a policy naming it, a role sees an empty
-- table rather than an error.
--
-- That is worse than a failure, because it looks like success — a copy of
-- production that silently contained nothing. pg_dump is stricter than that
-- and refuses to dump a table it might be seeing only part of, which is how
-- this surfaced at all.
--
-- So: one SELECT-only policy per table, naming only this role. It grants
-- sight of rows and nothing else — no insert, update or delete — and it
-- cannot affect any other role, because a policy applies only to the roles
-- it names.
--
-- Not done with BYPASSRLS, which would be one line, because setting that
-- needs superuser and the Supabase dashboard does not run as one. This works
-- with the privileges you actually have.

do $$
declare
  target record;
begin
  for target in
    select c.relname as table_name
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and c.relrowsecurity
     order by c.relname
  loop
    execute format('drop policy if exists %I on public.%I', 'starcaster_readonly_select', target.table_name);
    execute format(
      'create policy %I on public.%I for select to starcaster_readonly using (true)',
      'starcaster_readonly_select', target.table_name
    );
  end loop;
end $$;


-- ===========================================================================
-- 4. Check it — read these three answers
-- ===========================================================================
--   1. can_log_in true, everything else false
--   2. exactly one row, saying SELECT
--   3. policies should equal the number of tables with row security on

select rolname,
       rolcanlogin   as can_log_in,
       rolsuper      as is_superuser,
       rolcreatedb   as can_create_databases,
       rolcreaterole as can_create_logins,
       rolbypassrls  as bypasses_row_security
from   pg_roles
where  rolname = 'starcaster_readonly';

select privilege_type, count(*) as tables
from   information_schema.role_table_grants
where  grantee = 'starcaster_readonly'
group  by privilege_type
order  by privilege_type;

select (select count(*) from pg_policies
         where schemaname = 'public' and policyname = 'starcaster_readonly_select') as policies_created,
       (select count(*) from pg_class
         where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity) as tables_with_row_security;
