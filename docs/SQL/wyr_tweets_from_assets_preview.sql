-- Preview image assets whose names contain space-delimited " or " / " OR " (WYR-style).
-- Full tweet text formatting is done in lib/wyrAssetTweet.js; use the import script to persist tweets.
--
--   node scripts/import_wyr_tweets_from_assets.js
--   node scripts/import_wyr_tweets_from_assets.js --apply --project-id=YOUR_PROJECT_UUID

select
  id,
  asset_name,
  category,
  topic,
  project_id,
  location
from public.assets
where lower(trim(asset_type)) = 'image'
  and asset_name ~* '\s+or\s+'
order by asset_name asc;

-- Optional: exclude assets that already have a linked tweet
-- select a.id, a.asset_name
-- from public.assets a
-- where lower(trim(a.asset_type)) = 'image'
--   and a.asset_name ~* '\s+or\s+'
--   and not exists (
--     select 1
--     from public.messaging_tweets t
--     where t.image_asset_id = a.id
--   );
