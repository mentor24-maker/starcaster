alter table if exists public.develop_email_templates
add column if not exists blocks jsonb not null default '[]'::jsonb;
