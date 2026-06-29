-- Add created_at and updated_at to the assets table.
-- Existing rows are backfilled with now(); new rows default to now() automatically.
-- A trigger keeps updated_at current on every update.

alter table public.assets
  add column if not exists created_at timestamptz not null default now();

alter table public.assets
  add column if not exists updated_at timestamptz not null default now();

-- Backfill existing rows so the columns are never null.
update public.assets
  set created_at = now(),
      updated_at = now()
  where created_at is null or updated_at is null;

-- Trigger function to stamp updated_at on every row update.
create or replace function public.set_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_assets_updated_at on public.assets;
create trigger trg_assets_updated_at
before update on public.assets
for each row
execute function public.set_assets_updated_at();

-- Indexes for efficient time-based queries and sorting.
create index if not exists idx_assets_created_at
  on public.assets (created_at desc);

create index if not exists idx_assets_updated_at
  on public.assets (updated_at desc);
