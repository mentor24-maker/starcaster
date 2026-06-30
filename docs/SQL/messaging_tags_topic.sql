-- Add topic to messaging_tags for associating tags with Messaging topics.

alter table if exists public.messaging_tags
  add column if not exists topic text;

create index if not exists idx_messaging_tags_topic
  on public.messaging_tags (topic);
