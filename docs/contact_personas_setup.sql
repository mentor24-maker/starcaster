create table if not exists public.contact_personas (
  id bigserial primary key,
  project_id text null,
  owner_user_id text null,
  persona text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_personas_persona_idx
  on public.contact_personas (persona);

create index if not exists contact_personas_project_owner_idx
  on public.contact_personas (project_id, owner_user_id);

create or replace function public.set_contact_personas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contact_personas_set_updated_at on public.contact_personas;

create trigger contact_personas_set_updated_at
before update on public.contact_personas
for each row
execute function public.set_contact_personas_updated_at();
