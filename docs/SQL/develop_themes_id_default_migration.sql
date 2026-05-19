create sequence if not exists public.develop_themes_id_seq;

select setval(
  'public.develop_themes_id_seq',
  greatest(
    coalesce((select max(id) from public.develop_themes), 0),
    1
  ),
  true
);

alter table if exists public.develop_themes
  alter column id set default nextval('public.develop_themes_id_seq');
