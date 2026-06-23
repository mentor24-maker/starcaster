create table if not exists public.builder_page_snapshots (
  id bigserial primary key,
  project_id text not null default '',
  label text not null default '',
  page_count integer not null default 0,
  pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists builder_page_snapshots_project_id_idx
  on public.builder_page_snapshots (project_id);

create index if not exists builder_page_snapshots_created_at_idx
  on public.builder_page_snapshots (created_at desc);
