-- messaging_posts table

create table if not exists public.messaging_posts (
  id bigserial primary key,
  post text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_posts_category
  on public.messaging_posts (category);

create index if not exists idx_messaging_posts_created_at
  on public.messaging_posts (created_at desc);

create or replace function public.set_messaging_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_posts_updated_at on public.messaging_posts;
create trigger trg_messaging_posts_updated_at
before update on public.messaging_posts
for each row
execute function public.set_messaging_posts_updated_at();
