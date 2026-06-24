-- Add is_private boolean (default false = public) to all builder objects.
-- Objects with is_private = true are only displayed to authenticated admin users.

ALTER TABLE public.builder_landing_page
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.builder_modules
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.builder_module_classes
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.builder_saved_sections
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.builder_clusters
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
