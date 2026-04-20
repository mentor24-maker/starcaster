-- =============================================================================
-- Migration: Add `channel_type` and `contact_id` to `channels`
-- Purpose: Supports separating Organic vs Virtual channels, mapping Virtuals to VPs.
-- Date: 2026-04-19
-- =============================================================================

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'organic' CHECK (channel_type IN ('organic', 'virtual')),
  ADD COLUMN IF NOT EXISTS contact_id text NULL REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_channels_contact_id ON public.channels(contact_id);

-- Down migration (optional record)
-- ALTER TABLE public.channels DROP COLUMN contact_id;
-- ALTER TABLE public.channels DROP COLUMN channel_type;

-- Failsafe to ensure all existing records lock into the default category:
UPDATE public.channels SET channel_type = 'organic' WHERE channel_type IS NULL;
