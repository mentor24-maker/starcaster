-- Rename messaging content topic/category columns to topic where applicable.

alter table if exists public.messaging_headlines
  rename column category to topic;

alter table if exists public.messaging_subheadings
  rename column category to topic;

alter table if exists public.messaging_taglines
  rename column category to topic;

alter table if exists public.messaging_pitches
  rename column category to topic;

alter table if exists public.messaging_tweets
  rename column category to topic;

alter table if exists public.messaging_emails
  rename column category to topic;

alter table if exists public.messaging_posts
  rename column category to topic;

alter table if exists public.messaging_descriptions
  rename column category to topic;

alter table if exists public.messaging_transcripts
  rename column category to topic;

alter table if exists public.messaging_comments
  rename column category to topic;

alter table if exists public.messaging_ctas
  rename column category to topic;

alter table if exists public.messaging_articles
  add column if not exists topic text;

alter table if exists public.messaging_reports
  add column if not exists topic text;

alter table if exists public.messaging_white_papers
  add column if not exists topic text;

alter table if exists public.messaging_ebooks
  add column if not exists topic text;
