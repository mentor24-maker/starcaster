## 2026-11-25 — Show and set a separate AI provider for each group of features on Settings › APIs (AI provider groups 2) (#1105)

Settings › APIs › AI provider now has a "Feature groups" section: one row each
for Outreach, Studio / Reel Spinner, Writing, Acquire and Everything else. Each
row can follow the main provider order (the default, today's behaviour) or have
its own, and it says in plain words what it covers and which provider answered
its most recent AI call, and when (Mountain time). So Dane can put Outreach on
OpenAI while everything else stays on Anthropic, and can check that it really
happened, without having to assume it.

Clicking Save stores the main order and the group orders in a single save and
reads them back before saying "saved". Four gaps found when the previous ticket
was reviewed are closed too. If only a group's order has been saved, every part
of the system now treats the main order as "not saved yet" rather than "all
off". The AI key check now also covers a key that only a group uses. Removing a
service takes it out of every group's order as well, and the save is refused if
that would leave a group with nothing switched on. And one save gives one "last
saved" time.
