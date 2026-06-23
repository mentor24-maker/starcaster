--- Add detected_model_id to direct_acquire_runs.
-- Populated automatically at crawl time by running detectModel() against
-- a sample page's raw HTML. Null means no registered model matched.

alter table public.direct_acquire_runs
  add column if not exists detected_model_id text null;

comment on column public.direct_acquire_runs.detected_model_id is
  'Content display model auto-detected at crawl time (e.g. duda-alternating-2col). Null if no model matched.';
