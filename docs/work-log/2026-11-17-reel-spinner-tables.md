## 2026-11-17 — Add the tables Reel Spinner keeps its moments, sound pairs and edits in (Reel Spinner 2b) (#1025)

Reel Spinner turns Dane's recordings into finished YouTube videos and shorts.
Its later steps score the best moments, line up an iPhone take with its Zoom
recording, and take each edit from rough cut to YouTube. None of them had
anywhere to write down what they decided. This adds three empty tables for
those decisions, plus the code that reads and writes each one:

- **Moments**: the best parts of each recording, scored 0 to 100, with the
  reasons for each score.
- **Sound pairs**: which two recordings were made together, how far apart
  they start, and whose sound to use. If Dane picks the sound himself, a later
  measurement keeps his pick, even if he picks it at the very moment a
  measurement is being saved.
- **Edits**: each video or short as it moves through its steps. A step can't
  be skipped: an edit can't jump from "draft" to "on YouTube", and any attempt
  is refused with a message naming both steps. The website can only record
  Dane's verdict and the YouTube text. The Mini does the rest.

Every row records which client project it belongs to. That record is the gap
that once left 550 rows with no owner. The tables stay empty until Dane runs
the setup file on production, and `npm run sql:unapplied` lists the file until
he does.

**After review sent it back**, three gaps were closed where something Dane did
could be lost while the save still said "success":

- His choice of sound could be overwritten if he made it in the split second
  a new measurement was being saved. The protection is now part of the save
  itself, so timing cannot beat it.
- Asking for a recording to be scored again while a scoring run was already
  going used to be wiped out by that run's answer, even though the run had
  scored the old version. Now the request stays until a run that started
  after it answers.
- Sending an edit back a second time without a new note was accepted, using
  the old note from the first time. Now each send-back needs its own note.
