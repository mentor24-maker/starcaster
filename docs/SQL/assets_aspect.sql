-- Asset aspect buckets for gallery picker (wide, square, tall).
-- Run in Supabase SQL Editor if migrations are not applied automatically.

alter table public.assets
  add column if not exists aspect text not null default 'square';

update public.assets
set aspect = 'wide'
where image_width > 0
  and image_height > 0
  and (image_width::numeric / nullif(image_height, 0)) >= 1.2;

update public.assets
set aspect = 'tall'
where image_width > 0
  and image_height > 0
  and (image_width::numeric / nullif(image_height, 0)) <= 0.82
  and aspect <> 'wide';

update public.assets
set aspect = 'square'
where aspect is null
  or trim(aspect) = ''
  or aspect not in ('wide', 'square', 'tall');

alter table public.assets
  drop constraint if exists assets_aspect_check;

alter table public.assets
  add constraint assets_aspect_check
  check (aspect in ('wide', 'square', 'tall'));

create index if not exists assets_aspect_idx on public.assets (aspect);
