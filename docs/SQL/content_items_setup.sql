-- content_items: unified messaging content rows synced from external sources (e.g. Builder web pages).
-- Idempotent: safe when the table already exists with an older/partial schema.
-- Apply manually in Supabase per environment.

create table if not exists public.content_items (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.content_items
  add column if not exists format text not null default '',
  add column if not exists title text not null default '',
  add column if not exists content text not null default '',
  add column if not exists topic text not null default '',
  add column if not exists category text not null default '',
  add column if not exists url text not null default '',
  add column if not exists source_type text not null default '',
  add column if not exists source_id text not null default '',
  add column if not exists source_slug text not null default '',
  add column if not exists content_hash text not null default '',
  add column if not exists project_id text,
  add column if not exists owner_user_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_content_items_format
  on public.content_items (format);

create index if not exists idx_content_items_source
  on public.content_items (source_type, source_id);

create index if not exists idx_content_items_project_id
  on public.content_items (project_id);

create unique index if not exists uq_content_items_project_source
  on public.content_items (project_id, source_type, source_id)
  where source_type <> '' and source_id <> '';

create or replace function public.set_content_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_content_items_updated_at on public.content_items;
create trigger trg_content_items_updated_at
before update on public.content_items
for each row
execute function public.set_content_items_updated_at();
