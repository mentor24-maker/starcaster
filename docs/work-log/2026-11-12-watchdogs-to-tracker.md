## 2026-11-12 — Switch the watchdogs' ClickUp reads to the tracker (roll call, throughput, stale tickets, SQL and broken-links tickets) (#1007)

The watchdogs are the little checks that wake every ten minutes and ask "is
anything stuck or broken?" After StarCaster's tickets moved to the tracker,
their alarms already went to the tracker's bus, but most of them were still
reading the old ClickUp list, which nothing writes to any more. So they kept
saying "cannot tell", or looked at a frozen list and believed it.

All nine now read and write the tracker instead: the roll call of scheduled
jobs, the "is the queue getting shorter?" check, the two "stuck ticket" checks,
the reconciler that tidies tickets whose work already shipped, and the two
standing tickets that put work in front of Dane ("SQL waiting for you" and
"Broken links on client sites"). Those standing tickets, and the roll call,
now sit in the tracker's bus project next to "Team chat".

Three traps turned up while switching, and each is fixed:

- Each check remembered "I already wrote that" from its ClickUp days, so the
  new tickets would have stayed empty for up to a week. They start fresh now.
- The checks were looking for Dane by his ClickUp id, which never appears on
  the tracker, so his "merge" or his answers would never have been seen.
- The reconciler could not tell which ticket a pull request belonged to,
  because it only knew ClickUp's style of link.

Each check took a real reading on the Mini before this was opened. New tests
fail if any of them reaches for ClickUp again.
