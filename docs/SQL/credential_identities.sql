-- Remembers which account each provider's credentials last authenticated as,
-- so a silent change of identity can be reported.
--
-- Phase 3 of docs/CREDENTIALING_HARDENING_PLAN.md. Every verifier already
-- reports "authenticated as @who" (Phase 2), but with nothing to compare
-- against, a token that quietly starts pointing at a different account looks
-- like a clean pass. On a multi-tenant platform where each project posts as a
-- different identity, publishing to the wrong account is a real failure, not a
-- cosmetic one — so the check needs to say "this token now posts as @other, not
-- @dachristensen".
--
-- One row per (project, provider): the current known identity, when it was
-- first seen, and when it was last confirmed. Read/written only through
-- lib/credentialIdentityStore.js.
--
-- Deliberately stores no secret material — only the account label and id the
-- provider itself hands back (e.g. "@dachristensen" / "18223886").
--
-- Until this migration is applied the store degrades to a no-op: verification
-- keeps working, drift simply is not reported. The code ships before the table
-- exists on purpose.

create table if not exists public.app_credential_identities (
  id               text        primary key,
  project_id       text        not null,
  provider         text        not null,
  identity_label   text,
  identity_id      text,
  first_seen_at    timestamptz not null default now(),
  last_verified_at timestamptz not null default now()
);

-- The lookup and upsert path: exactly one current identity per project+provider.
create unique index if not exists idx_credential_identities_project_provider
  on public.app_credential_identities (project_id, provider);
