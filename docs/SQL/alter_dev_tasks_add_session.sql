-- /docs/alter_dev_tasks_add_session.sql

-- Add a session_id column to link dev_tasks to dev_sessions
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'dev_tasks' 
          AND column_name = 'session_id'
    ) THEN
        ALTER TABLE public.dev_tasks 
        ADD COLUMN session_id BIGINT REFERENCES public.dev_sessions(id) ON DELETE SET NULL;
    END IF;
END $$;
