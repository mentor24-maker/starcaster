-- content_types: seed row for Web Pages mirror into content_items.
-- content_items.type_id references content_types(id), not messaging_formats.
-- Run after confirming the FK in Supabase:
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'content_items_type_id_fkey';

insert into public.content_types (name, project_id)
select 'Web Pages', 'YOUR_PROJECT_ID'
where not exists (
  select 1
  from public.content_types
  where lower(name) = lower('Web Pages')
    and project_id = 'YOUR_PROJECT_ID'
);

-- Replace YOUR_PROJECT_ID with the project id from the app switcher (e.g. vvtahaxqrzudrzyfvfej).
-- If content_types has no project_id column, use only:
--   insert into public.content_types (name)
--   select 'Web Pages' where not exists (select 1 from public.content_types where lower(name) = lower('Web Pages'));
