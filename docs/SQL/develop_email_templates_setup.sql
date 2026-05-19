create table if not exists public.develop_email_templates (
  id bigserial primary key,
  template_kind text not null default 'text',
  slug text not null unique,
  name text not null,
  summary text not null default '',
  subject text not null default '',
  heading text not null default '',
  body text not null default '',
  cta text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists develop_email_templates_updated_at_idx
  on public.develop_email_templates (updated_at desc);

create index if not exists develop_email_templates_kind_idx
  on public.develop_email_templates (template_kind, updated_at desc);

create or replace function public.set_develop_email_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists develop_email_templates_set_updated_at
  on public.develop_email_templates;

create trigger develop_email_templates_set_updated_at
before update on public.develop_email_templates
for each row
execute function public.set_develop_email_templates_updated_at();
