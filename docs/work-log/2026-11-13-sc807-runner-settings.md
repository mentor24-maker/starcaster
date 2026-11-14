## 2026-11-13 — Make StarCaster's lanes follow the Settings page and skip Claude on an empty queue (#1014)

Dane set how often each of StarCaster's lanes should wake up on the tracker's
Settings page (build every 5 minutes, review every 10, the relay every
minute), but StarCaster's lanes ignored it and kept waking every 30 minutes,
because their copy of the runner was older than Spirality's.

This brings StarCaster's runner up to Spirality's. Each lane now reads its
wake time, its pause switch and its chosen AI model from the Settings page
before every pass, and — the part that saves money — checks the queue
first without starting Claude at all, so an empty queue costs nothing. The
relay now checks every minute and only runs when its time is up.

StarCaster's own safety checks are kept: the pipeline pause switch, Dane's
quiet hours, the usage-limit wait, and the heartbeat that tells the
watchdogs a lane is alive. A lane that skips because it had nothing to do
still sends its heartbeat, so a quiet, healthy lane is never reported dead.

After merging, the Mini's scheduled jobs are reinstalled once so the relay
switches to its one-minute tick.

**Review round 1 fix.** Review found that the work-in-progress limit could be
skipped: the runner only checks the limit while deciding whether there is any
work, and it skips that check on the first pass after it starts up and on the
pass it forces every six hours. Those passes went straight into building
without asking whether there was room. The build instructions now ask
`wip-check` themselves before taking a ticket, exactly as Spirality's do, and a
new test fails if that step is ever removed.
