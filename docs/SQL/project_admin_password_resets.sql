-- Project Admin: emailed one-time codes for tenant-admin password resets.
--
-- Tenant admins (e.g. brandonmarinoff.com/admin-login) live in
-- app_project_admin_users, so they cannot use the platform
-- /api/auth/forgot-password flow. This table backs /api/admin/auth/
-- forgot-password + reset-password (see lib/projectAdminPasswordReset.js).
--
-- Deliberately its own table rather than reusing app_project_admin_sessions:
-- a row in that table IS a live session, so a reset code parked there would
-- double as a working session token.
--
-- Codes are stored as scrypt hashes (same helper as password_hash), are
-- single-use (used_at), expire after 15 minutes, and cap failed guesses at 5.

create table if not exists public.app_project_admin_password_resets (
  id            text        primary key,
  project_id    text        not null,
  admin_user_id text        not null references public.app_project_admin_users(id) on delete cascade,
  email         text        not null,
  code_hash     text        not null,
  attempts      integer     not null default 0,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);

-- Lookup path used by consumePasswordResetCode(): newest unused code for a
-- (project, email) pair.
create index if not exists idx_project_admin_password_resets_lookup
  on public.app_project_admin_password_resets (project_id, email, created_at desc);

create index if not exists idx_project_admin_password_resets_admin_user_id
  on public.app_project_admin_password_resets (admin_user_id);

create index if not exists idx_project_admin_password_resets_expires_at
  on public.app_project_admin_password_resets (expires_at);

-- Optional housekeeping: spent and long-expired codes carry no value.
-- delete from public.app_project_admin_password_resets
--   where expires_at < now() - interval '7 days';
