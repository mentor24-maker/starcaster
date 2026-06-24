-- Add enabled_modules column to app_projects.
-- Stores a JSON object of module group toggles for the project.
-- Defaults to all standard modules enabled; gated modules default to false.

ALTER TABLE public.app_projects
  ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '{"crm": true}'::jsonb;
