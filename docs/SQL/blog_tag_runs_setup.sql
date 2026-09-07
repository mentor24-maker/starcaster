-- Blog auto-tag runs: what one click of the Auto-tag extension ADDED, so the
-- same run can be undone with one click (ticket 86bbw4dch, slice 2 of 3).
-- Project-scoped (multi-tenant). Run once per environment.
--
-- One row per post the run touched, holding ONLY the tags the run added --
-- never the tags the author already had. Undo removes exactly tags_added and
-- nothing else, so a tag the author added by hand between run and undo stays.
--
-- BOTH project_id and owner_user_id are present deliberately. A tenant-scoped
-- table carrying only project_id fails the lib/projectScope.js probe, and
-- scopedInsertRow then quietly stops stamping EITHER column -- the insert
-- succeeds, nothing errors, and the rows land with no tenant (CLAUDE.md
-- landmine 12; it cost twice on 2026-08-16).

create table if not exists public.blog_tag_runs (
  id            text        primary key,
  project_id    text        not null,
  owner_user_id text,

  run_id        text        not null,
  post_id       text        not null references public.blog_posts(id) on delete cascade,
  tags_added    text[]      not null default '{}',

  created_at    timestamptz not null default now(),
  undone_at     timestamptz
);

-- A run is read back whole, by project, for its results panel and its undo.
create index if not exists idx_blog_tag_runs_project_run
  on public.blog_tag_runs (project_id, run_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Every table has RLS on since the 2026-08-18 lockdown, and a new table must
-- enable it too. Access is via the service key on the server, which bypasses
-- RLS; this is the deny-by-default floor for anything else.

alter table public.blog_tag_runs enable row level security;
