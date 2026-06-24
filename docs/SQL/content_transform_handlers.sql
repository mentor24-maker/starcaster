-- Global content transformation handlers.
-- Applied during HTML sanitization in the content extraction pipeline.
-- Not project-scoped — shared across all sites and projects.

create table if not exists public.content_transform_handlers (
  id           text        primary key,
  name         text        not null,
  description  text        not null default '',
  type         text        not null check (type in ('promote-h2','promote-h3','delete','strip-tag','find-replace','bold')),
  tag          text        not null default '',
  pattern      text        not null default '',
  replacement  text        not null default '',
  flags        text        not null default 'gi',
  enabled      boolean     not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.content_transform_handlers is
  'User-defined HTML transformation rules applied globally during content extraction. Not project-scoped.';

create index if not exists idx_content_transform_handlers_enabled
  on public.content_transform_handlers (enabled);
