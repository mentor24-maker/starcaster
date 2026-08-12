-- Scaled-down copies ("renditions") of oversized gallery images.
--
-- One image, several sizes. The browser picks the smallest file that still
-- looks sharp in the slot it lands in, so a phone stops downloading a 2.5 MB
-- original to fill a 400px-wide column.
--
-- Shape of `renditions` (ordered smallest first):
--   [{"w":300,"h":200,"format":"webp","bytes":18234,"url":"https://…/w300.webp"},
--    {"w":600,"h":400,"format":"webp","bytes":52104,"url":"https://…/w600.webp"},
--    {"w":1200,"h":800,"format":"webp","bytes":151233,"url":"https://…/w1200.webp"},
--    {"w":1200,"h":800,"format":"jpeg","bytes":213880,"url":"https://…/w1200.jpg",
--     "role":"social"}]
--
-- The original row (`location`, `image_width`, `image_height`, `size`) is never
-- touched — it stays the master copy and the top rung of the ladder.

alter table public.assets
  add column if not exists renditions jsonb not null default '[]'::jsonb;

alter table public.assets
  add column if not exists renditions_generated_at timestamptz null;

-- Backfill and "which images still need this?" scans both filter on emptiness.
create index if not exists assets_renditions_pending_idx
  on public.assets (id)
  where renditions = '[]'::jsonb;
