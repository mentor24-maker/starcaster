-- project_connections_setup.sql
-- The Connections vault: where a tenant's own OAuth grants live.
-- Loop Queue task 86bbpz1d0 (Connections 1 of 7).
--
--   project_connections           one grant — one project, one provider, one
--                                 postable account — with its tokens encrypted.
--   project_connection_handoffs   short-lived: the provider handed back SEVERAL
--                                 postable accounts and somebody has to choose.
--
-- Nothing reads or writes these yet. Slice 2 brings the adapters, slice 3 the
-- resolver that prefers a project's own grant over the global keys. This file
-- only creates the places those slices put their rows.
--
-- It is the generalised form of docs/SQL/project_social_credentials_setup.sql,
-- which holds one Facebook Page per project and nothing else. That table and
-- its store keep working untouched until slice 2 ports them; this is a new
-- home beside it, not a replacement for it yet.
--
-- BOTH tenant columns on BOTH tables (CLAUDE.md landmine 12). lib/projectScope.js
-- decides whether to stamp a tenant by probing the table for project_id AND
-- owner_user_id together; a table carrying only one fails that probe, and
-- scopedInsertRow then silently stops stamping EITHER column. The insert still
-- succeeds and the rows land with no tenant at all. That is how 550 untenanted
-- builder_page_revisions rows shipped on 2026-08-16 without anything erroring —
-- and an untenanted row HERE is an OAuth token belonging to nobody in
-- particular, which is a worse thing to own than an untenanted page revision.
--
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids in this codebase
-- are slugs like 'delray-beach-tennis-center', not UUIDs.
--
-- No foreign key to app_projects, matching docs/SQL/video_studio_setup.sql
-- rather than the older project_social_credentials. The cascade it would buy is
-- real, but every test here parses this file ALONE (scripts/builder/sqlSchemaFake.js),
-- so a reference to a table that file does not create would make every insert
-- in the suite a foreign-key error. Deleting a project is a hand-run operator
-- step already; sweeping its connections is part of that step, not of this one.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown
-- (docs/SQL/enable_rls_lockdown.sql). All access goes through the Node server
-- with the Supabase service key, which bypasses RLS, so this is safe and keeps
-- Supabase's security-advisor findings from reopening.
--
-- Idempotent: every statement is `if not exists`, so running the whole file
-- twice changes nothing.

-- ── project_connections ─────────────────────────────────────────────────────
-- `status` is deliberately NOT constrained by a check here. Slice 6/7 adds the
-- refresh/verify lifecycle and the amber "needs attention" card, and each new
-- state it introduces would otherwise cost a migration. The vocabulary lives in
-- lib/projectConnectionsStore.js (CONNECTION_STATUSES) instead, where extending
-- it is a one-line change with no schema move — the same call, for the same
-- reason, that video_sessions.state makes.
--
-- The key is (project_id, provider, account_id), not (project_id, provider): a
-- client can grant one project two Instagram accounts, and keying on the
-- provider alone would silently overwrite the first with the second.

create table if not exists public.project_connections (
  project_id            text not null,
  owner_user_id         text,
  -- 'instagram', 'facebook_page', 'x', ... Free text on purpose: slice 2 adds
  -- adapters and a new provider must not need a migration. YouTube and LinkedIn
  -- are out of scope for the whole epic (they need a registered business
  -- identity), so nothing here is reserved for them.
  provider              text not null,
  -- The provider's own id for the postable account — a Page id, an IG user id,
  -- an X user id. Never our id for it.
  account_id            text not null,
  -- What to show the client on the card. Their handle or page name, and their
  -- avatar, both as the provider last reported them.
  account_label         text not null default '',
  account_avatar_url    text not null default '',
  -- The scopes the grant actually came back with, which are not always the
  -- scopes that were asked for. Slice 6 compares the two to decide whether a
  -- connection can still do what the screen claims it can.
  scopes                jsonb not null default '[]'::jsonb,
  status                text not null default 'connected',
  -- When the access token stops working. Null means the provider did not say —
  -- which is NOT the same as "never expires", and slice 6 has to treat it as
  -- unknown rather than as safe.
  expires_at            timestamptz,
  -- The signed-in user who granted it. Kept apart from owner_user_id, which is
  -- the tenant stamp lib/projectScope.js writes: a staff member can connect an
  -- account inside a project they do not own, and after a handover the person
  -- who granted it may no longer be the owner of anything.
  connected_by_user_id  text,
  -- Slice 6 writes these two. last_verified_at is when the token was last
  -- proved to still work; last_error is why it stopped, in the provider's own
  -- words, so the amber card can say something better than "something is wrong".
  last_verified_at      timestamptz,
  last_error            text not null default '',
  -- AES-256-GCM through lib/channelsCipher.js: ciphertext, iv and auth tag, all
  -- base64. The plaintext token is never a column. key_version is which key
  -- encrypted them, so a future rotation can tell re-encrypted rows from ones
  -- it has not reached yet.
  access_token_enc      text not null default '',
  access_token_iv       text not null default '',
  access_token_tag      text not null default '',
  -- The refresh token, same encryption. Present now rather than in slice 6 —
  -- it is the grant itself, handed over once at connect time and unobtainable
  -- afterwards, so a column added later would arrive after the only moment the
  -- value existed.
  refresh_token_enc     text not null default '',
  refresh_token_iv      text not null default '',
  refresh_token_tag     text not null default '',
  key_version           text not null default 'v1',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (project_id, provider, account_id)
);

create index if not exists idx_project_connections_project_id
  on public.project_connections (project_id);
create index if not exists idx_project_connections_project_provider
  on public.project_connections (project_id, provider);
create index if not exists idx_project_connections_expires_at
  on public.project_connections (expires_at);

alter table public.project_connections enable row level security;

-- ── project_connection_handoffs ─────────────────────────────────────────────
-- One OAuth grant often covers several postable accounts (a Facebook user who
-- manages four Pages, an IG login with two professional accounts). The callback
-- cannot ask which one to keep — it is a redirect with no UI — so it parks the
-- list here under a short-lived id and sends the browser somewhere that can ask.
--
-- This is the generalised form of project_oauth_handoffs, whose `pages` column
-- is Facebook-shaped. `accounts` holds the same idea for any provider. The
-- older table stays as it is until slice 2 ports the Facebook flow onto this one.
--
-- Rows are disposable by design: expires_at is minutes away, and a row that is
-- past it is treated as absent whether or not anything has swept it yet.

create table if not exists public.project_connection_handoffs (
  id             text primary key,
  project_id     text not null,
  -- owner_user_id is the tenant stamp scopedInsertRow writes; user_id is the
  -- person whose browser is mid-flow and who must be the one to choose. They
  -- are usually the same person and are still two different facts — see the
  -- note on connected_by_user_id above.
  owner_user_id  text,
  user_id        text not null,
  provider       text not null,
  -- [{ id, label, avatarUrl, accessToken }, ...] as the provider returned them.
  -- Short-lived and never rendered from cache, which is why this is not
  -- encrypted column-by-column the way project_connections is: the row exists
  -- for minutes and is deleted the moment a choice is made.
  accounts       jsonb not null default '[]'::jsonb,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_project_connection_handoffs_expires
  on public.project_connection_handoffs (expires_at);
create index if not exists idx_project_connection_handoffs_project_id
  on public.project_connection_handoffs (project_id);

alter table public.project_connection_handoffs enable row level security;
