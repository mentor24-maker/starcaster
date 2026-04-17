-- =========================================================================================
-- ISITAS Database Migration
-- Target: public.assets
-- Objective: Append asynchronous background tracking architecture tying external AI Job endpoints properly mapped.
-- =========================================================================================

ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS generation_status text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS generation_job_id text DEFAULT NULL;

COMMENT ON COLUMN public.assets.generation_status IS 'Asynchronous AI tracking state: queued, processing, completed, failed';
COMMENT ON COLUMN public.assets.generation_job_id IS 'Platform-specific (Veo/Google) Job identifier for pulling external outputs';
