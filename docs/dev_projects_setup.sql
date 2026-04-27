-- /docs/dev_projects_setup.sql

CREATE TABLE IF NOT EXISTS public.dev_projects (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    app_project_id VARCHAR NOT NULL DEFAULT current_setting('request.jwt.claims'::text, true)::json->>'project_id'::text,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active'::text,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    CONSTRAINT dev_projects_status_check CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text]))
);

CREATE TABLE IF NOT EXISTS public.dev_project_members (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    dev_project_id UUID NOT NULL REFERENCES public.dev_projects(id) ON DELETE CASCADE,
    contact_id VARCHAR NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member'::text,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    CONSTRAINT dev_project_members_unique UNIQUE (dev_project_id, contact_id)
);

-- Enable RLS
ALTER TABLE public.dev_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_project_members ENABLE ROW LEVEL SECURITY;

-- Create basic access policies
DROP POLICY IF EXISTS "Allow all access on dev projects" ON public.dev_projects;
CREATE POLICY "Allow all access on dev projects" 
ON public.dev_projects 
FOR ALL 
TO public
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access on dev project members" ON public.dev_project_members;
CREATE POLICY "Allow all access on dev project members" 
ON public.dev_project_members 
FOR ALL 
TO public
USING (true) 
WITH CHECK (true);
