-- Schema for tracking Human-In-The-Loop bottlenecks and manual friction events
CREATE TABLE IF NOT EXISTS public.roger_friction_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'open'::text,
    resolution_notes TEXT,
    CONSTRAINT roger_friction_logs_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'documented'::text]))
);

-- Enable RLS
ALTER TABLE public.roger_friction_logs ENABLE ROW LEVEL SECURITY;

-- Create basic access policies
CREATE POLICY "Enable read access for all authenticated users"
    ON public.roger_friction_logs FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for all authenticated users"
    ON public.roger_friction_logs FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for all authenticated users"
    ON public.roger_friction_logs FOR UPDATE
    USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for all authenticated users"
    ON public.roger_friction_logs FOR DELETE
    USING (auth.role() = 'authenticated');
