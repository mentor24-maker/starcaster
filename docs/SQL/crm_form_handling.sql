-- crm_form_handling.sql
-- FEATURE: website CRM forms can send visitors to a thank-you page, alert their own list of team addresses, email the visitor a confirmation, and keep every submission (including a returning visitor's second message) — without it, saving a form's new After submit / Team alerts / Confirmation email settings fails, and no submission is recorded.
-- RUN AFTER docs/SQL/crm_setup.sql
--
-- Loop Queue task 86bcwy44f. Two changes:
--
--   crm_forms.handling      one JSON object per form: afterSubmit ("message" or
--                           "redirect"), redirectUrl, redirectPageId,
--                           alertEmails, alertSubject, confirmationEnabled,
--                           confirmationSubject, confirmationBody.
--                           '{}' = today's behaviour exactly (show the message,
--                           alert the project's Contact Alert Email, send the
--                           visitor nothing).
--
--   crm_form_submissions    one row per submit, duplicates included. Before
--                           this, a known email's second submission was thrown
--                           away. Carries BOTH project_id and owner_user_id
--                           (CLAUDE.md landmine 12).
--
-- Safe to run more than once.

ALTER TABLE crm_forms
  ADD COLUMN IF NOT EXISTS handling JSONB NOT NULL DEFAULT '{}'::jsonb;

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
-- service key (memory: RLS lockdown, 2026-08-18).
ALTER TABLE public.crm_form_submissions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
