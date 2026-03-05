-- messaging_comments table

create table if not exists public.messaging_comments (
  id bigserial primary key,
  comment text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_comments_category
  on public.messaging_comments (category);

create index if not exists idx_messaging_comments_created_at
  on public.messaging_comments (created_at desc);

create or replace function public.set_messaging_comments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_comments_updated_at on public.messaging_comments;
create trigger trg_messaging_comments_updated_at
before update on public.messaging_comments
for each row
execute function public.set_messaging_comments_updated_at();
