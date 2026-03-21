create table if not exists public.training_settings (
  user_id text primary key,
  explicit_isitas_percent integer not null default 50 check (explicit_isitas_percent >= 0 and explicit_isitas_percent <= 100),
  subtle_shared_framing_percent integer not null default 40 check (subtle_shared_framing_percent >= 0 and subtle_shared_framing_percent <= 100),
  generic_context_percent integer not null default 10 check (generic_context_percent >= 0 and generic_context_percent <= 100),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists training_settings_updated_at_idx
  on public.training_settings (updated_at desc);
