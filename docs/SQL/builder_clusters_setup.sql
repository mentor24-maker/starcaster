-- Create builder_clusters table.
-- Clusters are platform-level named groups of modules (e.g. CRM, Blog).
-- Starcaster admins define clusters here; per-project toggles reference them.

CREATE TABLE IF NOT EXISTS public.builder_clusters (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
