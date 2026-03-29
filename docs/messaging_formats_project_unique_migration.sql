drop index if exists public.idx_messaging_formats_format;

create unique index if not exists idx_messaging_formats_project_format
  on public.messaging_formats (project_id, lower(format));
