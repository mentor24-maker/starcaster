-- messaging_emails table

create table if not exists public.messaging_emails (
  id bigserial primary key,
  email text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_emails_category
  on public.messaging_emails (category);

create index if not exists idx_messaging_emails_created_at
  on public.messaging_emails (created_at desc);

create or replace function public.set_messaging_emails_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_emails_updated_at on public.messaging_emails;
create trigger trg_messaging_emails_updated_at
before update on public.messaging_emails
for each row
execute function public.set_messaging_emails_updated_at();
