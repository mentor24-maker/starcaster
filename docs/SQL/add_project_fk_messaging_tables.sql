-- add_project_fk_messaging_tables.sql
-- Adds project_id + owner_user_id columns and FK constraints
-- to all messaging_* tables, scoping messaging content to projects.
--
-- Follows the established pattern from add_project_fk_constraints.sql.
-- Safe to re-run: uses IF NOT EXISTS for columns and DO-block guards
-- for constraints.

begin;

-- ════════════════════════════════════════════════════════════════════
-- Step 1: Add project_id and owner_user_id columns to all tables.
-- ════════════════════════════════════════════════════════════════════

alter table public.messaging_topics        add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_formats       add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_tags          add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_prompts       add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_keywords      add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_headlines     add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_subheadings   add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_taglines      add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_pitches       add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_emails        add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_tweets        add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_posts         add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_descriptions  add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_transcripts   add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_comments      add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_hashtags      add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_ctas          add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_articles      add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_reports       add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_white_papers  add column if not exists project_id text, add column if not exists owner_user_id text;
alter table public.messaging_ebooks        add column if not exists project_id text, add column if not exists owner_user_id text;

-- ════════════════════════════════════════════════════════════════════
-- Step 2: Clean any orphaned project_id values (defensive — columns
-- are new so these should be empty, but safe to include).
-- ════════════════════════════════════════════════════════════════════

update public.messaging_topics        set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_formats       set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_tags          set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_prompts       set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_keywords      set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_headlines     set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_subheadings   set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_taglines      set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_pitches       set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_emails        set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_tweets        set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_posts         set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_descriptions  set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_transcripts   set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_comments      set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_hashtags      set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_ctas          set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_articles      set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_reports       set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_white_papers  set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);
update public.messaging_ebooks        set project_id = null where project_id is not null and project_id not in (select id from public.app_projects);

-- ════════════════════════════════════════════════════════════════════
-- Step 3: Add FK constraints — project_id → app_projects(id)
-- ════════════════════════════════════════════════════════════════════

-- messaging_topics
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_topics_project_id'
      and table_schema = 'public' and table_name = 'messaging_topics'
  ) then
    alter table public.messaging_topics
      add constraint fk_messaging_topics_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_formats
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_formats_project_id'
      and table_schema = 'public' and table_name = 'messaging_formats'
  ) then
    alter table public.messaging_formats
      add constraint fk_messaging_formats_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_tags
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_tags_project_id'
      and table_schema = 'public' and table_name = 'messaging_tags'
  ) then
    alter table public.messaging_tags
      add constraint fk_messaging_tags_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_prompts
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_prompts_project_id'
      and table_schema = 'public' and table_name = 'messaging_prompts'
  ) then
    alter table public.messaging_prompts
      add constraint fk_messaging_prompts_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_keywords
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_keywords_project_id'
      and table_schema = 'public' and table_name = 'messaging_keywords'
  ) then
    alter table public.messaging_keywords
      add constraint fk_messaging_keywords_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_headlines
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_headlines_project_id'
      and table_schema = 'public' and table_name = 'messaging_headlines'
  ) then
    alter table public.messaging_headlines
      add constraint fk_messaging_headlines_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_subheadings
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_subheadings_project_id'
      and table_schema = 'public' and table_name = 'messaging_subheadings'
  ) then
    alter table public.messaging_subheadings
      add constraint fk_messaging_subheadings_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_taglines
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_taglines_project_id'
      and table_schema = 'public' and table_name = 'messaging_taglines'
  ) then
    alter table public.messaging_taglines
      add constraint fk_messaging_taglines_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_pitches
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_pitches_project_id'
      and table_schema = 'public' and table_name = 'messaging_pitches'
  ) then
    alter table public.messaging_pitches
      add constraint fk_messaging_pitches_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_emails
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_emails_project_id'
      and table_schema = 'public' and table_name = 'messaging_emails'
  ) then
    alter table public.messaging_emails
      add constraint fk_messaging_emails_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_tweets
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_tweets_project_id'
      and table_schema = 'public' and table_name = 'messaging_tweets'
  ) then
    alter table public.messaging_tweets
      add constraint fk_messaging_tweets_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_posts
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_posts_project_id'
      and table_schema = 'public' and table_name = 'messaging_posts'
  ) then
    alter table public.messaging_posts
      add constraint fk_messaging_posts_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_descriptions
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_descriptions_project_id'
      and table_schema = 'public' and table_name = 'messaging_descriptions'
  ) then
    alter table public.messaging_descriptions
      add constraint fk_messaging_descriptions_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_transcripts
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_transcripts_project_id'
      and table_schema = 'public' and table_name = 'messaging_transcripts'
  ) then
    alter table public.messaging_transcripts
      add constraint fk_messaging_transcripts_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_comments
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_comments_project_id'
      and table_schema = 'public' and table_name = 'messaging_comments'
  ) then
    alter table public.messaging_comments
      add constraint fk_messaging_comments_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_hashtags
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_hashtags_project_id'
      and table_schema = 'public' and table_name = 'messaging_hashtags'
  ) then
    alter table public.messaging_hashtags
      add constraint fk_messaging_hashtags_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_ctas
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_ctas_project_id'
      and table_schema = 'public' and table_name = 'messaging_ctas'
  ) then
    alter table public.messaging_ctas
      add constraint fk_messaging_ctas_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_articles
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_articles_project_id'
      and table_schema = 'public' and table_name = 'messaging_articles'
  ) then
    alter table public.messaging_articles
      add constraint fk_messaging_articles_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_reports
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_reports_project_id'
      and table_schema = 'public' and table_name = 'messaging_reports'
  ) then
    alter table public.messaging_reports
      add constraint fk_messaging_reports_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_white_papers
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_white_papers_project_id'
      and table_schema = 'public' and table_name = 'messaging_white_papers'
  ) then
    alter table public.messaging_white_papers
      add constraint fk_messaging_white_papers_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- messaging_ebooks
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_messaging_ebooks_project_id'
      and table_schema = 'public' and table_name = 'messaging_ebooks'
  ) then
    alter table public.messaging_ebooks
      add constraint fk_messaging_ebooks_project_id
      foreign key (project_id) references public.app_projects(id) on delete set null;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- Step 4 (Optional): Backfill existing rows to a specific project.
-- Uncomment and replace 'YOUR_PROJECT_ID_HERE' with the target
-- project's id from app_projects before running.
-- ════════════════════════════════════════════════════════════════════

-- update public.messaging_topics        set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_formats       set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_tags          set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_prompts       set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_keywords      set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_headlines     set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_subheadings   set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_taglines      set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_pitches       set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_emails        set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_tweets        set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_posts         set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_descriptions  set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_transcripts   set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_comments      set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_hashtags      set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_ctas          set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_articles      set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_reports       set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_white_papers  set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;
-- update public.messaging_ebooks        set project_id = 'YOUR_PROJECT_ID_HERE' where project_id is null;

commit;
