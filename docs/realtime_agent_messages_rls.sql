-- docs/realtime_agent_messages_rls.sql
-- Fixes silent Supabase Realtime WebSocket drops by granting SELECT permissions 
-- to the frontend anon key, bypassing RLS blockades.

begin;

  -- Ensure RLS is active (best practice)
  alter table if exists public.agent_messages enable row level security;

  -- Drop policy if it already exists to avoid errors on reapplying
  drop policy if exists "Allow public read access to agent_messages for realtime" on public.agent_messages;

  -- Create a generous policy allowing the frontend to receive WebSocket broadcasts 
  create policy "Allow public read access to agent_messages for realtime" 
    on public.agent_messages 
    for select 
    to public 
    using (true);

commit;
