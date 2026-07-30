-- Support requests raised by tenant admins from their own admin area
-- (e.g. brandonmarinoff.com/admin-support).
--
-- These travel the opposite direction from a CRM contact: a CRM contact is a
-- visitor writing to the site owner, whereas a support request is the site
-- owner writing to Alphire. They therefore do NOT belong in crm_contacts,
-- whose columns are per-project configurable text fields, and whose alert
-- address (site_settings.contactAlertEmail) is the tenant's own inbox.
--
-- Backed by lib/projectSupportRequestsStore.js and routes/projectSupport.js.
--
-- Screenshots are NOT stored here. The image goes to blob storage
-- (lib/assetStorage.js) and only its public URL is kept, so this table stays
-- small and no binary ever passes through Postgres. The upload deliberately
-- does not create an `assets` row either: a tenant's Assets library is their
-- own media, and support screenshots would just clutter it.

create table if not exists public.app_project_support_requests (
  id              text        primary key,
  project_id      text        not null,

  -- Who raised it. admin_user_id is nullable and NOT a foreign key on purpose:
  -- deleting a staff member must not delete the history of what they reported.
  -- admin_email is captured at submit time so the record stays readable.
  admin_user_id   text,
  admin_email     text        not null default '',

  priority        text        not null default 'normal',
  title           text        not null,
  description     text        not null default '',

  screenshot_url  text        not null default '',
  screenshot_name text        not null default '',

  -- No triage UI ships in this slice; the column exists so adding one later is
  -- a UI change rather than a data migration.
  status          text        not null default 'open',

  created_at      timestamptz not null default now()
);

-- Values the API accepts. Enforced in lib/projectSupportRequestsStore.js too;
-- kept here so a stray direct write cannot poison the list UI.
alter table public.app_project_support_requests
  drop constraint if exists app_project_support_requests_priority_check;
alter table public.app_project_support_requests
  add constraint app_project_support_requests_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));

alter table public.app_project_support_requests
  drop constraint if exists app_project_support_requests_status_check;
alter table public.app_project_support_requests
  add constraint app_project_support_requests_status_check
  check (status in ('open', 'in_progress', 'resolved', 'closed'));

-- The only read path: newest-first for one project.
create index if not exists idx_project_support_requests_project_created
  on public.app_project_support_requests (project_id, created_at desc);
