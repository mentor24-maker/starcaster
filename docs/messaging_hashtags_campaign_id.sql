-- Add campaign_id column to messaging_hashtags
-- This column links each hashtag to a campaign for grouping in the Campaign Builder.

alter table if exists public.messaging_hashtags
  add column if not exists campaign_id bigint;

create index if not exists idx_messaging_hashtags_campaign_id
  on public.messaging_hashtags (campaign_id);
