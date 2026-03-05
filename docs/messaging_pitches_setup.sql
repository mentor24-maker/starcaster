-- messaging_pitches table

create table if not exists public.messaging_pitches (
  id bigserial primary key,
  pitch text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_pitches_category
  on public.messaging_pitches (category);

create index if not exists idx_messaging_pitches_created_at
  on public.messaging_pitches (created_at desc);

create or replace function public.set_messaging_pitches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_pitches_updated_at on public.messaging_pitches;
create trigger trg_messaging_pitches_updated_at
before update on public.messaging_pitches
for each row
execute function public.set_messaging_pitches_updated_at();
