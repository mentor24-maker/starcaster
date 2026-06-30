-- Add importance (1–5) to messaging_tags for prioritizing support-copy tags.

alter table if exists public.messaging_tags
  add column if not exists importance smallint;

create index if not exists idx_messaging_tags_importance
  on public.messaging_tags (importance);
