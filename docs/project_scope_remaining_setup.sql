begin;

alter table if exists public.channels
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.contact_personas
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.develop_themes
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.develop_email_templates
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.develop_landing_page
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.develop_extensions
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.develop_extensions_manager
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

create index if not exists idx_channels_project_id
  on public.channels(project_id);

create index if not exists idx_channels_owner_user_id
  on public.channels(owner_user_id);

create index if not exists idx_contact_personas_project_id
  on public.contact_personas(project_id);

create index if not exists idx_contact_personas_owner_user_id
  on public.contact_personas(owner_user_id);

create index if not exists idx_develop_themes_project_id
  on public.develop_themes(project_id);

create index if not exists idx_develop_themes_owner_user_id
  on public.develop_themes(owner_user_id);

create index if not exists idx_develop_email_templates_project_id
  on public.develop_email_templates(project_id);

create index if not exists idx_develop_email_templates_owner_user_id
  on public.develop_email_templates(owner_user_id);

create index if not exists idx_develop_landing_page_project_id
  on public.develop_landing_page(project_id);

create index if not exists idx_develop_landing_page_owner_user_id
  on public.develop_landing_page(owner_user_id);

create index if not exists idx_develop_extensions_project_id
  on public.develop_extensions(project_id);

create index if not exists idx_develop_extensions_owner_user_id
  on public.develop_extensions(owner_user_id);

create index if not exists idx_develop_extensions_manager_project_id
  on public.develop_extensions_manager(project_id);

create index if not exists idx_develop_extensions_manager_owner_user_id
  on public.develop_extensions_manager(owner_user_id);

commit;
