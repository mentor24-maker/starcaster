# Studio — the operator's guide

The Studio is the part of StarCaster that collects every video you record,
on every device, into one list. You drop footage into a folder on Google
Drive; a program on the Mac Mini picks it up, reads what it is, makes a
lighter copy for editing, and writes it into a catalog. You see the catalog
in the admin app under **Assets › Footage**.

This is Phase 1: the pipeline and the list. Nothing here edits a video yet.

## What happens to a video, step by step

1. **You put a file in one of two Drive folders.**
   - `/Studio/Inbox/` — camera footage: you on camera, the wide shot, a phone
     take. The pipeline works out which is which from the file itself.
   - `/Studio/Plates/` — screen recordings and anything else that is a picture
     to put *into* an edit. Files here are never sent for transcription,
     because a screen recording has no speech and transcribing silence costs
     money.
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

## The Footage screen

Open the admin app, choose the project the Studio files into, then
**Assets › Footage**.

- **One block per session, newest session first.** Inside a block, files are
  in the order they were recorded — the order you would stack them in an edit.
- **Preview.** The small picture is Google Drive's own preview of the file.
  "No preview yet" means Drive has not drawn one (it takes a few minutes after
  an upload), or the file did not come from Drive. It is never a broken image.
- **Device** is the machine that made the file. *Not known yet* means the
  probe step has not read that file.
- **Role** is what the file is *in an edit*: `subject` (you on camera),
  `background` (the wide shot), `plate` (something inserted), `reference`
  (kept only to line the others up).
- **Recorded.** A date with a `*` after it is a stand-in: the file has not
  been read for its own recording date yet, so the screen shows the session's
  date or the day the file was added. Hover it and it says which.
- **Stage** is how far through the pipeline the file has got:
  `new` → `downloading` → `downloaded` → `probed` → `proxied` → `ready`, or
  `failed`.
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

**Ask the roll call.** Once the worker is installed on the Mini (Studio 7/8),
it records a heartbeat as the job `studio-worker` every time it runs, and the
same watchdog that watches the loops turns six hours of silence into a message
on the bus. From any machine:

```
npm run heartbeat
```

Until the worker is installed, that line reads **quiet** — which is true:
nothing is running the Studio anywhere yet. The install is one command on the
Mini, and it needs a shell on that machine.

**On the Mini itself**, once the worker is installed:

```
./scripts/install_studio_worker.sh --status
```

says whether the scheduled worker is loaded and running, and its process
number.

## When it stops, and what fixes it

| What you see | What it means | Who fixes it |
|---|---|---|
| Nothing new arrives, and the roll call says `studio-worker` is quiet | The worker is not running on the Mini — the Mini is off, asleep, or signed out | Wake the Mini; an agent session can then check it |
| Nothing new arrives, the worker is alive | Usually the Google Drive sign-in has expired. The pipeline stops asking and raises one warning rather than retrying all night | Dane — a browser login to Google renews it |
| Files stop at `downloading` | The Mini's disk is below the safety floor (50 GB), or the disk the cache lives on is not plugged in | Free space or plug the drive in; the pipeline resumes on its own |
| The Footage screen says "No footage yet" but files are in Drive | The worker files into ONE project, named by `STUDIO_PROJECT_ID`. You may be looking at a different project | Switch project, or an agent session corrects the setting |
| A file shows "No preview yet" for a day | Drive never drew a preview for it — some formats it cannot preview | Nothing; the file itself is fine |

## Settings the pipeline reads

These live in the Mini's environment, not in the admin app. An agent session
changes them; they are listed so the names mean something when they come up.

| Setting | What it controls |
|---|---|
| `STUDIO_PROJECT_ID` | Which StarCaster project the footage is filed under. Required — without it the pipeline refuses to file anything, rather than filing it under no project |
| `STUDIO_DRIVE_INBOX_FOLDER_ID`, `STUDIO_DRIVE_PLATES_FOLDER_ID` | The two Drive folders it watches |
| `STUDIO_CACHE_DIR` | Where downloaded originals are kept on the Mini |
| `STUDIO_DERIVED_DIR` | Where the proxies and audio tracks are written |
| `STUDIO_DISK_FLOOR_BYTES` | The free-space floor below which downloads stop (default 50 GB) |
| `STUDIO_PROXY_FLOOR_KBPS` | Files already smaller than this are not re-encoded (default 1500) |

## Where the pieces live

For an agent session working on this, not for day-to-day use.

- Catalog tables: `docs/SQL/video_studio_setup.sql` (`video_sessions`,
  `video_sources`); stores in `lib/videoSessionsStore.js` and
  `lib/videoSourcesStore.js`.
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
