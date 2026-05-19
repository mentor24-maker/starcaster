-- /docs/contacts_add_middle_name.sql
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS middle_name text;
