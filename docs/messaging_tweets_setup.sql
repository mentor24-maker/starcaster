-- messaging_tweets table

create table if not exists public.messaging_tweets (
  id bigserial primary key,
  content text not null,
  category text not null default '',
  url text not null default '',
  hashtags text not null default '',
  image_asset_id bigint null references public.assets(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messaging_tweets
  add column if not exists category text not null default '';

create index if not exists idx_messaging_tweets_created_at
  on public.messaging_tweets (created_at desc);

create index if not exists idx_messaging_tweets_category
  on public.messaging_tweets (category);

create index if not exists idx_messaging_tweets_image_asset_id
  on public.messaging_tweets (image_asset_id);

create or replace function public.set_messaging_tweets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_tweets_updated_at on public.messaging_tweets;
create trigger trg_messaging_tweets_updated_at
before update on public.messaging_tweets
for each row
execute function public.set_messaging_tweets_updated_at();
