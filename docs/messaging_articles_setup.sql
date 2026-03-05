-- messaging_articles table
-- Stores long-form messaging content (articles) with optional thumbnail image reference.

create table if not exists public.messaging_articles (
  id bigserial primary key,
  platform text not null default '',
  author text not null default '',
  title text not null,
  subtitle text not null default '',
  url text not null default '',
  content text not null,
  publish_date timestamptz null,
  thumbnail_asset_id bigint null references public.assets(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_articles_publish_date
  on public.messaging_articles (publish_date desc nulls last);

create index if not exists idx_messaging_articles_thumbnail_asset_id
  on public.messaging_articles (thumbnail_asset_id);

-- Keep updated_at current
create or replace function public.set_messaging_articles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_articles_updated_at on public.messaging_articles;
create trigger trg_messaging_articles_updated_at
before update on public.messaging_articles
for each row
execute function public.set_messaging_articles_updated_at();

