create table if not exists public.develop_modules (
  id text primary key,
  name text not null,
  module_type text not null,
  settings jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_develop_modules_project_id
  on public.develop_modules (project_id);

create index if not exists idx_develop_modules_module_type
  on public.develop_modules (module_type);

create or replace function public.set_develop_modules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_develop_modules_updated_at on public.develop_modules;

create trigger trg_develop_modules_updated_at
before update on public.develop_modules
for each row
execute function public.set_develop_modules_updated_at();
