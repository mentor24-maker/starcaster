-- Rename legacy messaging_categories table to messaging_topics

alter table if exists public.messaging_categories
  rename to messaging_topics;

alter index if exists public.idx_messaging_categories_category
  rename to idx_messaging_topics_topic;

drop trigger if exists trg_messaging_categories_updated_at on public.messaging_topics;
drop function if exists public.set_messaging_categories_updated_at();

alter table if exists public.messaging_topics
  rename column category to topic;

create index if not exists idx_messaging_topics_topic
  on public.messaging_topics (topic);

create or replace function public.set_messaging_topics_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_topics_updated_at on public.messaging_topics;
create trigger trg_messaging_topics_updated_at
before update on public.messaging_topics
for each row
execute function public.set_messaging_topics_updated_at();
