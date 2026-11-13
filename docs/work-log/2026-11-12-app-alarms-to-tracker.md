## 2026-11-12 — Switch the live app's bug reports, AI alarms and YouTube worker posts from ClickUp to the tracker (#1009)

The live website was still sending two things to ClickUp, which nobody has
read since StarCaster moved to its own tracker earlier today: the "report a
bug" button filed its reports as ClickUp tasks, and the hourly AI spending
alarm and the Mini's AI brake posted their warnings to the ClickUp chat. So a
customer's bug report, or a warning that AI spending had run away, would have
landed somewhere no one looks.

Both now go to the tracker over the internet, at the Mini's public address. A
bug report becomes a ticket waiting on Dane, checked after it is filed so it
can never end up where a build loop would pick it up and build it. An alarm
becomes one post on the bus's Team chat ticket, checked after it is sent. The
old ClickUp code that did this is gone, so nothing can quietly go back to it.

It needs one setting before it works on the live site: the app's tracker
sign-in, `TRACKER_TOKEN_APP`, in Vercel, then a redeploy. That is a secret
value, so it is Dane's to put in; it is asked for on its own ticket. Until
then reports are still saved and emailed, and the failure is logged by name.
