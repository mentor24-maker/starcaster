# YouTube media worker

A small service that downloads a YouTube video's `.mp4` and `.mp3` and uploads
both to Vercel Blob. StarCaster calls it; it does the heavy lifting.

## Why this exists

Vercel cannot do this job, and no amount of code changes that:

- its filesystem is read-only, so there is nowhere to write a 200MB download
- its functions time out long before a video finishes downloading
- YouTube blocks datacenter IPs, so requests from Vercel get refused anyway

So the download runs on a machine you control. It uploads the finished files
straight to Vercel Blob — they never pass back through StarCaster, which is
what keeps the whole thing inside the timeout.

## How the two halves talk

StarCaster starts a job and then polls it, because a download takes minutes and
no web request survives that long:

```
POST /jobs      { video_url, video_id, title, formats }  ->  { job_id, status }
GET  /jobs/:id                                           ->  { status, progress, mp4, mp3, error }
GET  /health                                             ->  { ok, ytdlp, ffmpeg, queued, running }
```

`status` moves `queued` → `running` → `done` or `failed`. The `mp4` and `mp3`
fields are filled in only on `done`, each `{ url, bytes, content_type }`.

Every route except `/health` requires `Authorization: Bearer <shared secret>`.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `WORKER_SHARED_SECRET` | **yes** | The password StarCaster sends. The worker refuses to start without one — an open worker is a free download service for anyone who finds it. |
| `BLOB_READ_WRITE_TOKEN` | **yes** | Vercel Blob token. The worker uploads with it directly. Use the same Blob store as StarCaster. |
| `PORT` | no | Default `8080`. |
| `BLOB_MEDIA_ROOT` | no | Folder prefix inside Blob. Default `APP/YouTube`. |
| `MAX_CONCURRENT_JOBS` | no | Default `2`. Raise only if the box has the bandwidth and disk. |
| `MAX_VIDEO_SECONDS` | no | Refuse anything longer. Default `5400` (90 min). Set `0` to disable. |
| `MAX_VIDEO_HEIGHT` | no | Cap resolution. Default `1080`, which keeps files sane. |
| `AUDIO_BITRATE` | no | mp3 bitrate. Default `192k`. |
| `YTDLP_COOKIES_FILE` | no | Path to a cookies file. See below — you will probably need this. |
| `JOB_TTL_MS` | no | How long finished jobs stay readable. Default 6 hours. |

## Deploying it

The Dockerfile is self-contained. On Fly.io:

```bash
cd workers/youtube-media
fly launch --no-deploy            # creates the app; accept the Dockerfile
fly secrets set WORKER_SHARED_SECRET="$(openssl rand -hex 32)"
fly secrets set BLOB_READ_WRITE_TOKEN="<your Vercel Blob token>"
fly deploy
```

Railway, Render, or any VPS with Docker work the same way. Give it at least
1GB RAM and a few GB of disk — ffmpeg needs room to work.

Then point StarCaster at it under **Settings → APIs → YouTube Media Worker
(yt-dlp)**: the worker's URL, and the same shared secret. Or set
`YOUTUBE_MEDIA_WORKER_URL` and `YOUTUBE_MEDIA_WORKER_TOKEN` as environment
variables in Vercel — note that changing an env var there needs a redeploy
before the running app sees it.

Check it came up:

```bash
curl https://<your-worker>/health
```

You want `"ok": true` with version strings for both `ytdlp` and `ffmpeg`.

## About the cookies file

YouTube treats hosted servers with suspicion and will often answer "Sign in to
confirm you're not a bot." The fix is a cookies file exported from a browser
where you are signed in, mounted into the container, with
`YTDLP_COOKIES_FILE` pointing at it.

Treat that file as a live credential — it is your logged-in session. Do not
commit it, and use a throwaway Google account rather than your main one.

## Keeping it working

yt-dlp breaks whenever YouTube changes its player, usually every few weeks.
The fix is nearly always to rebuild the image, which pulls the latest release:

```bash
fly deploy --no-cache
```

If downloads start failing across the board, check `/health` and rebuild before
looking anywhere else.

## Limits worth knowing

- Jobs live in memory. Restarting the worker loses in-flight jobs; the video's
  media status in StarCaster stays `queued` until you run it again.
- One worker, one queue. Two videos download at a time by default.
- Downloading YouTube media is against YouTube's Terms of Service. Reading
  titles, descriptions, and captions is not. Know which side you are on.
