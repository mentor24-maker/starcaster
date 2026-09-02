# The YouTube media worker

A small always-on service that does the one job Vercel cannot: run `yt-dlp` to
download a video, transcode an `.mp3` with `ffmpeg`, and upload both files
straight to Vercel Blob. StarCaster only ever exchanges small JSON messages
with it — the media never passes through a serverless function.

**It runs on the Mac Mini.** Dane chose that over a rented server on
2026-08-24 (ticket `86bbjve6b`), and the reason is the address: YouTube blocks
datacenter IPs, which is the whole reason this work cannot live on Vercel in
the first place. The Mini reaches YouTube over an ordinary home internet
connection, which is the exact kind that is not blocked — so no cookies file,
no logged-in YouTube account sitting on a rented box, and no monthly bill. The
trade Dane accepted: **while the Mini is asleep or the house internet is down,
downloads wait.** Everything else in StarCaster carries on; the acquire panel
reports the worker as unreachable and the title/transcript half still works.

Which machine may run it is recorded in `lib/nodeRoles.js` (`youtube-media`),
the same table that decides where the bus relay runs. Running two copies is
not a spare — see that file for why it breaks quietly.

> Downloading YouTube media violates YouTube's Terms of Service. (Reading
> titles, descriptions and captions does not.) Dane was told this on
> 2026-07-30 and chose to proceed. This note is here so the next person to
> read this file learns it from the file rather than from a lawyer.

---

## What it speaks

Three endpoints. `/health` is open; the other two require the shared secret as
a bearer token.

| Request | Answer |
|---|---|
| `GET /health` | `{ ok, ytdlp, ffmpeg, queued, running }` — `200` when both programs are present, `503` when either is missing |
| `POST /jobs` | `{ job_id, status }` — returns **immediately** (`202`), before any downloading starts |
| `GET /jobs/:id` | `{ status, progress, mp4, mp3, error }` — `status` is `queued`, `running`, `done` or `failed` |

`POST /jobs` takes `{ video_url, video_id, title, formats }`. `formats`
defaults to `["mp4","mp3"]`. A missing or wrong bearer token is `401`.

The other end of this wire is `lib/acquire/YoutubeMediaWorker.js` (slice 1),
which is already written and expects exactly these shapes.

---

## Deploying it on the Mac Mini

Nine steps, in order. Steps 4 and 8 need Dane; an agent session can run every
other one.

### 1. Install the two programs it shells out to

Neither is on the Mini today.

```bash
brew install yt-dlp ffmpeg
yt-dlp --version && ffmpeg -version | head -1
```

`yt-dlp` goes stale faster than anything else here — YouTube changes and it
gets patched within days. When downloads start failing for no visible reason,
`brew upgrade yt-dlp` is the first thing to try, not the last.

### 2. Get the code onto the Mini

The worker lives in the StarCaster checkout and needs its own dependencies —
it is a separate little program with its own `package.json`, not part of the
main app's build.

```bash
cd ~/WebApps/starcaster && git pull
cd workers/youtube-media && npm install
```

### 3. Decide the port

`8080` unless something on the Mini already answers there. Check:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Silence means it is free. Whatever you pick, it has to match the URL in
step 8.

### 4. The shared secret — Dane's keystroke

This is the one value that proves a request came from StarCaster and not from
the open internet. It exists in exactly two places: this worker's environment,
and the Settings > APIs record in step 8. **Nothing else should ever hold a
copy, and it must not be pasted into a ticket, a commit, or a chat message.**

Generate one:

```bash
openssl rand -hex 32
```

Dane keeps that value and uses it in steps 5 and 8. An agent session may run
the command that *generates* it but must not read the output back anywhere it
is recorded — that is the rule in `docs/DOCTRINE.md` §4.1.

You also need `BLOB_READ_WRITE_TOKEN`, the same Vercel Blob token the main app
uses. It is in Doppler (`starcaster` / `prd`); it is a live credential and it
is Dane's to move.

### 5. Write the environment file

```bash
cat > ~/Library/Application\ Support/starcaster-youtube-media.env <<'EOF'
WORKER_SHARED_SECRET=<the value from step 4>
BLOB_READ_WRITE_TOKEN=<the Vercel Blob token>
PORT=8080
EOF
chmod 600 ~/Library/Application\ Support/starcaster-youtube-media.env
```

`chmod 600` is not decoration — it is what stops every other account on the
machine from reading both secrets.

The worker **refuses to start** without either value, rather than starting up
unauthenticated or with nowhere to upload. That refusal is the feature; if it
exits immediately on step 7, read the log before assuming something is broken.

Optional settings, all with working defaults: `BLOB_MEDIA_ROOT`
(`APP/YouTube`), `MAX_CONCURRENT_JOBS` (`2`), `MAX_VIDEO_SECONDS` (`5400`),
`MAX_VIDEO_HEIGHT` (`1080`), `AUDIO_BITRATE` (`192k`), `JOB_TTL_MS` (6 hours),
`YTDLP_PATH`, `FFMPEG_PATH`.

### 6. Prove it runs by hand before automating it

Never install a background job you have not watched work once.

```bash
cd ~/WebApps/starcaster/workers/youtube-media
set -a && . ~/Library/Application\ Support/starcaster-youtube-media.env && set +a
node server.js
```

It should print `youtube-media worker listening on :8080`. In another window:

```bash
curl -s localhost:8080/health                                   # {"ok":true,...}
curl -s -X POST localhost:8080/jobs -d '{"video_url":"..."}'    # {"error":"Unauthorized"}
```

The second one **must** be refused — that is the auth check working. Then with
the secret:

```bash
SECRET=<the value from step 4>
curl -s -X POST localhost:8080/jobs \
  -H "authorization: Bearer $SECRET" -H 'content-type: application/json' \
  -d '{"video_url":"https://www.youtube.com/watch?v=<a SHORT video>"}'
# -> {"job_id":"...","status":"queued"}

curl -s localhost:8080/jobs/<job_id> -H "authorization: Bearer $SECRET"
# poll until "status":"done", then check the mp4 and mp3 URLs it hands back
```

Use a short video. A three-minute clip finishes in under a minute; a
two-hour one will have you wondering whether it hung.

Stop it with Ctrl-C when you are satisfied.

### 7. Install it as a background job

Unlike the relay and the weekly report, this is a **service that stays up**,
not something that wakes on a timer — so the job is `KeepAlive`, and macOS
restarts it if it ever dies or the Mini reboots.

```bash
cat > ~/Library/LaunchAgents/com.starcaster.youtube-media.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.starcaster.youtube-media</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>set -a; . "\$HOME/Library/Application Support/starcaster-youtube-media.env"; set +a; exec /usr/bin/env node server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$HOME/WebApps/starcaster/workers/youtube-media</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/youtube-media-worker.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/youtube-media-worker.log</string>
</dict></plist>
EOF

launchctl unload ~/Library/LaunchAgents/com.starcaster.youtube-media.plist 2>/dev/null
launchctl load  ~/Library/LaunchAgents/com.starcaster.youtube-media.plist
sleep 2 && curl -s localhost:8080/health
```

`-lc` matters: a launchd job gets a bare environment that does not include
Homebrew's `bin` directory, so `yt-dlp` and `ffmpeg` would be missing and
`/health` would answer `503` with both fields empty. A login shell fixes that.
If `/health` is silent, read
`~/Library/Logs/youtube-media-worker.log` — the worker says why it refused to
start rather than failing quietly.

### 8. Point StarCaster at it — Dane's screen

In the admin app: **Settings > APIs**, the `youtube_media_worker` record.

| Field | Value |
|---|---|
| Base URL | how the app reaches the Mini (see below) |
| API key | the shared secret from step 4 — the same string, exactly |
| Timeout (ms) | `20000` is the default and is fine |

**The base URL is the honest catch in this plan.** Production StarCaster runs
on Vercel and cannot reach `localhost:8080` on a Mini in your house. One of
these has to be true:

- a tunnel with a stable public hostname (Cloudflare Tunnel or Tailscale
  Funnel) pointing at port 8080 — the usual answer, and free; or
- a port forward on the house router with a dynamic-DNS name — works, but it
  puts the worker on the open internet with only the shared secret in front of
  it, which is why the secret is 32 random bytes and not a word; or
- accept that media acquire works only from a StarCaster running on the home
  network.

Slice 4 (`86bbjve6q`) is where that gets settled and set up. Until this record
is filled in, the client reports `worker-unconfigured` and the rest of acquire
carries on working — which is the designed behaviour, not a failure.

### 9. Check it end to end from the app

Run a real acquire with an `.mp4`/`.mp3` requested, and confirm the files land
in Blob. Then look at `~/Library/Logs/youtube-media-worker.log` once, so you
know what a healthy run looks like before you ever have to read it in anger.

---

## Everyday operation

```bash
curl -s localhost:8080/health                                  # up? both programs present?
tail -f ~/Library/Logs/youtube-media-worker.log                # what is it doing
launchctl kickstart -k gui/$(id -u)/com.starcaster.youtube-media   # restart it
brew upgrade yt-dlp                                            # first fix for new download failures
```

Jobs live in memory and are forgotten after `JOB_TTL_MS` (6 hours by default).
That is deliberate — the worker is a pipe, not a record. StarCaster keeps the
lasting record, and a restart losing an in-flight job is recoverable by asking
for it again.

**It does not report to the roll call.** `npm run heartbeat` lists
`youtube-media` as NOT REPORTING with the reason, and that is correct rather
than an omission: it is a service that succeeds by answering a request, so
"when did it last succeed" is really "is it up", which `/health` answers
directly. It earns a beat when something is scheduled to ask that question on
a timer.

## If it ever moves off the Mini

The `Dockerfile` next to this file still builds a working container with
`yt-dlp` and `ffmpeg` in it, for a rented host. Two things change and both
bite: a datacenter IP is what YouTube blocks, so expect refusals and a
`YTDLP_COOKIES_FILE` (a copy of a logged-in YouTube session — a credential
living somewhere new, which is exactly why the Mini won). And `youtube-media`
in `lib/nodeRoles.js` would need its owner changed and committed, because
that table, not this document, is what decides where the job may run.
