-- docs/segments_setup.sql
-- Setup script for defining Segment Types relative to channels/platforms.
-- Run this script in your Supabase SQL editor to create the reference table for Segment Types.

CREATE TABLE IF NOT EXISTS public.segment_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Default seeds for Segment Types
-- Shifting the CRM Segment paradigm to act as "Subsets of explicit Channels"

INSERT INTO public.segment_types (key, label, sort_order) VALUES
  ('email_list', 'Email List', 0),
  ('youtube_channel', 'YouTube Channel Audience', 1),
  ('youtube_comments', 'YouTube Commenters', 2),
  ('x_influencer', 'X/Twitter Influencer Core', 3),
  ('x_viral_post', 'X/Twitter Viral Engagement', 4),
  ('linkedin_audience', 'LinkedIn Target Audiences', 5),
  ('subreddit_community', 'Subreddit Micro-Community', 6),
  ('facebook_page', 'Facebook Page Audience', 7),
  ('instagram_followers', 'Instagram Core Followers', 8),
  ('discord_server', 'Discord Chat Community', 9),
  ('tiktok_audience', 'TikTok Creator Audience', 10),
  ('substack_subscribers', 'Substack Base', 11)
ON CONFLICT (key) DO NOTHING;
