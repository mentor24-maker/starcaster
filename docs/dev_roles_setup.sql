-- /docs/dev_roles_setup.sql

CREATE TABLE IF NOT EXISTS public.dev_roles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id character varying NOT NULL DEFAULT current_setting('request.jwt.claims'::text, true)::json->>'project_id'::text,
  role_name character varying NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  
  CONSTRAINT dev_roles_pkey PRIMARY KEY (id),
  CONSTRAINT dev_roles_name_unique UNIQUE (project_id, role_name)
);

-- Enable RLS
ALTER TABLE public.dev_roles ENABLE ROW LEVEL SECURITY;

-- Create open access policies
DROP POLICY IF EXISTS "Allow all access on dev roles" ON public.dev_roles;

CREATE POLICY "Allow all access on dev roles" 
ON public.dev_roles 
FOR ALL 
TO public
USING (true) 
WITH CHECK (true);

-- Prepopulate the default roles for the alphire-promo project
INSERT INTO public.dev_roles (project_id, role_name, description)
VALUES 
  ('alphire-promo', 'Project Coordinator', 'Manages overall project scope, timelines, and communications.'),
  ('alphire-promo', 'Chief Architect', 'Oversees the technical design and system architecture.'),
  ('alphire-promo', 'Platform Stakeholder', 'Represents the business interests and product requirements.'),
  ('alphire-promo', 'UX Specialist', 'Designs the user experience and user interface layouts.'),
  ('alphire-promo', 'Content Developer', 'Writes and manages copy, messaging, and content strategies.')
ON CONFLICT (project_id, role_name) DO NOTHING;
