-- -----------------------------------------------------------------------------
-- assets_video_curation_setup.sql
-- Table generation script for the Video Curation & Feedback Tool
-- Run this inside your Supabase SQL Editor.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assets_video_curation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id TEXT NOT NULL,
    video_url TEXT NOT NULL,
    title TEXT,
    thumbnail_url TEXT,
    topic TEXT,
    tags TEXT,
    score INTEGER DEFAULT 0,
    positive_feedback TEXT,
    negative_feedback TEXT,
    visuals_liked JSONB DEFAULT '[]'::jsonb,
    specific_clips JSONB DEFAULT '[]'::jsonb,
    search_context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- For existing installations:
-- ALTER TABLE public.assets_video_curation ADD COLUMN positive_feedback TEXT;
-- ALTER TABLE public.assets_video_curation ADD COLUMN negative_feedback TEXT;

-- Indexing for fast search and algorithmic sorting
CREATE INDEX IF NOT EXISTS idx_assets_video_curation_video_id ON public.assets_video_curation(video_id);
CREATE INDEX IF NOT EXISTS idx_assets_video_curation_topic ON public.assets_video_curation(topic);
CREATE INDEX IF NOT EXISTS idx_assets_video_curation_score ON public.assets_video_curation(score DESC);

-- Enable RLS
ALTER TABLE public.assets_video_curation ENABLE ROW LEVEL SECURITY;

-- Service role access
DROP POLICY IF EXISTS "Service Role All Access" ON public.assets_video_curation;
CREATE POLICY "Service Role All Access" 
ON public.assets_video_curation 
FOR ALL USING (true) WITH CHECK (true);

-- Updated_at Trigger
CREATE OR REPLACE FUNCTION update_assets_video_curation_trigger()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assets_video_curation_updated_at ON public.assets_video_curation;
CREATE TRIGGER trg_assets_video_curation_updated_at
BEFORE UPDATE ON public.assets_video_curation
FOR EACH ROW EXECUTE PROCEDURE update_assets_video_curation_trigger();
