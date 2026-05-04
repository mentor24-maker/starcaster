create table if not exists public.builder_polls (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  category text,
  order_index int default 0,
  is_published boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists public.builder_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.builder_polls (id) on delete cascade,
  label text not null,
  sort_order int default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.builder_poll_responses (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  poll_id uuid not null references public.builder_polls (id) on delete cascade,
  option_id uuid not null references public.builder_poll_options (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_builder_poll_options_poll_id on public.builder_poll_options(poll_id);
create index if not exists idx_builder_poll_responses_poll_id on public.builder_poll_responses(poll_id);
create index if not exists idx_builder_poll_responses_option_id on public.builder_poll_responses(option_id);
create index if not exists idx_builder_poll_responses_session_id on public.builder_poll_responses(session_id);
