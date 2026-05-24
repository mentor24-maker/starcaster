-- Superseded for hierarchical categories by docs/SQL/asset_categories_parent_category.sql
drop index if exists public.idx_asset_categories_type_category;
drop index if exists public.idx_asset_categories_project_type_category;

create unique index if not exists idx_asset_categories_project_type_parent_category
  on public.asset_categories(project_id, asset_type, lower(category), coalesce(parent_category_id, 0));
