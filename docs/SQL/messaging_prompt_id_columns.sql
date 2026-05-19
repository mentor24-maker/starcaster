alter table if exists public.messaging_headlines
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_subheadings
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_taglines
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_pitches
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_keywords
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_emails
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_tweets
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_posts
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_descriptions
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_transcripts
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_comments
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_hashtags
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_ctas
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_articles
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_reports
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_white_papers
  add column if not exists prompt_id bigint;

alter table if exists public.messaging_ebooks
  add column if not exists prompt_id bigint;
