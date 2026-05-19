-- messaging_white_papers table
-- Stores long-form white paper content with optional thumbnail and embedded PDF upload.

create table if not exists public.messaging_white_papers (
  id bigserial primary key,
  platform text not null default '',
  author text not null default '',
  title text not null,
  subtitle text not null default '',
  url text not null default '',
  content text not null,
  publish_date timestamptz null,
  thumbnail_asset_id bigint null references public.assets(id) on update cascade on delete set null,
  pdf_name text not null default '',
  pdf_mime_type text not null default '',
  pdf_data_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_white_papers_publish_date
  on public.messaging_white_papers (publish_date desc nulls last);

create index if not exists idx_messaging_white_papers_thumbnail_asset_id
  on public.messaging_white_papers (thumbnail_asset_id);

create or replace function public.set_messaging_white_papers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_white_papers_updated_at on public.messaging_white_papers;
create trigger trg_messaging_white_papers_updated_at
before update on public.messaging_white_papers
for each row
execute function public.set_messaging_white_papers_updated_at();
