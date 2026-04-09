-- docs/contacts_options_management_setup.sql
-- Setup script for Contacts Settings: Option Management
-- Run this script in your Supabase SQL editor to create the reference tables for Status and Source.

CREATE TABLE IF NOT EXISTS public.contact_statuses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Note: To respect the multi-tenant project_id layout if applicable, you may need project_id.
-- However, since contact_types doesn't have project_id, these are global reference tables.

-- Default seeds for Statuses
INSERT INTO public.contact_statuses (key, label, sort_order) VALUES
  ('new', 'New', 0),
  ('contacted', 'Contacted', 1),
  ('qualified', 'Qualified', 2),
  ('lost', 'Lost', 3)
ON CONFLICT (key) DO NOTHING;

-- Default seeds for Sources
INSERT INTO public.contact_sources (key, label, sort_order) VALUES
  ('manual', 'Manual', 0),
  ('website', 'Website', 1),
  ('import', 'Import', 2),
  ('youtube_miner', 'YouTube Miner', 3)
ON CONFLICT (key) DO NOTHING;

-- UPDATE LEGACY CONTACT TYPES TABLE
-- Ensure the existing contact_types table is compatible with the Reference Options structural requirements
ALTER TABLE public.contact_types ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.contact_types ADD COLUMN IF NOT EXISTS "key" text;
ALTER TABLE public.contact_types ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE public.contact_types ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.contact_types ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Optional: If you had a previous column with names, you can uncomment and adjust these to backfill:
-- UPDATE public.contact_types SET label = your_old_column WHERE label IS NULL;
-- UPDATE public.contact_types SET key = lower(regexp_replace(your_old_column, '\s+', '_', 'g')) WHERE key IS NULL;
