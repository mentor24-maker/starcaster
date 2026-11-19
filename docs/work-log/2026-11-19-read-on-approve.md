## 2026-11-19 — Read a YouTube channel's comments as soon as Dane approves it (#1071)

Approving a YouTube channel in the Outreach wizard used to do nothing more
than mark it approved. Its comments were only fetched by the scheduled read,
which runs every three hours, so a channel approved just after a run sat as
"not read yet" in Find conversations for up to three hours. That is what made
Dane wait on 2026-11-18 and need an agent session to skip the wait.

Now pressing Approve saves the decision and then reads that one channel at
once, with the same code the scheduled read uses. The screen says it is
reading, then how many comments it found on how many videos. If YouTube
refuses, the daily quota is used up, or no YouTube key is set up, the
approval still stands: the screen says it was saved and why the comments
were not read, and the channel's row keeps that reason so Find conversations
shows it too. A channel read in the last hour is not read again, to save
quota. Rejecting a channel reads nothing.
