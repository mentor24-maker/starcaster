## 2026-11-16 — Give every existing StarCaster ticket a kind, who started it and how it ended (#1021)

Dane wants to report on how productive the system is, and until now every
ticket counted the same: a merge-conflict fix-up, a new feature and a dropped
ticket were each "one finished ticket". The tracker gained three labels for
that (Spirality's SP-345), and this filled them in on all 816 StarCaster
tickets.

- **Kind**: 387 Features, 316 Fixes, 75 Operational, 38 Documentation.
- **Started by**: 659 by Dane, 157 by an agent session, none by a client yet.
- **How it ended**: 726 Done, 39 Won't Do, 43 Test, 3 Duplicate (5 still open).

A first sort went by tags, titles and the headings inside each ticket. Then
every title was read by hand and 241 labels corrected. Most of those were
features whose titles describe a problem ("Events can't repeat"), which a
word-match reads as a bug. Every label was written through the ticket tool,
which reads each one back: 816 set, none refused. A second run found nothing
left to change.

The choices are kept in `docs/ticket-classes/starcaster-2026-11-16.tsv`. To
correct a label, change its row and re-run
`scripts/backfill_ticket_class.mjs`, which only writes what differs.
