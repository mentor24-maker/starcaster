-- add_project_fk_constraints.sql
-- Adds foreign key constraints from project_id → app_projects(id)
-- for campaigns, assets, channels, and contacts.
--
-- These tables already have the project_id TEXT column (added in
-- projects_multitenancy_setup.sql / project_scope_remaining_setup.sql)
-- but they were added without a REFERENCES constraint. This migration
-- adds the FK so Supabase enforces referential integrity.
--
-- Safe to re-run: uses IF NOT EXISTS-style naming so Postgres will
-- skip if the constraint already exists (wrapped in DO blocks).

begin;

-- ────────────────────────────────────────────────────────────────────
-- Step 0: Clean orphaned project_id values that reference projects
-- which no longer exist (or were never created) in app_projects.
-- Without this, adding FK constraints will fail with 23503 violations.
-- ────────────────────────────────────────────────────────────────────
update public.campaigns   set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.assets      set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.channels    set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.contacts    set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);

-- ────────────────────────────────────────────────────────────────────
-- campaigns.project_id → app_projects(id)
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_campaigns_project_id'
      and table_schema = 'public'
      and table_name = 'campaigns'
  ) then
    alter table public.campaigns
      add constraint fk_campaigns_project_id
      foreign key (project_id)
      references public.app_projects(id)
      on delete set null;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- assets.project_id → app_projects(id)
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_assets_project_id'
      and table_schema = 'public'
      and table_name = 'assets'
  ) then
    alter table public.assets
      add constraint fk_assets_project_id
      foreign key (project_id)
      references public.app_projects(id)
      on delete set null;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- channels.project_id → app_projects(id)
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_channels_project_id'
      and table_schema = 'public'
      and table_name = 'channels'
  ) then
    alter table public.channels
      add constraint fk_channels_project_id
      foreign key (project_id)
      references public.app_projects(id)
      on delete set null;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- contacts.project_id → app_projects(id)
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_contacts_project_id'
      and table_schema = 'public'
      and table_name = 'contacts'
  ) then
    alter table public.contacts
      add constraint fk_contacts_project_id
      foreign key (project_id)
      references public.app_projects(id)
      on delete set null;
  end if;
end $$;

commit;
