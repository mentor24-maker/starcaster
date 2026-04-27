-- Execute this in the Supabase SQL Editor to fix the project_id datatype error

ALTER TABLE public.dev_tasks 
  ALTER COLUMN project_id TYPE UUID 
  USING project_id::text::uuid;

-- Add the foreign key constraint to link it properly to dev_projects if it's missing
ALTER TABLE public.dev_tasks
  DROP CONSTRAINT IF EXISTS dev_tasks_project_id_fkey,
  ADD CONSTRAINT dev_tasks_project_id_fkey 
  FOREIGN KEY (project_id) 
  REFERENCES public.dev_projects(id) 
  ON DELETE SET NULL;
