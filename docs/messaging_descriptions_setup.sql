-- messaging_descriptions table

create table if not exists public.messaging_descriptions (
  id bigserial primary key,
  description text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_descriptions_category
  on public.messaging_descriptions (category);

create index if not exists idx_messaging_descriptions_created_at
  on public.messaging_descriptions (created_at desc);

create or replace function public.set_messaging_descriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_descriptions_updated_at on public.messaging_descriptions;
create trigger trg_messaging_descriptions_updated_at
before update on public.messaging_descriptions
for each row
execute function public.set_messaging_descriptions_updated_at();
