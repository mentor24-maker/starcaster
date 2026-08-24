# The Approvals surface (Charter Q5)

**Where Dane approves things, what his answer means, and how agents file so
every approval looks the same.**

Rewritten 2026-08-23. The first version of this page described a **separate
Approvals list** that would have to be created. Dane chose otherwise (option A
on task `86bbgcy1f`): write down the rules for the surface that already works,
and move nothing. The reasoning is at the bottom, so nobody proposes the list
again without reading why it was declined.

## There is no Approvals list. There are two statuses.

Approvals already reach Dane through the **Loop Queue**, on two of its six
statuses. Nothing else is involved:

| He is being asked to | Status | What his answer does |
|---|---|---|
| **Look and approve a merge** | `Ready to launch` | one word merges the PR and the ticket goes `Live` |
| **Answer a question** | `Needs your input` | any answer hands the ticket back to `Queued` and a build pass picks it up |

Everything else on that list is a machine's turn, not his.

**Assignment is the signal.** A ticket that needs him is assigned to him; a
ticket in a machine status has its assignees cleared. So his "what needs me"
view is ClickUp's own **Assigned to me** — not a hand-built filter, which is
what lets it span the Starcaster and Dane of Earth spaces at once.

A ticket sitting in a machine status with Dane still assigned is a bug, not an
untidiness: it puts noise in the one view he trusts.

## One-click approve

On a `Ready to launch` ticket, Dane comments **one word**:

> `merge` · `merge it` · `ship it` · `approve`

Case does not matter and a trailing `!` or `.` is ignored, but the **whole
comment** must be that phrase — a sentence containing the word "merge" is not
an instruction, deliberately. The hourly bus-relay pass reads it, checks the
PR, merges it, and moves the ticket to `Live`.

What it checks before merging, and none of it is skippable: the PR is open, not
a draft, has a passing `verify` check, and does not conflict with main. A PR
reporting **no** checks at all is refused too — that is a PR nothing verified,
not a green one.

**To reject, just say why.** There is no `reject` keyword. An ordinary comment
on a `Needs your input` ticket IS the rejection or the correction, and the
ticket goes back to the build queue carrying it.

## What happens when it cannot merge

Two different outcomes, and they mean different things:

- **Refused** (checks red, still running, no PR recorded) — *your approval
  still stands.* The relay re-decides it every pass and it goes through by
  itself once the reason clears. You do not say "merge" again.
- **Handed to a human** (a genuine conflict) — *your approval does not carry
  over.* Someone has to resolve the branch, and then it needs a fresh `merge`
  from you.

The comment on the ticket says which one it was.

## Visual changes arrive as pictures, not as a branch to check out

Any change to what a page renders is photographed before and after by
`npm run check:shots`, and the pairs that differ are attached to the ticket:

```
PORT=3058 node server.js
UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:shots -- --task <id>
```

So the decision Dane is asked for is *"does this look right"*, not *"go and
build this branch and see"*. It runs on **every** task, not only the
visual-looking ones — an agent deciding for itself that its change is not
visual is the exact failure it exists to prevent. When nothing rendered
differently it files nothing and says so, so a non-visual PR never interrupts
him. Full rules: `docs/VISUAL_REVIEW.md`.

## How an agent files something for approval

- **Move the ticket, do not just comment.** `Ready to launch` for a merge
  decision; `Needs your input` for a question. Both assign Dane automatically.
- **A question needs the operator card** — `@@ASKED / @@WHEN / @@CONTEXT /
  @@NEEDED`, filed with `npm run clickup -- ask`. A status move with no stated
  ask is a red badge with no answerable question on it, which is how a ticket
  sat for a day on 2026-08-22.
- **Detail goes in the description, the ask goes in a comment.** ClickUp shows
  the description wide on the left and comments narrow on the right. Reasoning
  posted as a long comment arrives as a wall of text in the skinniest part of
  the screen.
- **Record the PR with `pr-opened`, always.** A `Ready to launch` ticket with
  no `PR opened:` line is a ticket the relay *cannot* merge — his "merge" is
  refused with "nothing to merge". Two tickets were sitting in exactly that
  state on 2026-08-23, one of them blocking a whole epic. The command verifies
  its own write; a non-zero exit means the handoff failed.
- **Never set `Ready to launch` yourself, and never clear `Needs your input`.**
  Those two are the operator's lane. A loop may put a ticket *into* `Needs your
  input`; only he, or the relay acting on his comment, takes it out.

## Why there is no separate Approvals list

It was specified on 2026-08-18 and declined on 2026-08-23, after measuring what
it would cost. The Loop Queue's id `901418546619` is hard-coded in **18 places
across 11 files** — the three loop skills, `LOOP_ENGINEERING.md`, the relay
itself, the reconciler, the screenshot pipeline, and more. Every one assumes an
approval stays on that list.

Moving approvals to their own list means re-pointing all of them and keeping
one-click merge alive across two lists at once. That is its own epic, and it
buys a tab.

**If a dedicated view is wanted, it is a saved view in ClickUp, not a new
list** — same tickets, filtered, made by clicking. Nothing moves, so nothing
breaks.

## What this is not

- Not a merge queue of its own — `Ready to launch` is the merge queue.
- Not a question inbox of its own — `Needs your input` is that.
- Not automatic. Nothing an agent files here ships without his word.
