## 2026-11-18 — Approve, skip or send back rough cuts on Footage (Reel Spinner 4c) (#1063)

Assets › Footage now has a **Rough cuts** screen. It is the one place Dane
watches each rough cut the Mac Mini made and says yes, no, or "change this".
Nothing gets finished without his yes.

Each rough cut shows whether it is the full video or a short, how long it is,
how much was taken out, why a short was picked (its score and reasons), a link
to watch it in Drive, and three buttons: **Approve**, **Skip** and **Send
back**. Send back asks for a note saying what to change, and will not send
without one. The line at the top ("2 waiting for you · 1 approved · …") counts
each kind and doubles as a filter. When the list is empty it says why: the Mac
Mini has not made any yet, is still making some, or nothing is waiting.

The website only records his answer and his note; the Mac Mini acts on them.
After each click the screen reads the list back from the database, so what he
sees is what was saved, the same as after a reload.

**Second round, after review.** Each rough cut now also says which music is
under it, in words ("Music: Inspired, Kevin MacLeod", or "No music picked").
The list of music moved from the Mac Mini's folder into the shared code
folder, because the website is never given the Mac Mini's folder and could
not have read it there. The screen also reads the cuts waiting for Dane on
their own, so a project with hundreds of finished edits can never hide the
one that is waiting. A note that is not text is now refused instead of being
saved as gibberish, and after a refused click the list reloads so old
buttons do not linger.
