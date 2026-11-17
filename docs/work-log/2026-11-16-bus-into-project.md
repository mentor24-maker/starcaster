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

**Sent back once, and why.** The starcaster project already held an older
ticket under every board name: the copies brought over from ClickUp in
September (SC-404 "Team chat" and five more). The bus finds its boards by
name, and when two share a name the older one wins, so after the move every
alarm would have landed on the September archive instead of the live board.
The move is now one script, `npm run bus:move-in` (it only shows its plan
unless given `--apply`). It first renames each old copy "… (ClickUp archive)",
keeping all its history, then moves the bus tickets in, tags each board, and
checks at the end that exactly one ticket of each name is left. The old pause
switch is archived too, so the pause button keeps behaving exactly as it
does today.

**Sent back a second time, and why.** Three gaps in the move script. First,
the pull request promised that between the merge and the move StarCaster's
posts would fail loudly; in fact they would have landed quietly on the old
September Team chat. The script now takes `--since <merge time>` and lists
every comment that reached an old copy after that moment, so nothing posted
in the gap is lost. Second, the script would have archived any ticket named
"Pipeline pause switch", including a fresh one made by somebody pausing the
pipeline in that gap, which would have silently lifted the pause. It now
archives only copies created before the bus's own boards existed, and never
a switch that has been written to since. Third, adding the `noticeboard` tag
to the project is now read back before anything is renamed or moved.
