## 2026-11-16 — File the weekly report's narrative ticket in StarCaster's queue (#1020)

Each Monday the weekly report figures are built by a script, and it files one
ticket asking a build pass to write the words around them. When the report
moved from ClickUp to the tracker last week, that ticket started landing in
the bus project, which is a chat channel, not a work queue. Nothing ever
picks up work there, so the first one (SCBUS-6) just sat until it was moved
by hand.

The script now files the ticket in StarCaster's own queue, where a build pass
takes it, and a test fails if anyone points it back at the bus. Failure
messages still go to the bus, as before.
