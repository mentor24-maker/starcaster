-- content_types: seed row for Web Pages (used by content_items.type_id FK).
-- Required columns: name, key, plural_name, family (NOT NULL).
-- family must satisfy content_types_family_check (slug values, not display labels).
--
-- To see allowed values in your DB:
--   select distinct family from public.content_types order by 1;

insert into public.content_types (name, key, plural_name, family)
select 'Web Pages', 'web-pages', 'Web Pages', 'long-form'
where not exists (
  select 1
  from public.content_types
  where lower(name) = lower('Web Pages')
     or lower(key) = lower('web-pages')
);
