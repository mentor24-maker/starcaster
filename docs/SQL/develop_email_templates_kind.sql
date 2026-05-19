alter table if exists public.develop_email_templates
add column if not exists template_kind text not null default 'text';

create index if not exists develop_email_templates_kind_idx
  on public.develop_email_templates (template_kind, updated_at desc);
