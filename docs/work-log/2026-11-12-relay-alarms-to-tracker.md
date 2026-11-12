## 2026-11-12 — StarCaster's bus-relay, pulse, weekly report, review gate and app still call ClickUp: switch them to the tracker (#1004)

Slice 1 of 6 (Dane chose to split the job, answering "A" on SC-791).

When StarCaster moved its tickets to the tracker this morning, one job on the
Mini was left calling a ClickUp command that no longer exists, so it failed
every ten minutes. That job's real work (moving Dane's answers, merging on his
word) is already done by the tracker's own relay, so the dead step is simply
gone and the job finishes cleanly again.

The bigger change is where alarms go. Every watchdog on the Mini (the ones
that notice a job going quiet, the queue stalling, a key running out of
credit, and so on) sends its warning through one shared helper. That helper
now posts to the tracker's bus, the "Team chat" ticket in the starcaster-bus
project, and checks the post landed. Before this, those warnings were aimed
at ClickUp. One of them, the repair check, had been sending its findings into
nothing since the move.

The other five slices are their own tickets, SC-792 to SC-796.
