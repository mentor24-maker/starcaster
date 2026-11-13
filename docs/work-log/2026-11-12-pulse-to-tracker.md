## 2026-11-12 — Switch the pipeline pulse from ClickUp to the tracker (#1006)

The pipeline pulse is the hourly check on the Mac Mini that asks "is the
pipeline actually moving?" and posts to the bus when it is not. After
StarCaster's tickets moved to the tracker it was still reading the old
ClickUp list, which nothing writes to any more, so its answers were about a
queue that no longer exists.

It now reads every ticket from the tracker in one read, keeps its report as
the "Pipeline pulse" ticket in the bus project (rewritten in place every hour
and read back after each write), and recognises Dane's merge word by his
tracker account.

Two false alarms from the same move are fixed with it. The pulse read the
build lane's old log file, which stopped growing when the lanes moved to
Spirality's runner, so it said the build loop had not run for 18 hours while
it was building. And it only counted a pass as having taken a ticket if the
pass named a ClickUp id, so every pass on the tracker looked idle.

The pause switch and the heartbeat's shared row, which each pass also
touches, still use ClickUp; the heartbeat is SC-794.

**Second round, after review.** Review found the pulse still could not tell
which ticket an open pull request belongs to: it only recognised ClickUp
links, and every pull request since the move links to the tracker instead. So
two of its warnings — "this ticket is finished but its pull request is still
open" and "a pull request names a ticket that has no record of it" — could
never go off, while the report still said how many tickets it had compared.
It now uses the same link reader the review gate uses, so the two cannot
disagree, and a test proves both warnings fire for tracker tickets.

Three smaller holes closed in the same round: if Dane's tracker account
number could not be read, his "merge" replies were silently ignored (now the
report says it cannot tell, and why); a wiped report read back as "cut short"
instead of "empty"; and one test was passing only by coincidence.
