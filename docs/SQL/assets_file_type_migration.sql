update public.assets
set asset_type = 'File'
where asset_type = 'Screenshot';

update public.asset_categories
set asset_type = 'File'
where asset_type = 'Screenshot';

alter table public.assets
  drop constraint if exists assets_asset_type_check;

alter table public.assets
  add constraint assets_asset_type_check
  check (asset_type in ('Image', 'Video', 'Audio', 'Lead Magnet', 'File'));

alter table public.asset_categories
  drop constraint if exists asset_categories_asset_type_check;

alter table public.asset_categories
  add constraint asset_categories_asset_type_check
  check (asset_type in ('Image', 'Video', 'Audio', 'Lead Magnet', 'File'));
