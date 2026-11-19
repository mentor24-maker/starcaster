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

**After review sent it back:** the messages under Find creators now tell the
truth about what happens next. If YouTube's daily allowance is used up, it says
when it resets and that the first scheduled read after that picks the channel
up, rather than promising a retry "within three hours" that cannot happen. If
the server has no YouTube key, it says so and promises nothing. A failed
approval no longer leaves "reading its newest videos now…" on screen beside
"the decision was not saved", sentences no longer end in two full stops, and a
channel whose videos have no comments says that instead of pointing at an empty
list.
