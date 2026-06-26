-- CRM forms: style settings JSON (heading/button/field layout)
-- Apply manually per environment after crm_setup.sql.

ALTER TABLE crm_forms
  ADD COLUMN IF NOT EXISTS styles JSONB NOT NULL DEFAULT '{}'::jsonb;
