-- =============================================================================
-- Migration: Add Topic to Campaigns 
-- Allows campaigns to inherit the global platform taxonomy
-- =============================================================================

ALTER TABLE IF EXISTS public.campaigns
ADD COLUMN IF NOT EXISTS topic text default '';

CREATE INDEX IF NOT EXISTS idx_campaigns_topic
ON public.campaigns (topic);
