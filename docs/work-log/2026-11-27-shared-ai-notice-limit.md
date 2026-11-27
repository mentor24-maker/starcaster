## 2026-11-27 — Share the AI fall-through notice's six-hour limit across server copies (#1115)

When an AI company we use runs out of credit or refuses its key, StarCaster
quietly switches to the next one and tells the bus "AI calls are using X". It
is meant to say that at most once every six hours. But the website runs as
many copies at once, and each copy kept its own count in its own memory, so
the same message came from every copy, and a copy that restarted forgot it had
already said it.

Now the time of the last message is written in one place in the database that
every copy reads, one line per AI company. Before posting, a copy asks that
line; only one copy can win the right to post in any six hours, even when two
decide at the same instant. If the database cannot be reached, the copy falls
back to its own memory, as before, and writes a warning saying so. An ordinary
AI call that works adds no database writes.

It needs a new SQL file, `docs/SQL/ai_fall_through_notices_setup.sql`, to be
run on production. Until then everything behaves exactly as it did.

**After review.** The review found that the AI door's tests would have written
test rows into the real notice table whenever this folder pointed at a
database, which on a production-connected run means production. Every test
door now carries its own fake notice table, and a tripwire fails any test that
reaches the real one. Also fixed: when an AI company starts working again, a
copy now clears only the notice time it knew about, not a newer one another
copy wrote for a fresh outage, so that newer notice is not repeated.
