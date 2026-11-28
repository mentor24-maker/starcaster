-- FEATURE: email sent to an address on one of our domains (admin@alphire.agency first) is not forwarded anywhere, so it is lost
--
-- SC-926: StarCaster receives email for a project's domain through Resend and
-- forwards each message, attachments included, to a real inbox. Resend calls
-- POST /api/webhooks/resend/inbound when mail arrives; routes/inboundEmail.js
-- checks the call is really Resend's, and lib/resendInbound.js does the rest.
--
--   inbound_email_routes      one row per address we receive: where it
--                             forwards to, and whether it is switched on.
--                             An address belongs to exactly one project, so
--                             `address` is unique across all of them.
--   inbound_email_deliveries  one row per webhook delivery Resend made, keyed
--                             by its svix-id. Resend retries a delivery with
--                             the SAME svix-id, so a second call for one id
--                             finds this row and forwards nothing.
--
-- Message bodies are never stored. A delivery row keeps who, to whom, the
-- subject and what happened (outcome / error), which is what lets a failed
-- forward be seen and retried rather than silently dropped.
--
-- BOTH tenant columns on BOTH tables (CLAUDE.md landmine 12). A delivery for
-- an address with no route has no project to name, so on that table they may
-- be null; a delivery that matched a route carries the route's project and
-- owner. project_id is text, never uuid (DOCTRINE 5.13).
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown.
-- All access goes through the Node server with the service key.
--
-- Until this file runs, the webhook answers 503 and says the tables are
-- missing; Resend keeps retrying, so nothing is lost while it waits.
--
-- Safe to run twice: every statement is create-if-missing.

create table if not exists public.inbound_email_routes (
  id              uuid        primary key default gen_random_uuid(),
  project_id      text        not null,
  owner_user_id   text,
  address         text        not null,
  forward_to      text        not null,
  enabled         boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists inbound_email_routes_address_key
  on public.inbound_email_routes (address);

alter table public.inbound_email_routes enable row level security;

create table if not exists public.inbound_email_deliveries (
  id                    uuid        primary key default gen_random_uuid(),
  svix_id               text        not null unique,
  project_id            text,
  owner_user_id         text,
  resend_email_id       text        not null default '',
  to_address            text        not null default '',
  from_address          text        not null default '',
  subject               text        not null default '',
  received_at           timestamptz,
  -- received   being handled now (or a pass died mid-way; retried after 2 min)
  -- forwarded  sent on to the route's inbox
  -- no_route   no enabled route for any recipient; nothing sent
  -- refused    would have looped back into one of our own addresses
  -- failed     fetching or sending failed; Resend will retry
  outcome               text        not null default 'received'
                        check (outcome in ('received', 'forwarded', 'no_route', 'refused', 'failed')),
  error                 text        not null default '',
  attempts              integer     not null default 1,
  forwarded_email_id    text        not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.inbound_email_deliveries enable row level security;
