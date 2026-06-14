-- Contact-to-project invitation tokens.
-- Distinct from team_invitations (admin/editor roles).
-- These invite a contact to access a project as a participant.

CREATE TABLE IF NOT EXISTS contact_project_invitations (
  id                  TEXT        PRIMARY KEY,
  contact_id          TEXT        NOT NULL,
  project_id          TEXT        NOT NULL,
  email               TEXT        NOT NULL,
  token_hash          TEXT        NOT NULL UNIQUE,
  status              TEXT        NOT NULL DEFAULT 'pending',
  invited_by_user_id  TEXT        NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  accepted_by_email   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpi_contact   ON contact_project_invitations(contact_id);
CREATE INDEX IF NOT EXISTS idx_cpi_project   ON contact_project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_cpi_token     ON contact_project_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_cpi_status    ON contact_project_invitations(status);
