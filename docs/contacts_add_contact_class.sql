-- docs/contacts_add_contact_class.sql
-- Add the new architectural dimension isolating systemic roles from pipeline stages

ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS contact_class text DEFAULT 'persona';

CREATE INDEX IF NOT EXISTS idx_contacts_contact_class 
  ON public.contacts(contact_class);
