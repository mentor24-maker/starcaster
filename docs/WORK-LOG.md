# Work Log

Plain-English record of work shipped through the development loop
(spec → build → review → merge). Newest first. One entry per merged pull
request, written for a non-programmer: what changed and why it mattered.

This file is maintained automatically — each task's PR adds its own entry as
part of the change, so the log lands on `main` at the same moment the work does.
See `docs/LOOP_ENGINEERING.md` for how the loop works.

**Scope:** loop-shipped work only. Work done by hand in a normal session is not
here — so a quiet stretch in this log means the loop was idle, not that nothing
was built. The log starts when the loop did.

---

## 2026-08-18 — The loops get their own door into ClickUp

The build and review loops used to reach ClickUp through the claude.ai
connector, which has a shared usage allowance that every agent session drains
together — when it ran out, the loops went blind and work stopped, twice in two
days. Now the loops talk to ClickUp directly (`npm run clickup`) using the
project's own key, kept in the Doppler vault and never seen by any agent. The
new commands cover the whole loop: list the queue sorted so the first line is
always the right task to take, claim a task safely so two loops can never grab
the same one, read a task and its comments, move statuses with the handoff to
Dane handled automatically, and comment — every write verified by reading the
result back, so a save that silently didn't stick is impossible to mistake for
a success. Also fixed a trap where the skills wrote down the Starcaster *space*
id where the Loop Queue *list* id belonged, which ClickUp punishes with an
unrelated-sounding "Team not authorized" error — the ids now live in one
place, `docs/LOOP_ENGINEERING.md`.

## 2026-07-28 — Safety check for "local dev mode" detection (#52)

Added automated tests around the small piece of code that decides whether the
app is running on your local machine versus the live site. The logic itself
didn't change — the tests just lock in its behavior so a future edit can't
break it silently. First real task run through the development loop as a test
flight. No visible change to any website.

## 2026-07-28 — Set up the development loop (#51)

Built the "loop" system that lets AI agents pick up small tasks, build each one
in isolation, check it, and open it for your approval — the spec → build →
review workflow. Adds three reusable skills plus an operator guide
(`docs/LOOP_ENGINEERING.md`). Nothing about the live product changed; this is
the machinery we now use to ship the work below.
