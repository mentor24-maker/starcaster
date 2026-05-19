create table if not exists public.develop_forms (
  id text primary key,
  name text not null default '',
  form_type text not null default '',
  contact_type text not null default 'lead',
  lead_magnet_type text not null default '',
  lead_magnet_id text not null default '',
  cta_id text not null default '',
  heading text not null default '',
  submit_label text not null default '',
  success_message text not null default '',
  error_message text not null default '',
  accent_color text not null default '',
  match_landing_color boolean not null default false,
  landing_color_mode text not null default '',
  use_landing_background boolean not null default false,
  fields jsonb not null default '[]'::jsonb,
  project_id text null,
  owner_user_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_develop_forms_project_id
  on public.develop_forms(project_id);

create index if not exists idx_develop_forms_owner_user_id
  on public.develop_forms(owner_user_id);

create or replace function public.set_develop_forms_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_develop_forms_updated_at on public.develop_forms;

create trigger trg_develop_forms_updated_at
before update on public.develop_forms
for each row
execute function public.set_develop_forms_updated_at();
