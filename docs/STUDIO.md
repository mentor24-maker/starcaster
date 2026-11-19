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
  `--status` asks rclone which account `gdrive:` is signed in as, and the
  installer refuses a different one; when rclone cannot say, it reports
  CANNOT TELL rather than a pass.
- **History waits for a finished file too.** The `--backfill` step applies the
  same two-minute rule, so a meeting Zoom is still converting is never sent
  half-done.

```
./scripts/install_media_intake.sh --status     # on the MacBook: installed? loaded? last pass? beating?
npm run media:intake -- --backfill zoom        # list the history: count, size, oldest, newest (sends nothing)
npm run media:intake -- --backfill zoom --apply   # send history, oldest first, at most 5 GB a run — Dane's call
```

The log is `~/Library/Logs/media-intake.log` on the MacBook. A pass that fails
posts to the bus (once per 6 hours); a clean one records a heartbeat for the
`media-intake` role. A pass that found another run still going is **skipped,
and records no heartbeat** — so a run that never lets go shows up as the role
going quiet. The "one run at a time" lock is released if the job is stopped
(macOS stops jobs at shutdown), and a leftover lock — more than 3 hours old, or
naming a process that is not a media-intake run — is taken over and said so in
the log, so a restart mid-pass cannot stop uploads for good.

## Videos in the Photos "Studio" album arrive by themselves (Media intake · 3 of 5)

Put a video into an album called **Studio** in Apple Photos — on the iPhone
(**Photos › Albums**, then a video's share button › **Add to Album** ›
**Studio**) or on the Mac — and the same 15-minute job on the MacBook sends it
to the Inbox. iCloud Photos carries it from the phone to the Mac's library.

- **Only that album.** Nothing outside **Studio** is ever sent, so family
  videos stay out. The album is checked twice: by the tool that reads Photos
  and again by the job itself.
- **Only videos.** Photos in the album are skipped, and the log says how many.
- **The original,** fetched from iCloud first when only iCloud has it. The job
  exports a copy into its own folder, uploads it and deletes that copy.
  **Nothing in Photos is ever deleted, moved or changed** — removing a video
  from Photos removes it from the iPhone too.
- **Never twice.** The ledger remembers each video by its Photos id *and* its
  fingerprint: taking a video out of the album and putting it back sends
  nothing, and neither does the same video imported twice.
- **Straight into the Inbox**, named after when it was taken —
  `Photos - 2026-10-09 18.04.11 - IMG_1234.MOV` — not into a `Photos/`
  sub-folder, because the watcher only follows files directly in the Inbox.
- **No album yet?** The job makes one called **Studio** and sends nothing that
  pass.

**It needs a permission only Dane can give.** macOS keeps the Photos library
behind a privacy switch. Until it is on, every pass logs

```
CANNOT READ PHOTOS — macOS refused access to …/Photos Library.photoslibrary (EPERM)
  FIX: On the MacBook: System Settings › Privacy & Security › Full Disk Access — turn ON the switch for "node" …
```

and exits non-zero, so the bus hears about it (once per 6 hours) — it never
reports "0 new videos". The Zoom half still runs either way. The tool that
reads Photos is **osxphotos** (`brew install pipx && pipx install osxphotos`;
`npm run doctor:node` lists it on the MacBook only). It is always given the
library's path: measured 2026-10-09, without one it hangs silently when the
library is blocked, so every call also has a time limit.

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

## Finding what to cut (Reel Spinner step 1)

Once a recording's transcript is `done`, the transcribe step puts a
`cut_marks` job on the queue and the Mini works out what an editor would take
out. Nothing is edited: each result is a list of **decisions** — "from 12.62 s
to 12.80 s is an 'uh'" — stored in `video_cut_marks`, one row per recording.
Nothing touches a video file until the last step of the Reel Spinner.

**What it marks**, four kinds:

- **filler** — "um", "uh", "er", "hmm".
- **repeat** — the same word or few words said twice in a row ("I, I was").
- **false start** — a short phrase abandoned and restarted.
- **pause** — any silence **over 1 second** is shortened so **0.5 seconds**
  stays (a quarter second each side), so the speech keeps a beat rather than
  being jammed together.

**How it decides.** The Mini runs whisper a second time on the same audio, told
to write what was said word for word, and ffmpeg listens for the silences. A
word is only marked if the word-for-word pass heard it and the ordinary
transcript tidied it away; wherever the two passes disagree any other way,
nothing nearby is touched. When unsure, the speech is kept. **Everyone is
treated the same** — guests on a Zoom call too; there is no speaker detection
(Dane, 2026-11-01).

- **whisper, ffmpeg or the model missing**, or the database unreachable, is
  the machine's fault: the job waits 15 minutes and tries again, no attempt is
  used up, and no row is written.
- **whisper or ffmpeg failing on the file** writes a `failed` row with the
  reason, and the job retries on the queue's usual schedule.
- **Time allowed:** the same as transcription for the second whisper, plus
  five minutes and a tenth of a second per second of audio for the silence
  check. Measured on the Mini (2026-11-02), five minutes of a Zoom call took
  40 s in all and came back with 37 marks — 27 pauses, 7 fillers, 3 repeats —
  49.6 s to cut.
- **Disk:** the only file it writes is whisper's temporary JSON (a few
  megabytes an hour), deleted when the job ends.
- A new transcription always goes first: a pile of cut-marks jobs waits behind
  it, never in front.

**Catching up:** recordings transcribed before this existed were never queued.
`npm run studio:backfill-cuts` (on the Mini) lists every finished transcript
with no cut-marks row and no job waiting, and prints the running tally —
`cut marks: 27 done · 0 failed · 0 still to do`. It is a dry run until you add
`-- --apply`, and a second `--apply` enqueues nothing.

## Scoring moments (Reel Spinner step 2)

Once a recording's cut marks are `done`, the cut-marks step puts a `moments`
job on the queue — unless that recording already has a moments row, because a
re-run of the cut marks must not quietly buy a rescore — and the Mini picks out the stretches of 20 to 60 seconds worth
sharing on their own, plus a one-paragraph summary. Like the cut marks, each
result is a list of **decisions** — "41.2 s to 78.9 s scores 86, it speaks to
WaveCenter" — stored in `video_moments`, one row per recording. No video file
is touched.

**What it is judged against is Dane's own notes**: every Context entry
switched on for Reel Spinner (Assets › Context), read at the moment of scoring
and put in the request word for word. Each row keeps a fingerprint of the
notes it was scored against. **Editing the notes does not rescore anything by
itself** — every rescore costs money, so it is Dane's call; the row simply
shows it was scored against an older version. No notes switched on writes a
`failed` row saying so, and nothing is sent.

**Which AI answers** is the AI door's choice (Settings › APIs › AI provider),
never this step's: the first provider in the order that can pay. The row's
`model` says which one did, e.g. `openai/gpt-5.5-2026-04-23`.

- **No provider able to pay** (every one out of credit or without a key), or
  no network at all, is the machine's fault: the job waits **an hour**, no
  attempt is used up, no row is written, and the bus hears once every six
  hours — *"Reel Spinner scoring is stopped: no AI provider can pay.
  Anthropic: out of credit. OpenAI: no key."* The next successful score clears
  that, so if it stops again it is announced straight away.
- **An answer the rules refuse** (not the agreed shape, cut off, no moment
  that fits) writes a `failed` row with the reason, and the job is finished —
  retrying would pay for the same refusal again.
- **Any other failed call** (a timeout, a rate limit) retries on the queue's
  usual schedule, and only when the retries run out is a `failed` row written,
  saying why. **A recording already scored keeps its moments**: a rescore that
  meets a run of rate limits leaves the good moments alone, and the blocked
  job says why the rescore did not happen.
- **A save that fails after the AI answered** keeps the answer on the Mini for
  a day, so the retry saves it without paying for it twice.
- **Rescoring:** the screen (step 2e) stamps `rescore_requested_at`; the
  daemon looks for stamps once a minute and queues one job per recording. A
  request made while that recording was being scored is kept and answered by
  the next run.
- Scoring waits behind every new recording's transcription and cut marks.

**Measured on the Mini (2026-11-18)**, the 14-minute recording in the tests
(835 s, 1,877 words, 59 cut marks): one call, **59 seconds**, 10 moments,
answered by OpenAI (`gpt-5.5`) because the Anthropic account could not pay —
**4,906 tokens in and 5,050 out**. The request grows with the recording and
the answer does not, so **an hour of recording is about 21,000 tokens in and
5,000 out**. In dollars: on Anthropic's Sonnet 5.5 ($2 in / $10 out per
million) that is about **$0.09 an hour of recording**. The OpenAI dollar
figure is not known here — `lib/aiPricing.js` has no OpenAI rates yet, so it
is reported as "not priced", never as $0; OpenAI's own usage page has it.

**Catching up:** recordings whose cut marks were found before this existed
were never queued. `npm run studio:backfill-moments` (on the Mini) lists every
recording with finished cut marks, no moments row and no job waiting, and
prints the running tally — `moments: 33 done · 0 failed · 0 still to do`. It
is a dry run until you add `-- --apply` (each job is one paid AI call), and a
second `--apply` queues nothing.
A recording whose scoring job is **blocked** is listed separately with the
job's reason: it is not waiting and will not be scored until somebody fixes
that reason and deletes the blocked job.

## Matching iPhone and Zoom recordings (Reel Spinner step 3)

When Dane films a session on the iPhone while Zoom records it too, the edit
keeps one recording's picture and uses the **cleaner sound** of the two
(Dane's choice, 2026-11-16: "Better sound"). Nothing is mixed or laid over
anything here: each answer is a **decision** stored in `video_audio_pairs`,
one row per pair — how many seconds apart the two start, how far the clocks
drift by the end, and whose sound to use.

**When it runs.** Every time an iPhone or Zoom recording reaches `ready`, the
Mini queues an `align` job for it. The job looks at every OTHER ready
recording from the other device whose recording time overlaps it by at least
half of the shorter one, and lines each one up by listening to both (the rules
are `workers/studio/alignment.js`, step 3a). If the second half of a session
arrives hours later, its own job finds the first, so a pair is always looked
at once both exist.

**What Footage shows.** Under the file name: *"Recorded together with
zoom_call.mp4, sound from zoom_call.mp4 (cleaner)"*, with a button to use the
other recording's sound instead. Pressing it saves **your choice**, and the
Mini never overwrites it — a later line-up still updates the timing but keeps
your pick (it is guarded inside the database write itself). When neither
sound is clearly better, it says so and offers both.

**A pair that did not match says so, and why** — rather than not showing:
*"Recorded at the same time as …, but the two could not be lined up: the two
clocks drift apart (0.25 s by the end), so the sound would slide off the
lips"*. The other reasons: the sound did not match anywhere, the start
matched but the end did not, one is too short (a minute is the least), or the
sound file of one could not be read. A refused pair costs a manual line-up; a
wrong one would put the sound off the lips for the whole edit, so when unsure
it refuses.

- **ffmpeg missing**, or the database unreachable, is the machine's fault: the
  job waits 15 minutes and tries again, and nothing is written.
- **A sound file missing or unreadable** is that pair's fault: a `failed` row
  names the file and says to re-run the proxy step for it.
- Line-ups run **last** of all the Mini's steps, so a backlog never delays a
  new recording's transcription.

**Catching up:** `npm run studio:backfill-align` (on the Mini) finds every pair
of ready recordings recorded at overlapping times that has no row yet, queues
one job per recording needed, and always prints how many pairs exist —
`pairs: 1 lined up · 0 refused with a reason · 0 not looked at yet`. A dry run
until you add `-- --apply`; a second `--apply` enqueues nothing.

## Rough cuts (Reel Spinner step 4)

Once a recording's moments are scored, the Mini makes a **rough cut** of each
edit, a quick, small video Dane can watch to decide whether it is worth
finishing. It has the "um"s, repeats and long pauses taken out and uses the
chosen sound. It has no music, no title cards and no full-quality picture:
those come with the finished render (step 5c).

**Where Dane says yes, no or "change this".** Assets › Footage › **Rough
cuts** (Reel Spinner 4c, `components/studio/rough-cuts-view.tsx`). Each rough
cut waiting for him shows full or short, its length, how much was taken out,
the moment's score and reasons for a short, a link to watch it in Drive, and
three buttons: **Approve**, **Skip**, **Send back** (which needs a note saying
what to change). The count line at the top ("2 waiting for you · 1 approved ·
…") is also the filter. The website writes only the verdict and the note
(`POST /api/studio/rough-cuts/:id/review`, through `reviewEdit`, which refuses
a step out of order); the Mini acts on them. Nothing is finished without his
Approve.

**Where to watch them.** Drive, `Studio › Rough cuts`
(https://drive.google.com/drive/folders/17HZZDNlGAcxWUxbMBdlywnn-Tjf4pfD7, then
**Rough cuts**). Each file is named after its recording, then *full edit* or
*short from 12m33s, score 92* (where the moment starts in the recording, and
what it scored), then the first part of the edit's id, so two recordings with
the same name never collide.
The folder was made by the Mini inside the Studio folder, never shared on its
own (see "Which Google account owns what" for why that matters).

**What it makes for each recording** (the rules are step 4a,
`workers/studio/editList.js`): one **full edit**, the whole recording with
the cuts taken out, plus one **short** for each moment that scored at least
60, best first, at most three. A recording whose moments all scored under 60
gets a full edit and no shorts. That is an answer, not a fault: IMG_1962's two
moments scored 42 and 31.

**When it runs.** The scoring step queues a rough cut for a recording the
moment its moments are saved. Rough cuts run last of all the Mini's steps, so
a backlog never delays a new recording's transcription. Each edit is rendered
from the working copy already on the Mini (the 720p proxy, or the Zoom
file itself), uploaded, marked **review** with its Drive file id, read back,
and only then is the copy on the Mini deleted.

**It does not wait for a line-up.** The rough cut is queued when the moments
finish, whether or not the recording has been lined up with a Zoom partner. If
the partner is lined up later, the edit rows already made keep the phone's
sound, and nothing redoes them; delete that recording's `video_edits` rows and
run `npm run studio:backfill-roughcuts -- --apply` to make them again.

**A retry never uploads twice.** If an upload worked but the edit could not be
marked **review**, the next try finds its own file in Rough cuts by name and
byte count and reuses it rather than sending a second copy.

**Measured on 2026-11-18** (the Mac Mini, two real recordings):

| Recording | Edit | Length | Size | Render | Upload |
|---|---|---|---|---|---|
| IMG_1962 (iPhone) | full | 2m03s (of 2m29s) | 8.0 MB | 3.9 s | 6.9 s |
| Zoom 2026-10-30 16.55 | full | 12m33s (of 13m56s) | 37.7 MB | 22.8 s | 25.2 s |
| Zoom 2026-10-30 16.55 | short, score 92 | 47 s | 1.6 MB | 5.3 s | 2.6 s |
| Zoom 2026-10-30 16.55 | short, score 90 | 42 s | 1.3 MB | 4.3 s | 2.7 s |
| Zoom 2026-10-30 16.55 | short, score 88 | 49 s | 1.4 MB | 4.7 s | 2.6 s |

**About 2 to 4 MB per minute of rough cut** (iPhone 3.9, Zoom 1.7 to 3.0).
The uploads count against **mentor24's** storage, because mentor24 is the
account that uploads them. An hour-long recording's full edit is roughly 120
to 240 MB. All 34 recordings in the catalog today come to about 2 to 4 GB,
against the roughly 30 GB mentor24 had free when the folders moved.

**When it stops, and why:**

- **The disk is too full.** Before each render it checks there is room for the
  rough cut plus 5 GB kept free. If not, nothing is rendered, the edits stay as
  they were, and the job waits 15 minutes and tries again.
- **ffmpeg refuses a render.** That edit is marked `failed` with ffmpeg's own
  words, and the job is retried on the usual backoff. After five tries it is
  blocked with the reason.
- **Drive refuses an upload** (a full quota, an expired sign-in). The edit is
  marked `failed`, **the finished render is kept on the Mini**, and the retry
  uploads that file rather than rendering it again. It stops at the first
  refusal rather than rendering the rest into nowhere.
- **No working copy on the disk**, or no scored moments: the job is blocked
  with the fix in its reason.

**Catching up:** `npm run studio:backfill-roughcuts` (on the Mini) finds every
scored recording with no edits yet, or with an edit still to render, and
queues one rough cut each. It always prints the totals, e.g. *"rough cuts: 2
scored recording(s) · 0 with no edits yet · 0 edit(s) still to render · 5
edit(s) rendered"*. It is a dry run until you add `-- --apply`, and a second
`--apply` queues nothing.

## Re-cuts from Dane's note (Reel Spinner step 4d)

When Dane clicks **Send back** on a rough cut and types what to change ("start
two seconds later", "cut the bit where I lose my train of thought"), the Mini
cuts it again and puts the new rough cut back in front of him, usually within
a few minutes.

**How.** Once a minute the Mini asks the catalog for edits marked
`sent_back` and queues one `recut` job each (`workers/studio/recutPass.js`).
The job asks the AI door (`generate()`, the strong tier, metered as
`studio_recut`, never a provider by name) for the stretches of the recording
to keep, showing it his note, the edit as it stands and the timed transcript
(`workers/studio/recut.js`). The answer goes through the edit-list rules
before anything is rendered: inside the recording, in order, nothing
overlapping, something kept, not the same edit he sent back, and no word cut
in half (a boundary inside a word moves out to the word's edge, so the word is
kept). The pauses, "um"s and repeats the first cut took out are taken out
again by the same rule, so a re-cut never brings them back. Then it renders
and uploads exactly the way a first rough cut does, and goes back to
**waiting for you**. On Drive the file says which re-cut it is
(*IMG_1962 — full edit, re-cut 1 (e1000000).mp4*).

**What the card says.**

- **Re-cut from your note: "start two seconds later"** — the new rough cut is
  the one the Watch link opens, and the line above it says *recut 1 time*.
- **Could not re-cut from your note: …** — the note could not
  become a valid edit (the AI said it cannot be done by choosing what to keep,
  such as adding music, or its answer broke a rule). The rough cut and the
  edit are exactly the ones he sent back. This does not count as a re-cut;
  send it back with a different note to try again.
  A reason longer than the card holds (2,000 characters) is cut at a word and
  ends in "…", so it always fits: a reason the catalog refused would otherwise
  be retried, and the AI paid again, every fifteen minutes.
- **Re-cut 3 times; tell an agent session what is still wrong**
  — after three re-cuts of one edit the Mini stops rather than looping, and
  every later send-back of that edit gets the same answer without paying for
  another AI call.

**When it waits instead** (nothing on the card changes; the edit stays
**sent back**):

- **No AI provider can pay, or no network.** The job waits an hour and the bus
  hears once per six hours (`reel-spinner-recut`), the same rule scoring uses.
- **ffmpeg missing, the disk too full, the catalog not answering.** The job
  waits 15 minutes. All of these are checked before the AI is asked, so a
  machine problem never wastes an answer.
- **No working copy on the Mini**: the job is blocked with the fix in its
  reason.
- **The catalog refuses the hand-back itself** (a 400, which sending again
  cannot fix): the job is blocked with the reason instead of retried.

**A render or upload that fails after the new edit is chosen** marks the edit
`failed` and queues an ordinary rough-cut job for the recording, which renders
it from the saved new edit. The AI is not asked again.

## Background music (Reel Spinner step 5a)

Dane chose on 2026-11-16 that music is **"Picked for you"**: nobody chooses a
track by hand. Each edit gets one track from a fixed shelf, matched to the mood
the scoring found for it.

**Where the music comes from: Kevin MacLeod's library at incompetech.com,**
under the Creative Commons Attribution 4.0 licence. Why this one, over Pixabay
Music (the other candidate):

- **Use on YouTube is allowed with no payment, ever**, including on a channel
  that earns money, as long as the video's description credits the track. The
  credit line is on every track in the manifest (`attribution`); the YouTube
  step (6b) copies it into the description.
- **Every track has its own page and a fixed licence.** The licence cannot be
  changed under us later, and each track's page is a stable link.
- **Content ID.** Kevin MacLeod does not register his music with YouTube's
  Content ID, which is what raises automatic copyright claims. Pixabay's
  library is uploaded by thousands of contributors, some of whom have later
  registered their tracks with Content ID, which is how a "free" Pixabay track
  ends up claimed on a video months after it was used. A claim can still
  happen by mistake (someone else registering a remix); the fix is to dispute
  it on YouTube citing the CC BY licence and the track page in the manifest.
- **The catalogue is machine-readable**, so each track's length, tempo and page
  come from incompetech itself rather than being typed by hand.

**The shelf:** thirty tracks, five for each mood (hopeful, urgent, reflective,
determined, playful, calm), in **Studio › Music** on Drive
(folder `1By_hHjk2hwIXsuZCmTus-PBXriO1aTpH`). The list of what is on it, with
each track's licence, credit line, mood, length and Drive file id, is
`lib/studioMusicShelf.json`, committed. It lives in `lib/`, not beside the
picker in `workers/`, because the website reads it too and Vercel never
uploads `workers/` (a website require into that folder fails the deploy).
The audio files are never committed. The titles were chosen by hand for sitting under someone talking:
no vocals, no novelty pieces, between about two and five minutes long.

**How a track is picked** (`workers/studio/music.js`):

1. A track of the edit's mood. A full edit takes the mood of its best-scoring
   moment. An edit with no mood, or a mood the shelf has nothing for, gets the
   **calmest** track (the slowest calm one) and the pick says so.
2. Never the same track as the previous edit of the same recording.
3. Long enough to run under the whole edit, if any is.
4. The edit's own id decides among what is left, so the same edit always gets
   the same track and different edits spread across the shelf.

The pick is stored as the track's id in `video_edits.music_track`; the
rough-cut card (4c, SC-835) shows its title and artist from the manifest
(`lib/studioMusicShelf.js` `trackLabel`), or "No music picked".

**Adding or changing tracks:** edit the list in
`scripts/studio_build_music_shelf.cjs` and run `npm run studio:music-shelf`.
It is a dry run that checks every download and licence link opens; add
`-- --apply` to upload what is missing and rewrite the manifest. Tracks
already on Drive are reused, so a second run uploads nothing. It uploads under
the Studio worker's sign-in (mentor24), whose storage it uses: about 200 MB.

## Title and end cards (Reel Spinner step 5b)

Every finished video opens on a **title card** (the video's title) and closes
on an **end card** inviting the viewer to the project the video speaks to.
This step makes the cards as pictures (1920 × 1080 PNG); putting them into a
video is 5c.

**The words come from a Context note**, never from code: in the Dane of Earth
project, on Assets › Context, the note titled exactly **`Reel Spinner — end
cards`**, switched on for Reel Spinner. One line per project:

```
WaveCenter | Come and help build WaveCenter with us | wavecenter.com
```

Name, a one-line invitation, and the address, split by `|`. A line with no
`|` is ignored, so the note can carry a sentence saying what it is. Seeded on
2026-11-19 (note `e24a9965-28bc-4097-9b76-ff1f99d1bd57`) with the three
addresses this repository already confirms: wavecenter.com, alphire.agency,
starcaster.pro. DEO and Spirality were asked of Dane rather than guessed, and
added the same day from his answer: **DEO points at wavecenter.com** and
**Spirality at daneofearth.org/spirality**. All five projects have a card. Change the wording on the Context page;
nothing needs redeploying. (Because it is switched on for Reel Spinner, the
moment scoring reads it too, alongside the channel brief; scoring only shows
it was done under older notes, it does not rescore by itself.)

**Which end card** (`workers/studio/cards.js` `endCardProjectFor`): a short
takes the project of the moment it was cut from; a full video takes the
project its moments name most often (a tie goes to the higher total score,
then to the order WaveCenter, DEO, Alphire, StarCaster, Spirality); a
**personal story gets the WaveCenter card** (Dane: "especially WaveCenter").

**It never makes a blank card.** No note, a note switched off, or a project
with no line stops with the reason, for example
`no end card for DEO in Reel Spinner — end cards`.

**Nothing runs off a card.** The text is wrapped by `cards.js` itself, at the
largest size that fits, from a generous estimate of letter widths; a title too
long to fit even small is cut with "…" and says so. The browser then draws
each line unbreakably and the picture is MEASURED: anything past its box and
the card is refused, not saved. Drawn by the Chromium the UI harness uses,
from `workers/studio/card-template.html` (the Mini's ffmpeg has no text
drawing).

```
npm run studio:cards -- draw --project <id> --title "<title>" --out <folder>
npm run studio:cards -- draw --notes-file <file> --title "<title>" --out <folder>
npm run studio:cards -- seed --project <id> --notes-file <file> [--apply]
```

`draw` writes a title card and one end card per line; `seed` creates the note
(a dry run without `--apply`, and refuses if the note already exists). On the
Mini, run either from `~/Studio` under `doppler run` so it reads production.
Exit 0 done, 1 refused, 2 could not tell.

## YouTube (Reel Spinner step 6)

Finished edits upload to the **Dane of Earth** channel (Dane's choice,
2026-11-16), as Private first, made visible only after he approves them (6c).

**Which sign-in.** Its own setting, `YOUTUBE_UPLOAD_REFRESH_TOKEN` in Doppler
(`starcaster` / `prd`, so the Mini's `~/Studio` scope reads it), signed in as
the account that owns Dane of Earth, with the `youtube` permission (upload,
read the channel, change a video's visibility, delete). It uses the existing
Google Cloud OAuth client (`GOOGLE_DRIVE_CLIENT_ID` / `_SECRET`, project
`starcaster-498505`). The Drive sign-in (`GOOGLE_DRIVE_REFRESH_TOKEN`) was
checked first on 2026-11-17 and carries Drive permission only — YouTube
answered "insufficient authentication scopes" — so it cannot upload.

```
npm run studio:youtube-login         # Dane's browser login, once; stores the token, never prints it
npm run studio:youtube-check         # read-only: which channel, is upload permission there?
npm run studio:youtube-test-upload   # one 5-second Private test video, made unlisted, then deleted
```

`studio:youtube-check` prints `channel:` and `upload:` and exits 0 ready,
1 not ready (Google answered no), 2 could not tell. It uses the upload
sign-in when it is set and the Drive sign-in otherwise, and names which.
`studio:youtube-login` refuses to store a sign-in for any channel but Dane of
Earth, because the wrong account is the likeliest slip and would upload to
the wrong place. It needs no checkout of its branch: it uses only Node's own
modules, so `git show <ref>:scripts/studio_youtube_login.cjs | doppler run
--project starcaster --config prd -- node -` runs it straight from git.

**It does not open the browser itself; it waits at `http://localhost:53682/start`,
to be opened in a PRIVATE window.** The first attempt (2026-11-17) opened
Google in Dane's everyday browser and ended, after "Advanced → Go to the app",
on Google's page "The server cannot process the request because it is
malformed". The address was sound: Google accepts it and the return address is
registered on the client, both checked that evening. So the failure was inside
Google's own sign-in pages, where the usual cause is a browser signed in to
several Google accounts at once. A private window starts signed in to none.

**The Private lock.** YouTube used to hold every video uploaded through an
unaudited Google Cloud project at Private, which would have stopped this step.
Google's `videos.insert` page now says the opposite (read 2026-11-17):
*"Videos uploaded from unverified API projects are not restricted to private
viewing mode."* The test upload is the proof for this project: it asks for
unlisted (the lock blocks every visibility but Private, so unlisted answers the
question without the test ever being public) and reads the answer back.
Audit state: **not locked, no audit needed** — measured 2026-11-17, 8:40 PM MT,
from the Mini, after the sign-in was in place. The probe printed
`channel: Dane of Earth` / `upload: yes`; a Private test upload was changed to
unlisted and read back `unlisted`, then deleted and confirmed gone.

**Read the change back after a pause, not at once.** The first run that
evening got `unlisted` as the update's own answer and then `private` from an
immediate read, and reported LOCKED. Run again with the read repeated for up
to 30 seconds, it read `unlisted`. So YouTube's read can lag its own write by
a few seconds. The script now waits out that lag; anything in 6c that changes
a video's visibility must do the same before believing either answer.

**Daily allowance**, from Google's quota page (read 2026-11-17): uploads have
their own bucket, **100 uploads a day, each costing 1**; everything else shares
**10,000 units a day**, where changing or deleting a video costs 50 and reading
one costs 1. So upload count is the limit that matters, at 100 a day, far above
what Reel Spinner will make. The project's own figures are on the Google Cloud
console's Quotas page for `starcaster-498505` (a browser login).

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
- Cut marks (Reel Spinner 1a): `docs/SQL/video_cut_marks_setup.sql`
  (`video_cut_marks`, one row per source; apply after the catalog file);
  store in `lib/videoCutMarksStore.js`. Each row is a set of DECISIONS — the
  pauses, fillers, repeats and false starts to cut, in seconds — never an
  edited file, plus the word-for-word transcript they were found in, kept apart
  from `video_transcripts` so search and the Transcript view keep reading clean
  text. No row means "not looked at yet", never a state. `rules_version` lets a
  later rule change find old rows and redo them; `cut_s` is derived from the
  marks by the store, never supplied.
- Moments, sound pairs and edits (Reel Spinner 2b, SC-827):
  `docs/SQL/video_reel_spinner_setup.sql` (apply after the catalog file).
  Three tables, every row a set of DECISIONS and never an edited file:
  - `video_moments`, one row per source: the scored moments (start, end,
    score 0-100, reasons, project, mood, quote). Store
    `lib/videoMomentsStore.js`; `requestRescore` stamps
    `rescore_requested_at`, and a score clears it only if its run began
    after the stamp (`runStartedAt`, required), so a rescore asked for
    mid-run is kept for the next one. Written by the Mini's scoring pass,
    `workers/studio/momentsPass.js` (Reel Spinner 2d), whose rules are
    `workers/studio/moments.js` (2c); `listRescoreRequests` is what its
    `moments.rescore` watcher reads, `listMomentStates` what
    `scripts/studio_backfill_moments.cjs` reads.
  - `video_audio_pairs`, one row per pair of recordings made together, filed
    with the smaller source id as A whichever way round it is asked; offset
    and drift are measured from A to B. Store `lib/videoAudioPairsStore.js`.
    Dane's choice of sound (`chosen_by = 'dane'`) survives later measurements:
    the measured pick is an update guarded on `chosen_by=eq.measured`, never a
    read followed by a write.
  - `video_edits`, one row per output (one full edit per source, one short per
    moment). Store `lib/videoEditsStore.js`, which holds the allowed status
    steps (`EDIT_STEPS`) and refuses any other move naming both statuses.
    The Mini moves edits with `moveEdit`; the website writes only Dane's
    verdict and the YouTube text with `reviewEdit` (a send-back must carry
    its own note in the same call), and the Mini finds those
    with `listEditsByStatus` because the website cannot reach its queue.
    Every move is guarded on the status it was read in.
  Shared input rules: `lib/reelSpinnerInput.js`. `video_edits` is written by
  the Mini's rough-cut pass, `workers/studio/roughCutPass.js` (Reel Spinner
  4b, SC-834), which creates the rows from `editList.js`'s plan, renders each
  with ffmpeg and uploads it with `lib/googleDrive.js` `uploadFileResumable`
  (a file read from disk in 8 MB pieces, never held in memory whole);
  `scripts/studio_backfill_roughcuts.cjs` is its catch-up.
- Music (Reel Spinner 5a, SC-837): the picker `workers/studio/music.js`
  (pure; tests `scripts/builder/studioMusic.test.js`), the committed manifest
  `lib/studioMusicShelf.json`, and the one-time builder
  `scripts/studio_build_music_shelf.cjs` (`npm run studio:music-shelf`).
- Title and end cards (Reel Spinner 5b, SC-838): `workers/studio/cards.js`
  (choosing, fitting, drawing; tests `scripts/builder/studioCards.test.js`),
  the template `workers/studio/card-template.html`, and
  `scripts/studio_cards.cjs` (`npm run studio:cards`).
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
