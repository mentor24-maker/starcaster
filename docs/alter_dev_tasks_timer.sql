-- Add estimated_completion_time and timer_active to dev_tasks

ALTER TABLE public.dev_tasks 
ADD COLUMN IF NOT EXISTS estimated_completion_time TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS timer_active BOOLEAN DEFAULT FALSE;
