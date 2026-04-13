-- 1. Rename the existing table to agent_messages (agnostic)
ALTER TABLE public.roger_chats RENAME TO agent_messages;

-- 2. Add State Machine explicitly
ALTER TABLE public.agent_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE public.agent_messages ADD COLUMN error_details TEXT;

-- NOTE FOR HUMAN OVERSEER: 
-- Because the table name changed from 'roger_chats' to 'agent_messages', 
-- you MUST delete your old Supabase Database Webhook trigger and create a new one 
-- targeting the 'agent_messages' table (for INSERT and UPDATE operations) to POST 
-- to your /api/develop/roger/worker endpoint!
