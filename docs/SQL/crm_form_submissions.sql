-- crm_form_submissions.sql
-- FEATURE: every website form submission is kept — a returning visitor's second message included — and CRM › Forms can show each form's submissions; without it, the Forms list says submissions "could not be counted" and nothing past the first message from an email address is kept.
-- RUN AFTER docs/SQL/crm_setup.sql
--
-- Loop Queue task 86bcx1858. One row per submit, duplicates included. Before
-- this, a known email's second submission was thrown away — only the alert
-- email ever saw it. Carries BOTH project_id and owner_user_id (CLAUDE.md
-- landmine 12).
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS crm_form_submissions (
  id                TEXT        PRIMARY KEY,
  project_id        TEXT        NOT NULL,
  owner_user_id     TEXT        NOT NULL DEFAULT '',
  crm_form_id       TEXT        NOT NULL,
  crm_contact_id    TEXT,
  email             TEXT,
  data              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  page_url          TEXT        NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_form
  ON crm_form_submissions(project_id, crm_form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_contact
  ON crm_form_submissions(crm_contact_id);

-- Every table has RLS on with no policies; the server reaches it with the
-- service key (RLS lockdown, 2026-08-18).
ALTER TABLE public.crm_form_submissions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
