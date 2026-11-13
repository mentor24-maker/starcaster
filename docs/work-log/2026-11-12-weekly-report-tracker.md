## 2026-11-12 — Switch the weekly report from ClickUp to the tracker (#1005)

The Monday weekly report still reached ClickUp in three places: counting
tickets by stage, filing the "write the narrative" ticket, and telling the bus
when a run failed. StarCaster's tickets now live on the tracker on the Mini, so
all three would have failed. They now go to the tracker: the stage count reads
the `starcaster` project, the narrative ticket is filed in the `starcaster-bus`
project, and failure messages use the same bus helper every other alarm uses.

A test now fails if ClickUp ever creeps back into the report.

Found along the way: the report has not been written for four Mondays for an
unrelated reason. macOS stops the scheduled job from reading the Documents
folder. That is filed as its own ticket.
