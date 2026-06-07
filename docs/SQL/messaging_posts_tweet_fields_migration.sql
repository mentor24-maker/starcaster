-- Align messaging_posts with messaging_tweets social fields (url, hashtags, image).
-- Apply manually per environment (no migration runner).

alter table if exists public.messaging_posts
  add column if not exists url text not null default '';

alter table if exists public.messaging_posts
  add column if not exists hashtags text not null default '';

alter table if exists public.messaging_posts
  add column if not exists image_asset_id bigint null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messaging_posts_image_asset_id_fkey'
  ) then
    alter table public.messaging_posts
      add constraint messaging_posts_image_asset_id_fkey
      foreign key (image_asset_id)
      references public.assets (id)
      on update cascade
      on delete set null;
  end if;
end $$;

create index if not exists idx_messaging_posts_image_asset_id
  on public.messaging_posts (image_asset_id);
