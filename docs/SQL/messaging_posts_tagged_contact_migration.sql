-- Optional person tag on messaging posts (Facebook tagging at publish).
-- Apply manually per environment (no migration runner).

alter table if exists public.messaging_posts
  add column if not exists tagged_contact_id text null;

create index if not exists idx_messaging_posts_tagged_contact_id
  on public.messaging_posts (tagged_contact_id)
  where tagged_contact_id is not null and trim(tagged_contact_id) <> '';
