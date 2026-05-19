-- --------------------------------------------------------------------------
-- Observe Usage Logs
-- Core high-throughput telemetry table recording granular consumption mapped 
-- strictly onto specific components to identify cost vectors natively.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observe_usage_logs (
    id bigint generated always as identity primary key,
    project_id text references app_projects(id) on delete cascade,
    user_id text,
    
    provider text not null,       -- e.g., 'vercel', 'openai', 'gemini', 'youtube', 'vertex_veo'
    usage_type text not null,     -- e.g., 'api_request', 'LLM_prompt_token', 'LLM_completion_token'
    usage_count float not null default 1,
    metadata jsonb default '{}'::jsonb,
    
    created_at timestamptz default now()
);

-- Protect against accidental updates/deletes over the ledger
ALTER TABLE observe_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only read and append usage logs connected to their scoped project ID" ON observe_usage_logs
    FOR ALL
    USING (
      auth.uid()::text = user_id OR
      EXISTS (
        SELECT 1 FROM app_project_memberships 
        WHERE app_project_memberships.project_id = observe_usage_logs.project_id 
        AND app_project_memberships.user_id = auth.uid()::text
      )
    );

-- Fast analytical grouping requires indexing
CREATE INDEX IF NOT EXISTS idx_observe_usage_logs_provider ON observe_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_observe_usage_logs_created_at ON observe_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_observe_usage_logs_project_id ON observe_usage_logs(project_id);
