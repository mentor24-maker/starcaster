-- content_types: seed row for Web Pages (used by content_items.type_id FK).
-- Required columns on this table include name and key (NOT NULL).

insert into public.content_types (name, key)
select 'Web Pages', 'web-pages'
where not exists (
  select 1
  from public.content_types
  where lower(name) = lower('Web Pages')
     or lower(key) = lower('web-pages')
);
