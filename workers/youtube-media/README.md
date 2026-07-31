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

## Deploying it — the short version

Seven commands, start to finish. `fly.toml` is committed, so there is no setup
wizard to answer. Run these from this folder.

**1. Install the Fly command-line tool** (once per machine):

```bash
brew install flyctl
```

**2. Sign in** — opens a browser; create the account there if you don't have one:

```bash
fly auth login
```

**3. Create the app.** The name must be globally unique, so if this one is
taken, pick another and change `app =` at the top of `fly.toml` to match:

```bash
fly apps create starcaster-yt-media
```

**4. Make up a password for the worker and save it where you keep passwords.**
This is how StarCaster proves it's allowed to use the worker. Print one:

```bash
openssl rand -hex 32
```

**5. Give the worker its two secrets**, pasting the password from step 4 and
your Vercel Blob token (Vercel dashboard → Storage → your Blob store → Tokens):

```bash
fly secrets set WORKER_SHARED_SECRET="paste-step-4-here"
fly secrets set BLOB_READ_WRITE_TOKEN="paste-blob-token-here"
```

**6. Deploy.** First run takes a few minutes — it's building the image:

```bash
fly deploy
```

**7. Check it's alive:**

```bash
curl https://starcaster-yt-media.fly.dev/health
```

You want `"ok": true` and version numbers next to `ytdlp` and `ffmpeg`. If
either is empty, the image built wrong — run `fly deploy --no-cache`.

**Last step, in StarCaster:** Settings → APIs → **YouTube Media Worker
(yt-dlp)**. Worker URL is `https://starcaster-yt-media.fly.dev`, Shared Secret
is the password from step 4. Save, then acquire a short video with "Download
.mp4 and .mp3 files" ticked.

### If you'd rather not use Fly

Any host that runs a Docker container works — Railway, Render, a VPS. Give it
at least 1GB RAM and a few GB of disk, set the same two environment variables,
and point StarCaster at its URL.

You can also set `YOUTUBE_MEDIA_WORKER_URL` and `YOUTUBE_MEDIA_WORKER_TOKEN` as
environment variables in Vercel instead of using the Settings screen — but
changing an env var there does nothing until you redeploy.

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
