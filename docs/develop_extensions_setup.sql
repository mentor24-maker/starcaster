create table if not exists public.develop_extensions (
  id bigserial primary key,
  slug text not null unique,
  name text not null default '',
  extension_type text not null default 'custom',
  parent_id bigint null references public.develop_extensions(id) on delete set null,
  status text not null default 'active',
  tags text not null default '',
  summary text not null default '',
  definition text not null default '',
  launch_page_id text not null default '',
  is_featured boolean not null default false,
  usage_count integer not null default 0,
  last_used_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists develop_extensions_name_idx
  on public.develop_extensions (name);

create index if not exists develop_extensions_type_idx
  on public.develop_extensions (extension_type);

create index if not exists develop_extensions_parent_idx
  on public.develop_extensions (parent_id);

create index if not exists develop_extensions_featured_idx
  on public.develop_extensions (is_featured, usage_count desc, updated_at desc);

create table if not exists public.develop_extensions_manager (
  id bigserial primary key,
  manager_key text not null unique default 'default',
  default_filters jsonb not null default '{}'::jsonb,
  default_sort_key text not null default 'updatedAt',
  default_sort_dir text not null default 'desc',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_develop_extensions_updated_at on public.develop_extensions;
create trigger set_develop_extensions_updated_at
before update on public.develop_extensions
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists set_develop_extensions_manager_updated_at on public.develop_extensions_manager;
create trigger set_develop_extensions_manager_updated_at
before update on public.develop_extensions_manager
for each row
execute function public.set_updated_at_timestamp();

insert into public.develop_extensions (
  slug,
  name,
  extension_type,
  status,
  tags,
  summary,
  definition,
  launch_page_id,
  is_featured,
  usage_count
)
values (
  'icon-builder',
  'Icon Builder',
  'generator',
  'active',
  'icons, graphics, branding',
  'Generate compact object icons for use throughout the platform.',
  'Creates small reusable icons for messages, assets, campaigns, channels, and related system objects.',
  'developExtensionIconBuilderPage',
  true,
  1
)
on conflict (slug) do update
set
  name = excluded.name,
  extension_type = excluded.extension_type,
  status = excluded.status,
  tags = excluded.tags,
  summary = excluded.summary,
  definition = excluded.definition,
  launch_page_id = excluded.launch_page_id,
  is_featured = excluded.is_featured;

insert into public.develop_extensions (
  slug,
  name,
  extension_type,
  status,
  tags,
  summary,
  definition,
  launch_page_id,
  is_featured,
  usage_count
)
values (
  'screenshot',
  'Screenshot',
  'utility',
  'active',
  'screenshots, capture, website',
  'Capture a screenshot, upload it to Drive, and store it as a 640x360 Image asset in category Screenshot.',
  'Generates a standardized website screenshot from a pasted URL, uploads the image into Google Drive, and saves it into the asset library as type Image with category Screenshot.',
  'developExtensionScreenshotPage',
  true,
  1
)
on conflict (slug) do update
set
  name = excluded.name,
  extension_type = excluded.extension_type,
  status = excluded.status,
  tags = excluded.tags,
  summary = excluded.summary,
  definition = excluded.definition,
  launch_page_id = excluded.launch_page_id,
  is_featured = excluded.is_featured;

insert into public.develop_extensions_manager (
  manager_key,
  default_filters,
  default_sort_key,
  default_sort_dir
)
values (
  'default',
  '{}'::jsonb,
  'updatedAt',
  'desc'
)
on conflict (manager_key) do nothing;
