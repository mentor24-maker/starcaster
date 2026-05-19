-- -----------------------------------------------------------------------------
-- dev_file_attachments_setup.sql
-- Table generation script to add multimodality columns
-- Run this block inside your Supabase SQL Editor.
-- -----------------------------------------------------------------------------

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'dev_chats' 
          AND column_name = 'attachment_url'
    ) THEN
        ALTER TABLE public.dev_chats 
        ADD COLUMN attachment_url TEXT DEFAULT NULL,
        ADD COLUMN attachment_mime TEXT DEFAULT NULL,
        ADD COLUMN attachment_name TEXT DEFAULT NULL;
    END IF;
END $$;
