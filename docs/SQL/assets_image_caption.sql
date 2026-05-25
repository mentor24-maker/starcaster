-- Image caption for Assets (used by Image → Headline import and Assets: Image table).
-- Apply manually per environment.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS caption text;

COMMENT ON COLUMN public.assets.caption IS 'Display caption for Image assets; preferred source for Image → Headline import';
