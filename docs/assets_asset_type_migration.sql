-- Update assets and asset_categories to the current five-type taxonomy:
-- Image, Video, Audio, Lead Magnet, File

begin;

-- Normalize existing stored values before tightening constraints.
update public.assets
set asset_type = case
  when asset_type = 'Music' then 'Audio'
  when asset_type = 'Copy' then 'Lead Magnet'
  when asset_type = 'Screenshot' then 'File'
  when asset_type = 'Multimedia' then 'Video'
  else asset_type
end
where asset_type in ('Music', 'Copy', 'Screenshot', 'Multimedia');

update public.asset_categories
set asset_type = case
  when asset_type = 'Music' then 'Audio'
  when asset_type = 'Copy' then 'Lead Magnet'
  when asset_type = 'Screenshot' then 'File'
  when asset_type = 'Multimedia' then 'Video'
  else asset_type
end
where asset_type in ('Music', 'Copy', 'Screenshot', 'Multimedia');

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

commit;
