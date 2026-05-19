drop index if exists public.contacts_email_unique_idx;

create unique index if not exists idx_contacts_project_email
  on public.contacts(project_id, email);
