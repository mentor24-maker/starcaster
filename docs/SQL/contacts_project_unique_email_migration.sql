-- Same person may exist on multiple projects; email is unique per project, not globally.
alter table public.contacts
  alter column email drop not null;

drop index if exists public.contacts_email_unique_idx;

drop index if exists public.idx_contacts_project_email;
create unique index if not exists idx_contacts_project_email
  on public.contacts (project_id, email)
  where project_id is not null
    and email is not null
    and trim(email) <> '';
