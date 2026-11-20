## 2026-11-19 — Add Read now to Reddit's Find conversations, and stop a normal wait looking like a fault (#1085)

Before this, after you approved a subreddit, Reddit's Find conversations said in red "Cannot tell … its schedule is not running" until the Mini's next four-hourly read reached it. You also had no way to ask for a read sooner. Nothing was broken. The screen just made an ordinary wait look like a fault.

Now there is a **Read now** button. Only the Mini's signed-in browser can read Reddit, so pressing it leaves a note for the Mini, and the screen says the Mini will pick it up within about ten minutes. A new ten-minute check on the Mini looks for those notes. When there are none, it stops at once without opening the browser, so your Reddit account sees no extra activity. When there is one, it does one normal read for that project (two subreddits, the never-read ones first) and removes the note. A just-approved subreddit now says calmly that it has not been read yet, and real problems keep the warning.

Two things are needed before it works live: running the new database file, and installing the Reddit schedules on the Mini. The four-hourly Reddit read was never installed there either.
