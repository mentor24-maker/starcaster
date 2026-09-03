-- Blog post relations: hand-picked "related articles" links.
-- Project-scoped (multi-tenant). Run once per environment.
--
-- A relation is MUTUAL and undirected. It is stored as ONE row per pair, with
-- the two ids canonically ordered (post_id_a < post_id_b) by the application
-- before writing -- see lib/builder-client/blog-post-relations.ts. Storing it
-- undirected is what lets the unique index below actually prevent duplicates:
-- without the canonical order, (A,B) and (B,A) are two different rows and the
-- index never fires.
--
-- BOTH project_id and owner_user_id are present deliberately. A tenant-scoped
-- table carrying only project_id fails the lib/projectScope.js probe, and
-- scopedInsertRow then quietly stops stamping EITHER column -- the insert
-- succeeds, nothing errors, and the rows land with no tenant (CLAUDE.md
-- landmine 12; it cost twice on 2026-08-16).

create table if not exists public.blog_post_relations (
  id            text        primary key,
  project_id    text        not null,
  owner_user_id text,

  -- canonically ordered by the application: post_id_a < post_id_b
  post_id_a     text        not null references public.blog_posts(id) on delete cascade,
  post_id_b     text        not null references public.blog_posts(id) on delete cascade,

  created_at    timestamptz not null default now(),

  -- A post is never related to itself. Enforced here as well as in the
  -- application, because a self-row would be invisible in the UI and
  -- impossible to remove through it.
  constraint blog_post_relations_not_self check (post_id_a <> post_id_b),
  -- The canonical order is a storage invariant, not just a convention.
  constraint blog_post_relations_canonical_order check (post_id_a < post_id_b)
);

create index if not exists idx_blog_post_relations_project_id
  on public.blog_post_relations (project_id);

-- Both directions are looked up when rendering a post's related list.
create index if not exists idx_blog_post_relations_post_a
  on public.blog_post_relations (project_id, post_id_a);

create index if not exists idx_blog_post_relations_post_b
  on public.blog_post_relations (project_id, post_id_b);

-- One row per pair per project. Uniqueness is per-project, never global.
create unique index if not exists idx_blog_post_relations_pair_project
  on public.blog_post_relations (project_id, post_id_a, post_id_b);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Every table has RLS on since the 2026-08-18 lockdown, and a new table must
-- enable it too. Access is via the service key on the server, which bypasses
-- RLS; this is the deny-by-default floor for anything else.

alter table public.blog_post_relations enable row level security;
