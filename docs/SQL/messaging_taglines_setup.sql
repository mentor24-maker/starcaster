-- messaging_taglines table
-- Stores reusable tagline copy with an optional shared messaging category.

create table if not exists public.messaging_taglines (
  id bigserial primary key,
  tagline text not null,
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_taglines_category
  on public.messaging_taglines (category);

create index if not exists idx_messaging_taglines_created_at
  on public.messaging_taglines (created_at desc);

create or replace function public.set_messaging_taglines_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_taglines_updated_at on public.messaging_taglines;
create trigger trg_messaging_taglines_updated_at
before update on public.messaging_taglines
for each row
execute function public.set_messaging_taglines_updated_at();
