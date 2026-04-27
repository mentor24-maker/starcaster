-- Execute this in the Supabase SQL Editor to fix the Task Assignee error

-- Drop the restrictive check constraint that prevents dynamic team members from being assigned
ALTER TABLE public.dev_tasks 
  DROP CONSTRAINT IF EXISTS dev_tasks_assignee_check;
