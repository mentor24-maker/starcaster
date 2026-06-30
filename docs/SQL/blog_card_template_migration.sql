-- Per-project blog card template configuration.
-- One row per project; upserted when the admin saves from the Card Manager module.

create table if not exists public.blog_card_template (
  project_id   text        primary key,
  template     jsonb       not null default '{}',
  updated_at   timestamptz not null default now()
);
