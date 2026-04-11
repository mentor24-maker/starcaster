-- -----------------------------------------------------------------------------
-- roger_file_manager_setup.sql
-- Run this block inside your Supabase SQL Editor.
-- -----------------------------------------------------------------------------

DO $$ 
BEGIN

    -- 1. Create the persistent file registry table
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'roger_files') THEN
        CREATE TABLE public.roger_files (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_name TEXT NOT NULL,
            mime_type TEXT,
            size BIGINT,
            supabase_url TEXT,
            session_id UUID REFERENCES public.roger_sessions(id) ON DELETE SET NULL,
            chat_id UUID REFERENCES public.roger_chats(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    END IF;

    -- 2. Create the Storage Bucket securely 
    -- Note: Ensure Supabase Storage is active in your project
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('roger_drive', 'roger_drive', true)
    ON CONFLICT (id) DO NOTHING;

END $$;
