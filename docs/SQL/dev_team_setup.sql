-- /docs/dev_team_setup.sql

CREATE TABLE IF NOT EXISTS public.dev_team (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id character varying NOT NULL DEFAULT current_setting('request.jwt.claims'::text, true)::json->>'project_id'::text,
  contact_id character varying NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role character varying NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  
  CONSTRAINT dev_team_pkey PRIMARY KEY (id),
  CONSTRAINT dev_team_contact_unique UNIQUE (project_id, contact_id)
);

-- Enable RLS
ALTER TABLE public.dev_team ENABLE ROW LEVEL SECURITY;

-- Create basic access policies
DROP POLICY IF EXISTS "Users can view dev team for their project" ON public.dev_team;
DROP POLICY IF EXISTS "Users can insert dev team for their project" ON public.dev_team;
DROP POLICY IF EXISTS "Users can update dev team for their project" ON public.dev_team;
DROP POLICY IF EXISTS "Users can delete dev team for their project" ON public.dev_team;
DROP POLICY IF EXISTS "Allow all access on dev team" ON public.dev_team;

CREATE POLICY "Allow all access on dev team" 
ON public.dev_team 
FOR ALL 
TO public
USING (true) 
WITH CHECK (true);
