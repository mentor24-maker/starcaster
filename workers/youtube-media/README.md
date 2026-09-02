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

Vercel reaches it over **Tailscale Funnel** — a stable public HTTPS hostname
for the Mini that needed no DNS changes (step 8). The endpoint is on the open
internet, so the shared secret is the only thing standing in front of it:
that is why it is 32 random bytes and why `/health` is the sole route that
does not require it.

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

Ten steps, in order. Three need Dane and only Dane — the shared secret's
value (step 4) and the two browser sign-ins Tailscale requires (step 8).
An agent session can run every other one, including the deploy.

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
the open internet — and once Funnel is on (step 8) the open internet can reach
this worker, so it is the only thing standing in front of it. It exists in
exactly two places: this worker's environment file, and
`YOUTUBE_MEDIA_WORKER_TOKEN` in Vercel (step 9). **Nothing else should ever
hold a copy, and it must not be pasted into a ticket, a commit, or a chat
message.**

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

Resolve the node binary first — the plist pins the real path rather than
trusting the job's `PATH`:

```bash
NODE_BIN="$(command -v node)"; echo "$NODE_BIN"

cat > ~/Library/LaunchAgents/com.starcaster.youtube-media.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.starcaster.youtube-media</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>set -a; . "\$HOME/Library/Application Support/starcaster-youtube-media.env"; set +a; exec "$NODE_BIN" server.js</string>
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
The node path is pinned for the same class of reason, one step worse: a job
that cannot find `node` at all never starts, and the failure looks exactly
like the worker crashing on boot.
If `/health` is silent, read
`~/Library/Logs/youtube-media-worker.log` — the worker says why it refused to
start rather than failing quietly.

### 8. Put it on the internet with Tailscale Funnel

Production StarCaster runs on Vercel and cannot reach `localhost:8080` on a
Mini in a house. **Tailscale Funnel** is how it does (Dane chose it on
2026-09-01 over Cloudflare Tunnel, a router port-forward, and staying
LAN-only). It gives the Mini a stable public HTTPS hostname without touching
DNS at all — which mattered because `starcaster.pro`'s nameservers live on
Vercel and that domain carries live email.

```bash
brew install tailscale

# Userspace mode: no root needed, and Funnel only exposes one local port
# outward — it never routes traffic into the machine's network stack.
mkdir -p ~/.tailscale
nohup /opt/homebrew/opt/tailscale/bin/tailscaled \
  --tun=userspace-networking \
  --statedir="$HOME/.tailscale" \
  --socket="$HOME/.tailscale/tailscaled.sock" \
  > ~/Library/Logs/tailscaled.log 2>&1 &

TS="/opt/homebrew/bin/tailscale --socket $HOME/.tailscale/tailscaled.sock"
$TS login --hostname=mac-mini      # prints a URL Dane opens in a browser
$TS funnel --bg 8080
$TS funnel status                  # shows the public https://<host>.ts.net
```

Two of those steps are **Dane's browser and nobody else's**: signing in, and
enabling Funnel for the tailnet the first time (the CLI prints that second
URL itself and refuses until it is done).

**Give DNS a few minutes and check from off the tailnet before believing it.**
"Could not resolve host" here has *two* causes and they need opposite
responses, so find out which one you have before changing anything. Both were
hit on 2026-09-01, by two sessions, within an hour.

*The record is not published yet.* The **AAAA appears before the A**, so for a
window the hostname resolves on IPv6 only, and a machine without IPv6 egress
cannot reach it. Waiting fixes this.

*Your resolver cached the failure.* A lookup made **before** Funnel was
switched on leaves a negative answer cached, and waiting does **not** fix it —
the resolver keeps answering from that cache until its negative TTL expires,
long after the record exists. On 2026-09-01 Google (`8.8.8.8`) and Cloudflare
(`1.1.1.1`) both did this while Quad9 (`9.9.9.9`) and the authoritative
nameservers answered correctly the whole time.

Ask an authoritative nameserver, which cannot be stale, and compare:

```bash
dig +short @ns1.dnsimple.com <host>.ts.net A   # the truth
dig +short @8.8.8.8          <host>.ts.net A   # what your resolver believes
```

If those disagree, it is a stale cache, not a broken Funnel — prove the
endpoint works by going around the resolver, and let the cache expire on its
own:

```bash
curl -s --resolve <host>.ts.net:443:<the A record> https://<host>.ts.net/health
```

### 9. Point production at it — environment variables, NOT Settings > APIs

**This is the step the ticket originally got wrong, and it fails silently.**
Settings > APIs writes to `data/api_settings.json` (`lib/apiSettings.js`),
which is **gitignored, untracked, and on a read-only filesystem in
production** — landmine 6. The screen accepts the values and they are gone.
It is the right screen for a StarCaster running locally, where the file is
writable, and the wrong one for Vercel.

The client reads env vars first (`lib/acquire/YoutubeMediaWorker.js`), so
production is configured there:

```bash
printf 'https://<host>.ts.net' | vercel env add YOUTUBE_MEDIA_WORKER_URL production
# pipe the secret straight from the Mini so it is never displayed:
ssh mac-mini "grep '^WORKER_SHARED_SECRET=' \
  \"\$HOME/Library/Application Support/starcaster-youtube-media.env\" | cut -d= -f2" \
  | tr -d '\r\n' | vercel env add YOUTUBE_MEDIA_WORKER_TOKEN production
```

**Then redeploy, or none of it is live.** Vercel bakes environment variables
into a deployment at build time (landmine 10), so the build already serving
traffic has neither value. Skipping this produces "the value is right but not
live", which is indistinguishable from a wrong value and cost an hour on
2026-07-29:

```bash
vercel redeploy "$(vercel ls --prod | awk '/Ready/{print $3; exit}')"
```

### 10. Check it end to end from the app

Run a real acquire with an `.mp4`/`.mp3` requested, and confirm the files land
in Blob and survive a page reload. Watch the worker's own log while you do it
— that is how you tell "production reached the Mini" apart from "the panel
looked busy":

```bash
ssh mac-mini 'tail -f ~/Library/Logs/youtube-media-worker.log'
```

Look at that log once when everything is healthy, so you know what healthy
looks like before you ever have to read it in anger.

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
