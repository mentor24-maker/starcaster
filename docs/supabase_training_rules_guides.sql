create table if not exists public.training_rules_guides (
  user_id text not null,
  item_id text not null,
  type text not null check (type in ('rule', 'guide')),
  text text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, item_id)
);

create index if not exists training_rules_guides_user_idx
  on public.training_rules_guides (user_id, sort_order, type);
