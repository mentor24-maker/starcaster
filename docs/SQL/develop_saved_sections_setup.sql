create table if not exists public.develop_saved_sections (
  id text primary key,
  name text not null,
  section jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_develop_saved_sections_project_id
  on public.develop_saved_sections (project_id);

create index if not exists idx_develop_saved_sections_updated_at
  on public.develop_saved_sections (updated_at desc);

create or replace function public.set_develop_saved_sections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_develop_saved_sections_updated_at on public.develop_saved_sections;
create trigger trg_develop_saved_sections_updated_at
before update on public.develop_saved_sections
for each row
execute function public.set_develop_saved_sections_updated_at();
