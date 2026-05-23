-- Asset thumbnail metadata for gallery/picker previews.

alter table public.assets
  add column if not exists thumbnail_location text not null default '';

alter table public.assets
  add column if not exists thumbnail_width integer null;

alter table public.assets
  add column if not exists thumbnail_height integer null;

alter table public.assets
  add column if not exists thumbnail_size bigint null;

alter table public.assets
  add column if not exists thumbnail_generated_at timestamptz null;
