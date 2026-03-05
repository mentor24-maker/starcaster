-- messaging_headlines table
-- Stores reusable headline copy with an optional shared messaging category.

create table if not exists public.messaging_headlines (
  id bigserial primary key,
  headline text not null,
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_headlines_category
  on public.messaging_headlines (category);

create index if not exists idx_messaging_headlines_created_at
  on public.messaging_headlines (created_at desc);

create or replace function public.set_messaging_headlines_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_headlines_updated_at on public.messaging_headlines;
create trigger trg_messaging_headlines_updated_at
before update on public.messaging_headlines
for each row
execute function public.set_messaging_headlines_updated_at();
