-- Theme Styles → Page Background (distinct from page-level pageBackground in layout JSON).
-- Backfill from page_background when present.

alter table if exists public.builder_themes
  add column if not exists styles_page_background jsonb;

update public.builder_themes
set styles_page_background = page_background
where styles_page_background is null
  and page_background is not null;
