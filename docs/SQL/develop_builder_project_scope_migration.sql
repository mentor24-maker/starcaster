-- Project scope columns for new builder + game tables.

alter table if exists public.develop_saved_sections
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.develop_products
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_level_tiers
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_levels
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_rewards
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_scoring
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_level_up_rules
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_progressive_features
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.game_level_events
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

create index if not exists idx_develop_saved_sections_project_id on public.develop_saved_sections (project_id);
create index if not exists idx_develop_products_project_id on public.develop_products (project_id);
