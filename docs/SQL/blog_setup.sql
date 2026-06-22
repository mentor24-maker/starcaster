-- Blog module: categories, posts, and post-category join
-- Project-scoped (multi-tenant). Run once per environment.

-- ---------------------------------------------------------------------------
-- blog_categories
-- ---------------------------------------------------------------------------

create table if not exists public.blog_categories (
  id                  text        primary key,
  project_id          text        not null,
  owner_user_id       text,
  name                text        not null default '',
  slug                text        not null default '',
  description         text        not null default '',
  color               text        not null default '',   -- accent hex for pills/filters
  sort_order          int         not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_blog_categories_project_id
  on public.blog_categories (project_id);

-- slugs must be unique within a project (skip empty slugs during backfills)
create unique index if not exists idx_blog_categories_slug_project
  on public.blog_categories (project_id, slug)
  where slug <> '';

create or replace function public.set_blog_categories_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_blog_categories_updated_at on public.blog_categories;
create trigger trg_blog_categories_updated_at
  before update on public.blog_categories
  for each row execute function public.set_blog_categories_updated_at();

-- ---------------------------------------------------------------------------
-- blog_posts
-- ---------------------------------------------------------------------------

create table if not exists public.blog_posts (
  id                      text        primary key,
  project_id              text        not null,
  owner_user_id           text,

  -- content
  title                   text        not null default '',
  slug                    text        not null default '',
  status                  text        not null default 'draft',  -- draft | published | archived
  author                  text        not null default '',       -- display name
  author_user_id          text,                                  -- optional platform user link
  featured_image_url      text        not null default '',
  featured_image_asset_id text,                                  -- optional asset table reference
  excerpt                 text        not null default '',       -- short summary for cards/feeds
  body                    text        not null default '',       -- rich HTML body

  -- SEO
  seo_title               text        not null default '',
  seo_description         text        not null default '',

  -- taxonomy
  tags                    text[]      not null default '{}',

  -- meta
  reading_time_minutes    int,                                   -- null = not set; computed or manual
  published_at            timestamptz,                           -- null until published
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_blog_posts_project_id
  on public.blog_posts (project_id);

create index if not exists idx_blog_posts_status_project
  on public.blog_posts (project_id, status);

-- primary sort for feed queries
create index if not exists idx_blog_posts_published_at
  on public.blog_posts (project_id, published_at desc nulls last);

-- slugs must be unique within a project (skip empty slugs during backfills)
create unique index if not exists idx_blog_posts_slug_project
  on public.blog_posts (project_id, slug)
  where slug <> '';

create or replace function public.set_blog_posts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_blog_posts_updated_at on public.blog_posts;
create trigger trg_blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function public.set_blog_posts_updated_at();

-- ---------------------------------------------------------------------------
-- blog_post_categories  (many-to-many join)
-- ---------------------------------------------------------------------------

create table if not exists public.blog_post_categories (
  post_id       text not null references public.blog_posts(id)       on delete cascade,
  category_id   text not null references public.blog_categories(id)  on delete cascade,
  primary key (post_id, category_id)
);

create index if not exists idx_blog_post_categories_category_id
  on public.blog_post_categories (category_id);
