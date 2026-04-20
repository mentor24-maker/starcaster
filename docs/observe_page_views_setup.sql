-- =============================================================================
-- Migration: Observe Page Views Ledger
-- Tracks active viewport jumps matching session dynamics for analytics.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.observe_page_views (
    id bigint generated always as identity primary key,
    project_id text references public.app_projects(id) on delete cascade,
    user_id text,
    page_id text not null,
    created_at timestamptz default now()
);

ALTER TABLE public.observe_page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert page views for their project." ON public.observe_page_views
    FOR INSERT
    WITH CHECK (
      auth.uid()::text = user_id OR
      EXISTS (
        SELECT 1 FROM public.app_project_memberships 
        WHERE app_project_memberships.project_id = observe_page_views.project_id 
        AND app_project_memberships.user_id = auth.uid()::text
      )
    );

CREATE POLICY "Users can read page views for their project." ON public.observe_page_views
    FOR SELECT
    USING (
      auth.uid()::text = user_id OR
      EXISTS (
        SELECT 1 FROM public.app_project_memberships 
        WHERE app_project_memberships.project_id = observe_page_views.project_id 
        AND app_project_memberships.user_id = auth.uid()::text
      )
    );

CREATE INDEX IF NOT EXISTS idx_observe_page_views_project_id ON public.observe_page_views(project_id);
CREATE INDEX IF NOT EXISTS idx_observe_page_views_created_at ON public.observe_page_views(created_at);
