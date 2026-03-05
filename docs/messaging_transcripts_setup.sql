-- messaging_transcripts table

create table if not exists public.messaging_transcripts (
  id bigserial primary key,
  transcript text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_transcripts_category
  on public.messaging_transcripts (category);

create index if not exists idx_messaging_transcripts_created_at
  on public.messaging_transcripts (created_at desc);

create or replace function public.set_messaging_transcripts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_transcripts_updated_at on public.messaging_transcripts;
create trigger trg_messaging_transcripts_updated_at
before update on public.messaging_transcripts
for each row
execute function public.set_messaging_transcripts_updated_at();
