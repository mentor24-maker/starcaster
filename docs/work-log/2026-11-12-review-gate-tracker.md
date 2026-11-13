## 2026-11-12 — Switch the review gate from ClickUp to the tracker (#1008)

The review gate is the check GitHub runs on every pull request to ask "did
the review loop sign this off?". It looked that up in ClickUp, which stopped
changing when StarCaster's tickets moved to the tracker, so its answers were
going stale.

It now asks the tracker instead, at the tracker's internet address (GitHub's
machines cannot see the Mini's home-network name), and posts any deliberate
override to the tracker's bus. It no longer talks to ClickUp at all.

It needs its own tracker sign-in, stored as a GitHub secret named
`TRACKER_REVIEW_GATE_TOKEN`. Putting that in is Dane's (it is a real secret),
and the ticket asks for it. Until then the gate says plainly that the secret
is missing; it is still advisory, so it blocks nothing.

Found on the way: the gate script is not loaded by any test, so a mistake
inside it could pass every check. A new test now runs the script itself.
