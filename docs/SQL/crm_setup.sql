-- CRM Module: per-project field schema + captured contacts + lead-capture forms
-- Run once per environment. All tables are project-scoped.

-- crm_configs: defines which fields a project's CRM captures
CREATE TABLE IF NOT EXISTS crm_configs (
  id                TEXT        PRIMARY KEY,
  project_id        TEXT        NOT NULL,
  owner_user_id     TEXT,
  name              TEXT        NOT NULL DEFAULT 'CRM',
  status            TEXT        NOT NULL DEFAULT 'active',
  standard_fields   JSONB       NOT NULL DEFAULT '["email","first_name","last_name","phone"]'::jsonb,
  custom_fields     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_configs_project_id ON crm_configs(project_id);

-- crm_contacts: contacts captured against a CRM config
CREATE TABLE IF NOT EXISTS crm_contacts (
  id                TEXT        PRIMARY KEY,
  crm_config_id     TEXT        NOT NULL,
  project_id        TEXT        NOT NULL,
  owner_user_id     TEXT,
  email             TEXT,
  data              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source            TEXT        DEFAULT '',
  tags              TEXT[]      DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_crm_config_id ON crm_contacts(crm_config_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_project_id    ON crm_contacts(project_id);
-- Prevent duplicate emails within the same CRM config
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contacts_email_per_config
  ON crm_contacts(crm_config_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- crm_forms: lead-capture forms linked to a CRM config
CREATE TABLE IF NOT EXISTS crm_forms (
  id                TEXT        PRIMARY KEY,
  crm_config_id     TEXT        NOT NULL,
  project_id        TEXT        NOT NULL,
  owner_user_id     TEXT,
  name              TEXT        NOT NULL DEFAULT '',
  heading           TEXT        DEFAULT '',
  submit_label      TEXT        DEFAULT 'Submit',
  success_message   TEXT        DEFAULT 'Thank you! Your information has been saved.',
  error_message     TEXT        DEFAULT 'Something went wrong. Please try again.',
  accent_color      TEXT        DEFAULT '',
  styles            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fields            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_forms_crm_config_id ON crm_forms(crm_config_id);
CREATE INDEX IF NOT EXISTS idx_crm_forms_project_id    ON crm_forms(project_id);
