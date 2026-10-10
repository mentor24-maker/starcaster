# Freeing the MacBook of files already on Google Drive

Media intake 5 of 5 (ticket 86bcfgyza). Dane's rule, 2026-10-08: **only
MacBook copies are ever removed, only after he approves a dry run, and a file
goes only when a byte-identical copy is on mentor24 or mentorofaio at that
moment.** Google Drive, iCloud Drive, Apple Photos and the Time Machine drive
are never touched.

Both steps live in `npm run archive:mac` (rules in `lib/archiveMac.js`, tests
in `scripts/builder/archiveMac.test.js`). Run them **on the MacBook**: the
files are there and nowhere else.

## Batch 1 — the archived Trash folder (173 GB)

`~/.Trash/Archived-from-Mac-20261004-0327` is what `archive:mac clear --apply`
moved on 2026-10-04 and nobody emptied.

```
npm run archive:mac -- trash            # dry run: changes nothing
npm run archive:mac -- trash --apply    # only after Dane approves the dry run
```

The dry run fingerprints every file in the folder now and lists both Drives
with Drive's own MD5s. Each file is one of:

- **emptied** — its bytes are on a Drive right now;
- **put back** where it came from — no Drive has its bytes;
- **held back** — unreadable, a cloud placeholder, or another file now sits in
  its old place (putting it back would overwrite that file).

## Batch 2 — the MacBook copies in the duplicates report

`npm run archive:index` (4 of 5) writes `~/archive-index/proposed-removals.tsv`.
Its `mac` rows are copies of something kept elsewhere.

```
npm run archive:mac -- report           # dry run: changes nothing
npm run archive:mac -- report --apply   # only after Dane approves the dry run
```

A copy moves **to the Trash** (not deleted, so a mistake is one drag back)
only if its bytes still match the report and a Drive holds them now. A copy
whose only other copy is in iCloud stays.

## What both share

- **`--apply` does exactly the dry run's list, and checks each file again.**
  A file that changed since the dry run, or whose Drive copy has gone, is held
  back and listed. A file the dry run never saw is left alone.
- **Every change is undoable from the log.** `~/archive-index/mac/restore.log`
  holds, for each file, the one command that reverses it: `rclone copyto …`
  to bring a deleted file back from Drive, `mv -n …` for a move.
- Exit codes: 0 everything settled, 1 something was held back (listed), 2
  could not take a reading (no dry run, a Drive could not be listed).

## What was freed

Filled in after each approved run: date, batch, files, GB, and the free disk
space before and after.
