-- Game layer tables (ported from Normie; project-scoped for StarCaster multitenancy).

create table if not exists public.game_level_tiers (
  id uuid primary key default gen_random_uuid(),
  level integer not null check (level > 0),
  tier text not null,
  name text not null,
  points_required integer not null default 0 check (points_required >= 0),
  sort_order integer not null default 0,
  perks jsonb not null default '[]'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, level, tier)
);

create table if not exists public.game_levels (
  id uuid primary key default gen_random_uuid(),
  level_name text not null check (level_name in ('Level', 'Grade', 'Class', 'Stage', 'Phase', 'Degree', 'Plane', 'Echelon', 'Tier')),
  level_order integer not null check (level_order between 1 and 10),
  game_level_levels jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  reward_type text not null default 'custom' check (reward_type in ('badge', 'digital', 'access', 'feature', 'merch', 'token', 'custom')),
  reward_order integer not null default 1 check (reward_order >= 1),
  points_cost integer not null default 0 check (points_cost >= 0),
  inventory_count integer check (inventory_count is null or inventory_count >= 0),
  status text not null default 'draft' check (status in ('active', 'draft', 'archived')),
  image_url text not null default '',
  redemption_url text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_scoring (
  id uuid primary key default gen_random_uuid(),
  score_name text not null,
  description text not null default '',
  specific_criteria text not null default '',
  points integer not null default 0 check (points >= 0),
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_level_up_rules (
  id uuid primary key default gen_random_uuid(),
  level_name text not null check (level_name in ('Level', 'Grade', 'Class', 'Stage', 'Phase', 'Degree', 'Plane', 'Echelon', 'Tier')),
  sublevel_name text not null,
  criteria jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_progressive_features (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null,
  name text not null,
  description text not null default '',
  unlock_level_name text not null check (unlock_level_name in ('Level', 'Grade', 'Class', 'Stage', 'Phase', 'Degree', 'Plane', 'Echelon', 'Tier')),
  unlock_sublevel_name text not null default '',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, feature_key)
);

create table if not exists public.game_level_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  level_name text not null check (level_name in ('Level', 'Grade', 'Class', 'Stage', 'Phase', 'Degree', 'Plane', 'Echelon', 'Tier')),
  sublevel_name text not null default '',
  module_id text references public.develop_modules(id) on delete set null,
  trigger text not null default 'game' check (trigger in ('game')),
  audience text not null default 'both' check (audience in ('public', 'portal', 'both')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_game_level_tiers_project_id on public.game_level_tiers (project_id);
create index if not exists idx_game_levels_project_id on public.game_levels (project_id);
create index if not exists idx_game_rewards_project_id on public.game_rewards (project_id);
create index if not exists idx_game_scoring_project_id on public.game_scoring (project_id);
create index if not exists idx_game_level_up_rules_project_id on public.game_level_up_rules (project_id);
create index if not exists idx_game_progressive_features_project_id on public.game_progressive_features (project_id);
create index if not exists idx_game_level_events_project_id on public.game_level_events (project_id);
create index if not exists idx_game_level_events_module_id on public.game_level_events (module_id);
create index if not exists idx_game_level_events_target on public.game_level_events (level_name, sublevel_name);
