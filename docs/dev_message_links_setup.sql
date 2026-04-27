CREATE TABLE dev_message_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id BIGINT REFERENCES agent_messages(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('task', 'message')),
  target_id TEXT NOT NULL, -- UUID for tasks, BIGINT for messages
  created_at TIMESTAMPTZ DEFAULT NOW()
);
