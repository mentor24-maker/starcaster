-- Topic and keyword names are unique per project, not globally.
--
-- messaging_topics began as messaging_categories: a single-tenant table of
-- reusable labels declared `category text not null unique`
-- (docs/SQL/messaging_categories_setup.sql). It was later renamed, the column
-- became `topic`, and a project_id was bolted on — but the global unique came
-- along untouched. Its name, messaging_categories_category_key, is the fossil.
--
-- Effect: the first project to create a topic named "Newsletter" permanently
-- stopped every other project from ever using that name, and the failure
-- surfaced to the operator as a raw Postgres duplicate-key error.
--
-- messaging_keywords carries the same shape in idx_messaging_keywords_keyword_topic,
-- even though the store writes through scopedInsertRow (lib/messagingKeywordsStore.js).
--
-- Both new indexes are strictly less restrictive than the ones they replace, so
-- they cannot fail on existing rows. Verified before writing: 84 topic rows and
-- 59 keyword rows, no NULL project_id, and zero pairs that would collide once
-- uniqueness is scoped per project.
--
-- NOT changed here, deliberately:
--   builder_extensions.slug is globally unique on purpose — extensions are
--   shared across every project and reads are intentionally unscoped. See the
--   comment above listExtensions() in lib/builderExtensionsStore.js.

-- messaging_topics: the unique is constraint-backed, so drop the constraint
-- (dropping the index directly would fail while the constraint owns it).
alter table public.messaging_topics
  drop constraint if exists messaging_categories_category_key;

create unique index if not exists idx_messaging_topics_project_topic
  on public.messaging_topics (project_id, topic)
  where project_id is not null
    and topic is not null
    and trim(topic) <> '';

-- messaging_keywords: a bare unique index, so drop it directly.
drop index if exists public.idx_messaging_keywords_keyword_topic;

create unique index if not exists idx_messaging_keywords_project_keyword_topic
  on public.messaging_keywords (project_id, keyword, coalesce(topic, ''))
  where project_id is not null
    and keyword is not null
    and trim(keyword) <> '';
