-- Hierarchical asset categories: optional parent points at another asset_categories row.
-- Apply manually per environment (no migration runner).

alter table if exists public.asset_categories
  add column if not exists parent_category_id bigint null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'asset_categories_parent_category_id_fkey'
  ) then
    alter table public.asset_categories
      add constraint asset_categories_parent_category_id_fkey
      foreign key (parent_category_id)
      references public.asset_categories (id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_asset_categories_parent_category_id
  on public.asset_categories (parent_category_id);

-- Same category name may exist under different parents; roots stay unique per type.
drop index if exists public.idx_asset_categories_project_type_category;
create unique index if not exists idx_asset_categories_project_type_parent_category
  on public.asset_categories (
    project_id,
    asset_type,
    lower(category),
    coalesce(parent_category_id, 0)
  );
