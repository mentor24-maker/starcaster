## 2026-11-13 — StarCaster's lanes ignore the Settings page and start Claude on every empty pass: bring them up to Spirality's runner (#1013)

Dane saved new wake times for StarCaster's lanes on the tracker's Settings
page (build every 5 minutes, review every 10, relay every minute), but
StarCaster could not read them: its copy of the ticket commands (the `loop/`
folder) came from an older Spirality that had no such thing.

This pull request swaps that folder for a fresh, unchanged copy of the
current Spirality. StarCaster can now ask the Settings page for its wake
times, whether a lane is paused, and whether there is room under the
work-in-progress limit. One line was also added to StarCaster's project
settings file (`"manifestVersion": 2`), because the newer copy refuses to
run without it.

Nothing behaves differently yet. The next ticket, SC-807, teaches the lane
runner to actually use these answers, and to skip starting Claude when the
queue is empty.
