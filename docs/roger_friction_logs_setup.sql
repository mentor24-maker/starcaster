-- Schema for tracking Human-In-The-Loop bottlenecks and manual friction events
CREATE TABLE IF NOT EXISTS public.roger_friction_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    project_id BIGINT DEFAULT NULL,
    title TEXT DEFAULT 'New Friction Log' NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'open'::text,
    resolution_notes TEXT,
    CONSTRAINT roger_friction_logs_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'documented'::text]))
);

-- Migration for existing environments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='roger_friction_logs' AND column_name='title') THEN
    ALTER TABLE public.roger_friction_logs ADD COLUMN title TEXT DEFAULT 'New Friction Log' NOT NULL;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.roger_friction_logs ENABLE ROW LEVEL SECURITY;

-- Create basic access policies
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON public.roger_friction_logs;
DROP POLICY IF EXISTS "Enable insert access for all authenticated users" ON public.roger_friction_logs;
DROP POLICY IF EXISTS "Enable update access for all authenticated users" ON public.roger_friction_logs;
DROP POLICY IF EXISTS "Enable delete access for all authenticated users" ON public.roger_friction_logs;
DROP POLICY IF EXISTS "Allow all access on friction logs" ON public.roger_friction_logs;

CREATE POLICY "Allow all access on friction logs" 
ON public.roger_friction_logs 
FOR ALL 
TO public
USING (true) 
WITH CHECK (true);
