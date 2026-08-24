-- Downloaded media (.mp4 / .mp3) for acquired YouTube videos.
--
-- The files themselves live in Vercel Blob; these columns only hold the
-- public URLs plus the state of the download job that produced them. The
-- job runs on the self-hosted yt-dlp worker (workers/youtube-media), because
-- Vercel cannot download or transcode video itself.

alter table public.acquire_youtube_videos
  add column if not exists media_status text not null default 'none';

alter table public.acquire_youtube_videos
  add column if not exists media_job_id text not null default '';

alter table public.acquire_youtube_videos
  add column if not exists media_mp4_url text not null default '';

alter table public.acquire_youtube_videos
  add column if not exists media_mp3_url text not null default '';

alter table public.acquire_youtube_videos
  add column if not exists media_error text not null default '';

update public.acquire_youtube_videos
set media_status = 'none'
where media_status is null
   or trim(media_status) = ''
   or media_status not in ('none', 'queued', 'running', 'done', 'failed');

alter table public.acquire_youtube_videos
  drop constraint if exists acquire_youtube_videos_media_status_check;

alter table public.acquire_youtube_videos
  add constraint acquire_youtube_videos_media_status_check
  check (media_status in ('none', 'queued', 'running', 'done', 'failed'));

-- Polling looks up in-flight jobs by id; everything else reads by video.
create index if not exists acquire_youtube_videos_media_job_idx
  on public.acquire_youtube_videos (media_job_id)
  where media_job_id <> '';
