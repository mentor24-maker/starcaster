-- messaging_hashtags table

create table if not exists public.messaging_hashtags (
  id bigserial primary key,
  hashtag text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messaging_hashtags
  add column if not exists category text not null default '';

create index if not exists idx_messaging_hashtags_category
  on public.messaging_hashtags (category);

create index if not exists idx_messaging_hashtags_created_at
  on public.messaging_hashtags (created_at desc);

create or replace function public.set_messaging_hashtags_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_hashtags_updated_at on public.messaging_hashtags;
create trigger trg_messaging_hashtags_updated_at
before update on public.messaging_hashtags
for each row
execute function public.set_messaging_hashtags_updated_at();
