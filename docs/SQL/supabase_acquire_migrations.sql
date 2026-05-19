-- Run this exactly as is in your Supabase SQL Editor to globally transition to "acquire_youtube" and "topic"

-- Rename core tables
ALTER TABLE IF EXISTS public.harvest_youtube_details RENAME TO acquire_youtube_details;
ALTER TABLE IF EXISTS public.harvest_youtube_comments RENAME TO acquire_youtube_comments;
ALTER TABLE IF EXISTS public.harvest_youtube_categories RENAME TO acquire_youtube_topics;

-- Note: The harvest_youtube_videos table was discussed earlier, rename if it exists
ALTER TABLE IF EXISTS public.harvest_youtube_videos RENAME TO acquire_youtube_videos;

-- Rename legacy column "category" to "topic" in affected tables
ALTER TABLE IF EXISTS public.acquire_youtube_details RENAME COLUMN category TO topic;
ALTER TABLE IF EXISTS public.acquire_youtube_videos RENAME COLUMN category TO topic;
ALTER TABLE IF EXISTS public.acquire_youtube_topics RENAME COLUMN category TO topic;

-- Optional: Rebuild indexes to match the new naming scheme
ALTER INDEX IF EXISTS harvest_youtube_details_pkey RENAME TO acquire_youtube_details_pkey;
ALTER INDEX IF EXISTS harvest_youtube_details_created_at_idx RENAME TO acquire_youtube_details_created_at_idx;
ALTER INDEX IF EXISTS harvest_youtube_details_transcript_status_idx RENAME TO acquire_youtube_details_transcript_status_idx;
ALTER INDEX IF EXISTS harvest_youtube_details_category_idx RENAME TO acquire_youtube_details_topic_idx;

ALTER INDEX IF EXISTS harvest_youtube_categories_pkey RENAME TO acquire_youtube_topics_pkey;
ALTER INDEX IF EXISTS harvest_youtube_categories_category_idx RENAME TO acquire_youtube_topics_topic_idx;

ALTER INDEX IF EXISTS harvest_youtube_comments_pkey RENAME TO acquire_youtube_comments_pkey;
ALTER INDEX IF EXISTS harvest_youtube_comments_created_at_idx RENAME TO acquire_youtube_comments_created_at_idx;

ALTER INDEX IF EXISTS harvest_youtube_videos_pkey RENAME TO acquire_youtube_videos_pkey;
ALTER INDEX IF EXISTS harvest_youtube_videos_updated_at_idx RENAME TO acquire_youtube_videos_updated_at_idx;
ALTER INDEX IF EXISTS harvest_youtube_videos_video_id_idx RENAME TO acquire_youtube_videos_video_id_idx;
ALTER INDEX IF EXISTS harvest_youtube_videos_category_idx RENAME TO acquire_youtube_videos_topic_idx;
