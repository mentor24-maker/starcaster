## 2026-11-16 — Move StarCaster's bus into the StarCaster project (#1023)

StarCaster's "bus" is the Team chat ticket, where alarms and reports are
posted, plus four standing boards: Pipeline pulse, Node roll call, SQL
waiting for you, and Broken links on client sites. They used to sit in a
second tracker project, `starcaster-bus`. Dane asked for each project's bus
to live inside the project itself, so StarCaster's settings file now names
`starcaster` as its bus. The scripts also stopped guessing `starcaster-bus`
when the setting is missing.

Checking the places that look up Team chat turned up two problems:

- The review gate's lookup asked the tracker for open tickets only. Team chat
  is always in Live, which that list leaves out, so the gate could never
  have announced a waiver. It now asks for every ticket.
- With the work and the bus in one project, the pause switch's lookup would
  have listed every ticket twice. One switch ticket would then have read as
  two. It now counts each ticket once.

The tickets themselves move on the Mini right after this merges, using
Spirality's new `move` command. The steps are in the pull request.
