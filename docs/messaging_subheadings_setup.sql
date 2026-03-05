-- messaging_subheadings table
-- Stores reusable sub-heading copy with an optional shared messaging category.

create table if not exists public.messaging_subheadings (
  id bigserial primary key,
  subheading text not null,
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_subheadings_category
  on public.messaging_subheadings (category);

create index if not exists idx_messaging_subheadings_created_at
  on public.messaging_subheadings (created_at desc);

create or replace function public.set_messaging_subheadings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_subheadings_updated_at on public.messaging_subheadings;
create trigger trg_messaging_subheadings_updated_at
before update on public.messaging_subheadings
for each row
execute function public.set_messaging_subheadings_updated_at();
