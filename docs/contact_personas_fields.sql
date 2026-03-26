alter table if exists public.contact_personas
add column if not exists tags jsonb not null default '[]'::jsonb;

alter table if exists public.contact_personas
add column if not exists parent_persona_id bigint null;

create index if not exists contact_personas_parent_idx
  on public.contact_personas (parent_persona_id);
