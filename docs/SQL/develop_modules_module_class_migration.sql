alter table if exists public.develop_modules
  add column if not exists module_class text not null default '';

alter table if exists public.develop_modules
  add column if not exists modules jsonb not null default '[]'::jsonb;

create index if not exists idx_develop_modules_module_class
  on public.develop_modules (module_class);
