## 2026-11-17 — Write the rules that score a recording's best moments (Reel Spinner 2c) (#1026)

Reel Spinner can now be told "here is a recording, here is what my channel is
for, find the clips worth sharing." It reads the transcript, asks Claude once
for 20-to-60-second moments and a one-paragraph summary, and then checks every
clip itself: each one starts and ends on a whole word, never inside an "uh" or
a pause the edit will remove, stays inside the recording, and is the right
length. An answer it cannot use is reported as a failure with the reason, so
the review screen will never show "nothing interesting" when the truth is
"the answer was broken."

What "worth sharing" means is Dane's own channel note, passed in word for word,
not a viral-video checklist. With no note switched on, it refuses rather than
guess.

Not finished yet: the one real run against a real recording could not happen,
because the Anthropic account is out of credit. The ticket is parked on Dane
for the billing screen; once credit is added the run goes into the PR.
