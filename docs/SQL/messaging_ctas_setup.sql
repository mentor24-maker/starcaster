-- messaging_ctas table

create table if not exists public.messaging_ctas (
  id bigserial primary key,
  cta text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_ctas_category
  on public.messaging_ctas (category);

create index if not exists idx_messaging_ctas_created_at
  on public.messaging_ctas (created_at desc);

create or replace function public.set_messaging_ctas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_ctas_updated_at on public.messaging_ctas;
create trigger trg_messaging_ctas_updated_at
before update on public.messaging_ctas
for each row
execute function public.set_messaging_ctas_updated_at();
