create table if not exists public.training_taxonomy (
  user_id text not null,
  kind text not null check (kind in ('category', 'attribute', 'approach')),
  item_id text not null,
  name text not null,
  rationale text not null default '',
  value_rank integer not null default 3 check (value_rank between 1 and 5),
  match_hashtags jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, kind, item_id)
);

create index if not exists training_taxonomy_user_kind_idx
  on public.training_taxonomy (user_id, kind, sort_order, name);
