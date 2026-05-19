alter table if exists public.messaging_topics
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_formats
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_tags
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_keywords
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_headlines
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_subheadings
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_taglines
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_pitches
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_articles
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_reports
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_white_papers
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_ebooks
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_tweets
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_emails
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_posts
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_descriptions
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_transcripts
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_comments
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_hashtags
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table if exists public.messaging_ctas
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

create index if not exists idx_messaging_topics_project_id on public.messaging_topics (project_id);
create index if not exists idx_messaging_formats_project_id on public.messaging_formats (project_id);
create index if not exists idx_messaging_tags_project_id on public.messaging_tags (project_id);
create index if not exists idx_messaging_keywords_project_id on public.messaging_keywords (project_id);
create index if not exists idx_messaging_headlines_project_id on public.messaging_headlines (project_id);
create index if not exists idx_messaging_subheadings_project_id on public.messaging_subheadings (project_id);
create index if not exists idx_messaging_taglines_project_id on public.messaging_taglines (project_id);
create index if not exists idx_messaging_pitches_project_id on public.messaging_pitches (project_id);
create index if not exists idx_messaging_articles_project_id on public.messaging_articles (project_id);
create index if not exists idx_messaging_reports_project_id on public.messaging_reports (project_id);
create index if not exists idx_messaging_white_papers_project_id on public.messaging_white_papers (project_id);
create index if not exists idx_messaging_ebooks_project_id on public.messaging_ebooks (project_id);
create index if not exists idx_messaging_tweets_project_id on public.messaging_tweets (project_id);
create index if not exists idx_messaging_emails_project_id on public.messaging_emails (project_id);
create index if not exists idx_messaging_posts_project_id on public.messaging_posts (project_id);
create index if not exists idx_messaging_descriptions_project_id on public.messaging_descriptions (project_id);
create index if not exists idx_messaging_transcripts_project_id on public.messaging_transcripts (project_id);
create index if not exists idx_messaging_comments_project_id on public.messaging_comments (project_id);
create index if not exists idx_messaging_hashtags_project_id on public.messaging_hashtags (project_id);
create index if not exists idx_messaging_ctas_project_id on public.messaging_ctas (project_id);

drop index if exists public.idx_messaging_formats_format;
create unique index if not exists idx_messaging_formats_project_format
  on public.messaging_formats (project_id, lower(format));
