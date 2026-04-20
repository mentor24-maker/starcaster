-- docs/realtime_agent_messages_setup.sql
-- Enables Supabase Realtime synchronization for the agent_messages table
-- Needed so the client websocket can pick up when AI inference is complete

begin;
  -- Remove the table from the publication if it already exists to avoid errors, then add it
  alter publication supabase_realtime add table agent_messages;
commit;
