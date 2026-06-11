create table if not exists public.develop_products (
  id text primary key,
  name text not null,
  product_type text not null default 'merch',
  product_url text not null default '',
  image_url text not null default '',
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_develop_products_project_id
  on public.develop_products (project_id);

create index if not exists idx_develop_products_product_type
  on public.develop_products (product_type);

create or replace function public.set_develop_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_develop_products_updated_at on public.develop_products;
create trigger trg_develop_products_updated_at
before update on public.develop_products
for each row
execute function public.set_develop_products_updated_at();
