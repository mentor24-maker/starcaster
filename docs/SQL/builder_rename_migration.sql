-- ============================================================
-- Builder rename migration
-- Renames all develop_* database objects to builder_*
--
-- Run this in Supabase SQL editor (or psql) in one transaction.
-- ORDER MATTERS: drop triggers → rename functions → rename tables
--                → rename sequence → recreate triggers → rename indexes
-- ============================================================

begin;

-- ── 1. Drop existing triggers ────────────────────────────────

drop trigger if exists develop_email_templates_set_updated_at       on public.develop_email_templates;
drop trigger if exists trg_develop_forms_updated_at                  on public.develop_forms;
drop trigger if exists trg_develop_landing_page_updated_at           on public.develop_landing_page;
drop trigger if exists trg_develop_module_classes_updated_at         on public.develop_module_classes;
drop trigger if exists trg_develop_modules_updated_at                on public.develop_modules;
drop trigger if exists trg_develop_page_templates_updated_at         on public.develop_page_templates;
drop trigger if exists trg_develop_products_updated_at               on public.develop_products;
drop trigger if exists trg_develop_saved_sections_updated_at         on public.develop_saved_sections;
drop trigger if exists set_develop_extensions_updated_at             on public.develop_extensions;
drop trigger if exists set_develop_extensions_manager_updated_at     on public.develop_extensions_manager;

-- ── 2. Rename trigger functions ──────────────────────────────

alter function public.set_develop_email_templates_updated_at()  rename to set_builder_email_templates_updated_at;
alter function public.set_develop_forms_updated_at()            rename to set_builder_forms_updated_at;
alter function public.set_develop_landing_page_updated_at()     rename to set_builder_landing_page_updated_at;
alter function public.set_develop_module_classes_updated_at()   rename to set_builder_module_classes_updated_at;
alter function public.set_develop_modules_updated_at()          rename to set_builder_modules_updated_at;
alter function public.set_develop_page_templates_updated_at()   rename to set_builder_page_templates_updated_at;
alter function public.set_develop_products_updated_at()         rename to set_builder_products_updated_at;
alter function public.set_develop_saved_sections_updated_at()   rename to set_builder_saved_sections_updated_at;

-- ── 3. Rename tables ─────────────────────────────────────────

alter table if exists public.develop_email_templates    rename to builder_email_templates;
alter table if exists public.develop_extensions         rename to builder_extensions;
alter table if exists public.develop_extensions_manager rename to builder_extensions_manager;
alter table if exists public.develop_forms              rename to builder_forms;
alter table if exists public.develop_icons              rename to builder_icons;
alter table if exists public.develop_landing_page       rename to builder_landing_page;
alter table if exists public.develop_module_classes     rename to builder_module_classes;
alter table if exists public.develop_modules            rename to builder_modules;
alter table if exists public.develop_page_templates     rename to builder_page_templates;
alter table if exists public.develop_products           rename to builder_products;
alter table if exists public.develop_saved_sections     rename to builder_saved_sections;
alter table if exists public.develop_themes             rename to builder_themes;

-- ── 4. Rename sequence ───────────────────────────────────────

alter sequence if exists public.develop_themes_id_seq rename to builder_themes_id_seq;

-- ── 5. Recreate triggers on renamed tables ───────────────────

create trigger trg_builder_email_templates_updated_at
  before update on public.builder_email_templates
  for each row execute function public.set_builder_email_templates_updated_at();

create trigger trg_builder_forms_updated_at
  before update on public.builder_forms
  for each row execute function public.set_builder_forms_updated_at();

create trigger trg_builder_landing_page_updated_at
  before update on public.builder_landing_page
  for each row execute function public.set_builder_landing_page_updated_at();

create trigger trg_builder_module_classes_updated_at
  before update on public.builder_module_classes
  for each row execute function public.set_builder_module_classes_updated_at();

create trigger trg_builder_modules_updated_at
  before update on public.builder_modules
  for each row execute function public.set_builder_modules_updated_at();

create trigger trg_builder_page_templates_updated_at
  before update on public.builder_page_templates
  for each row execute function public.set_builder_page_templates_updated_at();

create trigger trg_builder_products_updated_at
  before update on public.builder_products
  for each row execute function public.set_builder_products_updated_at();

create trigger trg_builder_saved_sections_updated_at
  before update on public.builder_saved_sections
  for each row execute function public.set_builder_saved_sections_updated_at();

-- Extensions use the shared set_updated_at_timestamp() function
create trigger set_builder_extensions_updated_at
  before update on public.builder_extensions
  for each row execute function public.set_updated_at_timestamp();

create trigger set_builder_extensions_manager_updated_at
  before update on public.builder_extensions_manager
  for each row execute function public.set_updated_at_timestamp();

-- ── 6. Rename indexes ────────────────────────────────────────

-- forms
alter index if exists idx_develop_forms_project_id       rename to idx_builder_forms_project_id;
alter index if exists idx_develop_forms_owner_user_id    rename to idx_builder_forms_owner_user_id;

-- icons
alter index if exists idx_develop_icons_project_created  rename to idx_builder_icons_project_created;

-- landing pages
alter index if exists develop_landing_page_name_idx        rename to builder_landing_page_name_idx;
alter index if exists develop_landing_page_template_id_idx rename to builder_landing_page_template_id_idx;

-- module classes
alter index if exists idx_develop_module_classes_project_id rename to idx_builder_module_classes_project_id;

-- modules
alter index if exists idx_develop_modules_project_id    rename to idx_builder_modules_project_id;
alter index if exists idx_develop_modules_module_type   rename to idx_builder_modules_module_type;
alter index if exists idx_develop_modules_module_class  rename to idx_builder_modules_module_class;

-- page templates
alter index if exists idx_develop_page_templates_project_id  rename to idx_builder_page_templates_project_id;
alter index if exists idx_develop_page_templates_template_id rename to idx_builder_page_templates_template_id;
alter index if exists develop_page_templates_email_function_idx rename to builder_page_templates_email_function_idx;

-- email templates
alter index if exists develop_email_templates_kind_idx       rename to builder_email_templates_kind_idx;
alter index if exists develop_email_templates_updated_at_idx rename to builder_email_templates_updated_at_idx;

-- extensions
alter index if exists develop_extensions_featured_idx rename to builder_extensions_featured_idx;
alter index if exists develop_extensions_name_idx     rename to builder_extensions_name_idx;
alter index if exists develop_extensions_parent_idx   rename to builder_extensions_parent_idx;
alter index if exists develop_extensions_type_idx     rename to builder_extensions_type_idx;

-- products
alter index if exists idx_develop_products_project_id  rename to idx_builder_products_project_id;
alter index if exists idx_develop_products_product_type rename to idx_builder_products_product_type;

-- saved sections
alter index if exists idx_develop_saved_sections_project_id rename to idx_builder_saved_sections_project_id;
alter index if exists idx_develop_saved_sections_updated_at rename to idx_builder_saved_sections_updated_at;

-- themes
alter index if exists idx_develop_themes_project_id    rename to idx_builder_themes_project_id;
alter index if exists idx_develop_themes_owner_user_id rename to idx_builder_themes_owner_user_id;

commit;
