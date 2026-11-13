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
