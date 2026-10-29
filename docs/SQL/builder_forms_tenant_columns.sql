-- Give builder_forms its tenant columns (task 86bcu8ftx).
--
-- project_scope_remaining_setup.sql meant to do this but names the table by
-- its old name, develop_forms, which builder_rename_migration.sql renamed to
-- builder_forms. Its `alter table if exists` lines skip silently and its
-- `create index … on public.develop_forms` fails, rolling the whole file back.
-- So production's builder_forms has never had project_id / owner_user_id, and
-- lib/projectScope.js — which stamps a tenant only when a table has BOTH
-- (CLAUDE.md landmine 12) — saves every new form with no project, after which
-- builderFormsStore.matchesScope hides it from the project that made it.
--
-- Additive and safe to run twice. The four forms already in the table (March
-- 2026) stay without a project; assigning them is a separate decision.

begin;

alter table if exists public.builder_forms
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

create index if not exists idx_builder_forms_project_id
  on public.builder_forms(project_id);

create index if not exists idx_builder_forms_owner_user_id
  on public.builder_forms(owner_user_id);

commit;
