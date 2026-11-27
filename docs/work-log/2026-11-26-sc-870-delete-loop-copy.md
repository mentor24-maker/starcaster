## 2026-11-26 — Delete StarCaster's copy of the loop once its lanes run from Spirality (#1109)

StarCaster used to carry its own copy of Spirality's ticket tool, in a folder
called `loop/`, copied across by hand. Whenever Spirality fixed something,
StarCaster kept doing the old thing until somebody remembered to copy the fix,
and nothing warned anyone. That is how a question card on SC-832 handed Dane
SQL with no clickable link on 2026-11-17, eight hours after Spirality had a
check that would have stopped it.

Since 2026-11-25 StarCaster's lanes run from Spirality itself, so the copy was
dead weight. Dane chose option A on the ticket, and this change deletes it all:
the copied ticket tool, the copied lane runner and its helpers, and the copied
loop skills, about 34,000 lines.

Ten of those files were still read by StarCaster's own watchdogs (the review
gate on every pull request, the hourly pulse, the bus tools). They now read
Spirality's own copy. On the Mini that is the exact release folder the lanes
run. On GitHub's checks it is Spirality's public code, downloaded at the
release named in a new one-line file, `.spirality-release`. If neither can be
found, the tools stop and say what to do; they never pretend there are no
tickets.

That one-line file is the only thing left that could fall behind, so a small
check (`npm run spirality:pin`) now runs on the relay's wake. When the lanes
move to a newer Spirality release and the file has not, it says so on the bus
once a day until they match.

The everyday commands did not change: `npm run clickup -- ...` and
`npm run doctor` work as before, now running Spirality's own door for this
folder. `npm run spirality:where` shows which Spirality folder was found, and
why.

**After review (same day).** Review sent it back for two real problems, both
fixed. First, when a script gave up on a slow ticket write and stopped it, only
the new go-between stopped; the write itself kept running and could land after
the script had already decided it failed, which would have meant duplicate
alarms. Stopping it now stops everything it started, and a test proves it.
Second, the go-between is now on the list of files a machine may never merge on
its own, just like the old copy was. GitHub's checks also now read the Spirality
release name the same careful way the rest of the code does.
