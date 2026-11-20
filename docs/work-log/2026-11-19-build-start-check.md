## 2026-11-19 — Bring back the fast-track "was this ticket already started?" check that build-start used to do (#1088)

Before a session builds a ticket by hand, it is supposed to ask one question:
"has somebody already started this, on this machine or another one?" That is
what stops two pull requests being built for the same ticket. The check
quietly stopped working when the tickets moved off ClickUp, because the
command that asked it was not carried into the new ticket tool.

It is back as `npm run build-start -- --task <id>`. It gives the same three
answers as before: go ahead, carry on with the work it found, or "could not
tell". If it cannot read the ticket, it always says "could not tell". It never
says "go ahead" on a check that did not run. The ticket reader also keeps a
ticket's tags now, so the check looks in the right project folder.
