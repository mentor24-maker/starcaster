-- Per-project settings edited from a tenant's own admin area (the Settings
-- page on e.g. brandonmarinoff.com/admin-settings).
--
-- Same pattern as enabled_modules (docs/SQL/project_admin_modules.sql): a jsonb
-- blob on app_projects, so adding the second and third setting needs no further
-- migration. Read/written only through lib/projectSiteSettingsStore.js, which
-- whitelists the keys it will persist.
--
-- Keys in use:
--   contactAlertEmail  text  internal address notified when a public CRM form
--                            is submitted; blank turns alerts off.

ALTER TABLE public.app_projects
  ADD COLUMN IF NOT EXISTS site_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
