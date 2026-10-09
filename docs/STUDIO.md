# Studio — the operator's guide

The Studio is the part of StarCaster that collects every video you record,
on every device, into one list. You drop footage into a folder on Google
Drive; a program on the Mac Mini picks it up, reads what it is, makes a
lighter copy for editing, and writes it into a catalog. You see the catalog
in the admin app under **Assets › Footage**.

This is Phase 1: the pipeline and the list. Nothing here edits a video yet.

## What happens to a video, step by step

1. **You put a file in one of two Drive folders.** Both live in
   **mentorofaio's** Google Drive, under My Drive › Projects › Starcaster › Studio
   (since 2026-10-09; see "Which Google account owns what" below).
   - [`/Studio/Inbox/`](https://drive.google.com/drive/folders/1NBKTjYhQsrVr8seF2r2IXXqBt8-Go0GV)
     — camera footage: you on camera, the wide shot, a phone take. The
     pipeline works out which is which from the file itself.
   - [`/Studio/Plates/`](https://drive.google.com/drive/folders/1XvwqpBHsjB5_QEOCa0_IBl9sWQJYW3dZ)
     — screen recordings and anything else that is a picture to put *into* an
     edit. Files here are never sent for transcription, because a screen
     recording has no speech and transcribing silence costs money.
2. **The watcher notices it.** It asks Drive "what changed since last time?"
   rather than listing the folder, so a quiet hour costs one question however
   big the archive gets. (Studio 3/8.)
3. **Ingest downloads it** to the Mini's disk, fingerprints the bytes, and
   skips it if the same file is already in the catalog. It stops — and says
   why — if the disk drops below its safety floor, 50 GB unless changed.
   (Studio 4/8.)
4. **Probe reads the file**: how long it is, its size, frame rate, when it was
   recorded, and which device made it (iPhone, iPad, MacBook, a screen
   recording). (Studio 5/8.)
5. **Proxy makes the lighter copies**: a small video for editing and an audio
   track for analysis. A file that is already small is not re-encoded — that
   would only make it worse. (Studio 6/8.)
6. **The worker keeps all of that running** on the Mini: wake up, do one job,
   say "still alive", sleep, repeat. (Studio 7/8.)

Each file is filed under a **session** — one shoot, one talk, one screen
capture. New files go into a holding session named for the folder and the day
until they are sorted.

## Which Google account owns what

Two Google accounts are involved, and the split is deliberate (Dane's
decision, 2026-10-08; moved 2026-10-09):

- **mentorofaio@gmail.com owns the folders.** It has the 2 TB plan with room
  for the video that is coming. `My Drive › Projects › Starcaster › Studio`
  (folder id `17HZZDNlGAcxWUxbMBdlywnn-Tjf4pfD7`) holds `Inbox`
  (`1NBKTjYhQsrVr8seF2r2IXXqBt8-Go0GV`) and `Plates`
  (`1XvwqpBHsjB5_QEOCa0_IBl9sWQJYW3dZ`).
- **mentor24@gmail.com is the worker's sign-in.** Its Drive token is what the
  worker watches and downloads with. It sees the Studio folders because the
  `Starcaster` folder above them has been shared with mentor24 as Editor since
  2026-07-04 and everything inside inherits that. That share is load-bearing:
  remove it and the watcher reports both folders as unreadable and stops.
- **Do not share a new Studio folder directly; put it under `Starcaster`.**
  On 2026-10-09 a `Studio` folder created at the top of mentorofaio's My Drive
  and shared straight to mentor24 was accepted by Drive on paper — mentor24
  held Editor on it and on everything in it — yet Drive never listed its
  contents to mentor24, in the browser or the API, and not one event from it
  reached the changes feed the worker reads, not even the owner renaming the
  Inbox. Two hours of checking did not change that. A folder created inside
  the already-shared `Starcaster` folder was visible to mentor24 within a
  minute, contents, parents and feed events included. The cause is Google's,
  not ours; the rule that follows is ours.
- **An upload counts against the account that UPLOADS it**, not the folder's
  owner. So anything that puts footage into the Inbox on a schedule must do it
  signed in as mentorofaio — on the MacBook that is rclone's `gdrive:` remote.
  A file dragged in from a browser signed in as mentor24 lands in the right
  folder but spends mentor24's storage, which had about 30 GB left when the
  move was made.
- **mentor24's old folder** was renamed `Studio (old — moved to mentorofaio
  2026-10-09)` and left where it is. The one file it held, IMG_1962, keeps
  its catalog row: that row points at the file's Drive id, which a rename
  does not change.

The watcher reads an account-wide "what changed?" feed rather than listing
folders, and a file another account puts into a folder shared with mentor24
does show up in mentor24's feed — that was proved by hand on 2026-10-09
before the folder ids were switched, and it is why no code changed for the
move.

## Zoom recordings arrive by themselves (Media intake · 2 of 5)

Zoom saves each recording on the MacBook, into **iCloud Drive › Documents ›
Zoom**, one folder per meeting. A small job on the **MacBook** (it is the only
machine signed in to that iCloud Drive) looks there every 15 minutes and sends
each new video to the Inbox above — no copying by hand.

- **Only new recordings.** "New" means recorded after the job was first
  installed. Everything older is *history*, and it is never sent by the
  schedule (see below).
- **Only the video.** Each meeting folder also holds an audio-only `.m4a`
  (the same sound the video already has), a chat log and a few Zoom files;
  none of those are sent.
- **Only when it is finished and fully on the disk.** A recording touched in
  the last two minutes waits; so does one iCloud has not finished
  downloading. Neither is ever sent half-done.
- **Never twice.** A ledger on the MacBook remembers every file it sent by its
  fingerprint, so renaming or copying a recording does not send it again. A
  file only counts as sent once Google Drive's own fingerprint of the upload
  matches.
- **Straight into the Inbox, named after the meeting** —
  `Zoom - 2026-10-08 15.10.19 my meeting 612342203 - video1234.mp4`. Not into
  a sub-folder: the watcher only follows files directly inside the Inbox.
- **It deletes and moves nothing**, on either side.
- **It uploads as mentorofaio** (through `rclone`'s `gdrive:` sign-in on the
  MacBook), so the storage comes out of the 2 TB account.

```
./scripts/install_media_intake.sh --status     # on the MacBook: installed? loaded? last pass? beating?
npm run media:intake -- --backfill zoom        # list the history: count, size, oldest, newest (sends nothing)
npm run media:intake -- --backfill zoom --apply   # send history, oldest first, at most 5 GB a run — Dane's call
```

The log is `~/Library/Logs/media-intake.log` on the MacBook. A pass that fails
posts to the bus (once per 6 hours); a clean one records a heartbeat for the
`media-intake` role.

## The Footage screen

Open the admin app, choose the project the Studio files into, then
**Assets › Footage**.

- **One block per session, newest session first.** Inside a block, files are
  in the order they were recorded — the order you would stack them in an edit.
- **Preview.** The small picture is Google Drive's own preview of the file.
  "No preview yet" means Drive has not drawn one (it takes a few minutes after
  an upload), or the file did not come from Drive. It is never a broken image.
- **Watching a file.** Click its preview or its name in the **File** column
  and the original opens in Google Drive's player, in a new tab. The Studio
  folders belong to **mentorofaio** and are shared with **mentor24**, so the
  browser has to be signed in to one of those two accounts. Otherwise Drive
  asks you to sign in or to request access, and nothing is wrong with the
  file. It plays the original
  and not the small editing copy, because that copy lives on the Mac Mini's
  disk, which the website cannot reach. A file marked *not from Drive* has no
  Drive copy to open, so it has no link. *Open in Drive* in place of a name
  means the Mini has not downloaded the file yet, and that download is where
  the name comes from.
- **Device** is the machine that made the file. *Not known yet* means the
  probe step has not read that file.
- **Role** is what the file is *in an edit*: `subject` (you on camera),
  `background` (the wide shot), `plate` (something inserted), `reference`
  (kept only to line the others up).
- **Recorded.** A date with a `*` after it is a stand-in: the file has not
  been read for its own recording date yet, so the screen shows the session's
  date or the day the file was added. Hover it and it says which.
- **Stage** is how far through the pipeline the file has got:
  `new` → `downloading` → `downloaded` → `probed` → `ready`, or `failed`.
  `ready` means the working copies exist. (`proxied` is reserved for when a
  later step such as transcription is still to come; Phase 1 never shows it.)
- **Filters**: search session names, pick a device, and pick a date range.
  A file with no date at all cannot be placed in a range, so a date filter
  leaves it out — and the screen says how many it left out.

The line above the list is the quickest health check there is:

> 12 file(s) in 3 session(s). Newest file added Sep 20, 2026, 4:12 PM.
> Stages: 9 ready · 2 probed · 1 failed.

## How to tell whether it is running

**Look at "Newest file added" on the Footage screen.** If you dropped a file
into the Inbox an hour ago and that date has not moved, the pipeline is not
picking files up.

**Look at the stages.** Files that sit at `new` or `downloaded` for hours are
waiting for a step that is not running. `failed` means a step tried and gave
up; the reason is kept on the Mini.

**Ask the roll call.** The worker is installed on the Mini (since 2026-10-05)
and records a heartbeat as the job `studio-worker` every five minutes. The
same watchdog that watches the loops turns six hours of silence into a message
on the bus. From any machine:

```
npm run heartbeat
```

**On the Mini itself:**

```
./scripts/install_studio_worker.sh --status
```

says whether the scheduled worker is loaded and running, its process number,
which database it writes to, and whether every setting it needs is present.
Install from the Mini's main checkout (`~/WebApps/starcaster`), never from a
worktree: the schedule points at the folder it was installed from, and
`npm run tidy` deletes worktrees.

## When it stops, and what fixes it

| What you see | What it means | Who fixes it |
|---|---|---|
| Nothing new arrives, and the roll call says `studio-worker` is quiet | The worker is not running on the Mini — the Mini is off, asleep, or signed out | Wake the Mini; an agent session can then check it |
| Nothing new arrives, the worker is alive | Usually the Google Drive sign-in has expired. The pipeline stops asking and raises one warning rather than retrying all night | Dane — a browser login to Google renews it |
| Files stop at `downloading` | The Mini's disk is below the safety floor (50 GB), or the disk the cache lives on is not plugged in | Free space or plug the drive in; the pipeline resumes on its own |
| The Footage screen says "No footage yet" but files are in Drive | The worker files into ONE project, named by `STUDIO_PROJECT_ID`. You may be looking at a different project | Switch project, or an agent session corrects the setting |
| A file shows "No preview yet" for a day | Drive never drew a preview for it — some formats it cannot preview | Nothing; the file itself is fine |

## Settings the pipeline reads

These live in **Doppler** (the password vault every scheduled job here reads
from), under project `starcaster`, config **`prd`** — not in the admin app and
not in a file on the Mini. The installed worker is started *through* Doppler
(`doppler run --scope ~/Studio --project starcaster --config prd -- node workers/studio/daemon.js`),
so it receives them the moment it starts and nothing is written to disk. An
agent session changes them; they are listed so the names mean something when
they come up.

**The Mini's key to `prd` is kept at `~/Studio`, not in the repo folder.**
Doppler holds one key per folder, and the repo folder's key is the read-only
`dev` one every loop runs on — a `prd` key stored there would replace it and
stop the loops. So the worker's read-only `prd` key (named `mac-mini-studio`
in Doppler) is stored for `~/Studio`, and every `doppler run` the installer
writes names `--scope ~/Studio`. To replace it, without the value ever being
shown: `doppler configs tokens create <name> --project starcaster --config prd
--access read --plain | ssh mac-mini 'IFS= read -r T; doppler configure set
token="$T" --scope ~/Studio >/dev/null'`.

**Google Drive's sign-in** (`GOOGLE_DRIVE_CLIENT_ID`, `_SECRET`,
`_REFRESH_TOKEN`) is in `prd` too, for mentor24@gmail.com, renewed 2026-10-05.
When Google expires it, the worker stops and says so; renewing it is one
browser login by Dane. The folders it watches belong to mentorofaio and are
shared with it (see "Which Google account owns what"); the folder ids in `prd`
have pointed at mentorofaio's folders since 2026-10-09.

**Why `prd` and not `dev`:** on the Mini, the `dev` config points the database
at a copy on that machine. A worker run under it would look perfectly healthy
and file every video where the live Footage screen can never see it. The
installer takes `--doppler-config <name>` if a different config is ever wanted,
and `--status` prints which config and which database host the worker uses.

**The installer checks before it installs.** `--status` lists, by name only
(never a value), any required setting missing from that config, and says
CANNOT TELL — not OK — if Doppler on that machine cannot be read. `install`
refuses in either case rather than setting up a worker that would crash and be
restarted once a minute forever.

Required — the worker cannot do its job without these:

| Setting | What it controls |
|---|---|
| `STUDIO_PROJECT_ID` | Which StarCaster project the footage is filed under. Without it the pipeline refuses to file anything, rather than filing it under no project |
| `STUDIO_DRIVE_INBOX_FOLDER_ID`, `STUDIO_DRIVE_PLATES_FOLDER_ID` | The two Drive folders it watches — mentorofaio's `Studio/Inbox` and `Studio/Plates`, shared with the worker's account. A wrong id shows up as "nothing new arrives" plus a blocked watch job naming the folder |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | The database the catalog is written to (`SUPABASE_SERVICE_ROLE_KEY` is accepted in place of the key) |
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` | The Google Drive sign-in it reads and downloads with |

Optional — each has a working default:

| Setting | What it controls |
|---|---|
| `STUDIO_CACHE_DIR` | Where downloaded originals are kept on the Mini |
| `STUDIO_DERIVED_DIR` | Where the proxies and audio tracks are written |
| `STUDIO_DISK_FLOOR_BYTES` | The free-space floor below which downloads stop (default 50 GB) |
| `STUDIO_PROXY_FLOOR_KBPS` | Files already smaller than this are not re-encoded (default 1500) |

## Speech-to-text (Phase 2)

Transcription runs **on the Mac Mini**, not through a paid service — Dane's
choice on 2026-10-05: it is free, and the audio never leaves the house. Two
things make it possible, and both are part of the machine's setup rather than
a hand-run install, so a rebuilt Mini gets them back with
`npm run provision:node:apply`:

- **`whisper-cli`** (Homebrew `whisper.cpp`), the speech-to-text program.
- **The model file**, `~/Studio/models/ggml-large-v3-turbo.bin` (1.6 GB),
  from the official whisper.cpp download. It is accepted only when its size
  and SHA-256 match the published ones, so a download that stopped part way
  can never pass as present. `npm run doctor:node` checks it the same way.

### How a recording gets transcribed (Phase 2 · 3 of 6)

When the proxy step marks a recording `ready`, it puts a `transcribe` job on
the queue — unless it is a **plate** (plates are footage of a place, not of
anyone talking) or it has **no sound track**, in which case it writes a
`no_audio` transcript row instead, so the Footage screen can say why there is
no transcript. The daemon then runs `workers/studio/transcribePass.js`:
whisper on the 16 kHz WAV, with the alignment flags below, and the result is
written to `video_transcripts` and read back.

- **whisper or the model missing** is the machine's fault: the job waits 15
  minutes and tries again, no attempt is used up, and no row is written.
- **whisper failing on the file** writes a `failed` row with the reason, and
  the job retries on the queue's usual schedule.
- Settings, all optional: `STUDIO_WHISPER_BIN` (default `whisper-cli`),
  `STUDIO_WHISPER_MODEL` (default the model above), `STUDIO_WHISPER_LANGUAGE`
  (default `en`), `STUDIO_WHISPER_DTW` (default `large.v3.turbo`; it must name
  the same model).
- **Time allowed:** ten minutes plus half a second per second of audio — about
  seven times the measured speed. An hour of footage is allowed 40 minutes and
  takes about 4.
- **The heartbeat.** The daemon beats between jobs, and `studio-worker`'s quiet
  window is 6 hours. At the measured speed (0.07) a single job would need about
  85 hours of audio to block beats that long; even at the full time allowance
  it would need a recording of about 11½ hours. Neither is a real recording.

**Catching up:** recordings that reached `ready` before this existed were never
queued. `npm run studio:backfill-transcripts` (on the Mini) lists every `ready`,
non-plate recording with no transcript and no job waiting; it is a dry run
until you add `-- --apply`, and a second `--apply` enqueues nothing.

### Measured on 2026-10-05

IMG_1962 (148.5 s of speech), Mac Mini M4, whisper.cpp 1.9.4, `large-v3-turbo`,
Metal on:

| Settings | Wall clock | Real-time factor |
|---|---|---|
| default | 8.6–9.3 s | 0.06 (about 16× faster than real time) |
| with word alignment (`-nfa --dtw large.v3.turbo`) | 9.9 s | 0.07 |

**Word timing: use the alignment flags.** The default per-word times are
spread evenly across each segment, not tied to the audio: on this clip they
put the first word at 0.00 s when speech starts at about 5.6 s, and drift by
up to 0.9 s mid-clip. With `-nfa --dtw large.v3.turbo` (flash attention off,
so the alignment can run), every word that starts after a pause landed within
0.44 s of the audio, most within 0.1 s. So **turbo is kept** — `large-v3` was
not needed — on the condition that the pipeline always passes those flags and
reads each token's `t_dtw` (hundredths of a second) from the `-ojf` JSON.

Two things the pipeline step has to handle:

- The alignment gives **one time per token**, not a start and end. A word's
  end is taken as the next word's start, which stretches the last word before
  a pause across it.
- A word can arrive as **several tokens** (21 of 251 on this clip). Tokens
  that do not begin with a space continue the previous word.

## Where the pieces live

For an agent session working on this, not for day-to-day use.

- Catalog tables: `docs/SQL/video_studio_setup.sql` (`video_sessions`,
  `video_sources`); stores in `lib/videoSessionsStore.js` and
  `lib/videoSourcesStore.js`.
- Transcripts (Phase 2): `docs/SQL/video_transcripts_setup.sql`
  (`video_transcripts`, one row per source; apply after the catalog file);
  store in `lib/videoTranscriptsStore.js`. No row means "not transcribed yet",
  never a state. Search uses the `simple` text-search config on purpose — see
  the note in the SQL.
- The pipeline: `workers/studio/` — `drive.js` (watcher), `ingest.js`,
  `probe.js`, `proxy.js`, `queue.js` (the local work list on the Mini, SQLite,
  deliberately not Supabase — the queue writes thousands of rows per video).
  Excluded from the Vercel deploy; it drives ffmpeg over multi-gigabyte files.
- The Footage screen: `components/studio/footage-panel.tsx`, mounted on
  `#studioFootageReactRoot` in `src/pages/assets.html`; its data from
  `GET /api/studio/footage` and previews from
  `GET /api/studio/sources/:id/thumbnail` (`routes/studio.js`, view rules in
  `lib/studioFootage.js`, tests in `scripts/builder/studioFootage.test.js`).
  Previews come from Drive with the server's own Drive credential because the
  proxies live on the Mini's disk, which the website cannot reach.
