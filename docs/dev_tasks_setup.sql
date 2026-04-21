-- Schema for tracking multi-agent Project Management events and tasks
CREATE TABLE IF NOT EXISTS public.dev_tasks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    project_id BIGINT DEFAULT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo'::text,
    priority TEXT DEFAULT 'medium'::text,
    assignee TEXT DEFAULT 'mentor'::text,
    related_friction_log_id UUID DEFAULT NULL,
    
    CONSTRAINT dev_tasks_status_check CHECK (status = ANY (ARRAY['backlog'::text, 'todo'::text, 'in_progress'::text, 'review'::text, 'completed'::text])),
    CONSTRAINT dev_tasks_priority_check CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])),
    CONSTRAINT dev_tasks_assignee_check CHECK (assignee = ANY (ARRAY['mentor'::text, 'roger'::text, 'antigravity'::text]))
);

-- Enable RLS
ALTER TABLE public.dev_tasks ENABLE ROW LEVEL SECURITY;

-- Create basic access policies
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON public.dev_tasks;
CREATE POLICY "Enable read access for all authenticated users" ON public.dev_tasks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert access for all authenticated users" ON public.dev_tasks;
CREATE POLICY "Enable insert access for all authenticated users" ON public.dev_tasks FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update access for all authenticated users" ON public.dev_tasks;
CREATE POLICY "Enable update access for all authenticated users" ON public.dev_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable delete access for all authenticated users" ON public.dev_tasks;
CREATE POLICY "Enable delete access for all authenticated users" ON public.dev_tasks FOR DELETE TO authenticated USING (true);
