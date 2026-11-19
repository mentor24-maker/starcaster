## 2026-11-19 — "npm run thread" refuses every ticket and "build-start" no longer exists, so a fast-tracked ticket cannot get its work folder the normal way (#1070)

`npm run thread` makes a fresh work folder for a ticket. After the move from
ClickUp to the tracker it turned every ticket away as "not open", because it
asked the ticket system a question the new system does not understand, and
took "I don't understand" to mean "this ticket is closed". The clean-up
command, `npm run tidy`, asked the same question and had quietly stopped
clearing away folders for finished tickets.

Both now read the ticket the normal way and get one of three answers: open,
closed, or "could not tell". Only a clear "closed" lets tidy delete anything,
and when the tracker cannot be read, `npm run thread` now says exactly that
and why, instead of wrongly calling the ticket closed. Bringing back the
"was this ticket already started?" check is the next slice (SC-877).
