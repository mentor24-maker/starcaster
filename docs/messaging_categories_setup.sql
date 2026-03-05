-- messaging_categories table
-- Stores reusable category labels for all Messaging types.

create table if not exists public.messaging_categories (
  id bigserial primary key,
  category text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_categories_category
  on public.messaging_categories (category);

create or replace function public.set_messaging_categories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_categories_updated_at on public.messaging_categories;
create trigger trg_messaging_categories_updated_at
before update on public.messaging_categories
for each row
execute function public.set_messaging_categories_updated_at();
