-- -----------------------------------------------------------------------------
-- fix_dev_sessions_project_id_type.sql
--
-- WHY
-- Every project_id on this platform is TEXT ("proj_1780601126203_f3v0m1"), but
-- dev_sessions_setup.sql declared dev_sessions.project_id as BIGINT. Postgres
-- therefore refuses any query that filters it by a real project id:
--
--     invalid input syntax for type bigint: "proj_1780601126203_f3v0m1"
--
-- Two things are broken by that, and both fail loudly rather than quietly:
--
--   1. DELETING ANY PROJECT. lib/projectDeleteStore.js purges every
--      project-scoped table, dev_sessions among them, so the whole delete
--      aborts on this one table. Reported by the operator 2026-08-16 trying to
--      delete "Delray Beach Tennis Club".
--   2. SCOPING ASK ROGER SESSIONS TO A PROJECT. lib/rogerChatsStore.js
--      filters on project_id whenever one is passed, so only the
--      "no project" path has ever worked.
--
-- SAFETY
-- All 31 rows have project_id = NULL (checked 2026-08-16), so nothing is
-- converted and nothing can be lost. The USING clause is still spelled out so
-- the statement stays correct if a value appears before it is run.
--
-- Run this in the Supabase SQL editor, then log it in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.
-- -----------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.dev_sessions
    ALTER COLUMN project_id TYPE TEXT USING project_id::TEXT;

ALTER TABLE public.dev_sessions
    ALTER COLUMN project_id SET DEFAULT NULL;

COMMIT;

-- Verify: expect data_type = 'text'.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'dev_sessions'
  AND column_name = 'project_id';
