# Loop Engineering on Starcaster

A "loop" is a standing instruction to the AI: **keep doing the next task on a
list, over and over, without me prompting each time.** You spend a few minutes
in the morning describing what you want; the agents build it, review it, and
open pull requests all day; you come back and merge the good ones.

This doc is the operator's guide. The three skills that make it run live in
`.claude/skills/loop-spec`, `.claude/skills/loop-build`, and
`.claude/skills/loop-review`. That path is not decorative: Claude Code only
discovers skills under `.claude/skills/`, so a skill parked anywhere else
cannot be invoked by name and `/loop 30m loop-build` fails to find it.

## The three steps

| Step | Skill | What it does | Who does it |
|---|---|---|---|
| 1. Spec | `loop-spec` | Interviews you, turns an idea into small, well-scoped ClickUp tasks with acceptance criteria | You + agent (your only manual step) |
| 2. Build | `loop-build` | Picks the next task, builds it in its own worktree, passes all build gates, opens a PR | Agent, on a loop |
| 3. Review | `loop-review` | Independently verifies each PR, then pings you to merge — or sends it back with notes | Agent, on a loop |

## The six statuses — and the two that are yours

The task list lives in a ClickUp list called **"Loop Queue"** in the
**Starcaster** space. Every ticket sits in exactly one of six statuses:

| Status | What it means | Whose move |
|---|---|---|
| `Queued` | waiting for a build loop to pick it up | machine |
| `Building` | a loop is writing the code | machine |
| `In review` | a loop is checking that code against the task | machine |
| **`Needs your input`** | stuck — a question or decision only you can settle | **yours** |
| **`Ready to launch`** | built and independently verified, waiting for your go | **yours** |
| `Live` | merged and shipped — closed, out of your open view | — |

The point of the split: the two human statuses ask different things of you.
`Needs your input` wants an **answer** — a loop has stopped and written you a
plain-language question in the ticket comments. `Ready to launch` wants a
**yes** — nothing is wrong, it is finished and waiting on the merge you alone
authorize.

Everything else is the machine talking to itself. On a normal day you can
ignore four of these six.

Two rules keep it honest:

- **No loop ever puts a ticket into `Live`.** Only a merge does, and only you
  authorize a merge.
- **No loop ever takes a ticket *out* of `Needs your input` or
  `Ready to launch`.** Once a ticket is handed to you it stays handed to you
  until you move it. A loop that could quietly reclaim its own escalation
  would defeat the whole checkpoint.

`Live` is configured as a **closed**-type status in ClickUp, not merely the
last active one. That is what makes finished work disappear from the open
view instead of piling up forever.

## How to run it

Two commands, each in **its own worktree** (a separate folder + branch so the
loops never step on each other — this is the #1 safety rule):

```
# In session/worktree A:
/loop 30m loop-build

# In session/worktree B:
/loop 30m loop-review
```

`/loop 30m X` means "run X, then run it again every 30 minutes." Build drains
the `Queued` pile into PRs; review drains the `In review` pile into
`Ready to launch` PRs that ping you.

Your day:
1. **Morning:** run `loop-spec`, answer its questions, approve the task list.
2. **During the day:** the loops build and review. You get a message per
   `Ready to launch` PR with a preview link and test steps.
3. **When you're ready:** tell CC "merge PR #NN" and it merges (only with all
   checks green). Merging stays manual on purpose — see Safety.

### The one view to check

Work waits on you in two different places: this Loop Queue, and the **Agent
Response** list that the channel steward feeds from the party line. Checking
two lists is two chances to miss something.

Make one saved ClickUp view — call it **My Turn** — filtered to everything in
a human status across both, and check only that. Setup is in
`docs/CLICKUP_VIEWS.md`.

## The work log — a plain-English record

Every task's PR also adds one dated, plain-English entry to `docs/WORK-LOG.md`
(newest first) — written for a non-programmer: what changed and why it mattered.
Because the entry rides inside the task's own PR, the log updates on `main` at
the exact moment the work merges; nothing edits `WORK-LOG.md` directly. Scroll
that one file any day to read, in English, everything the loops have shipped.

## Safety — why this is wired tighter than the YouTube version

The popular "just wake up and hit merge" demos run on throwaway apps. Starcaster
is different, so the loops have guardrails baked in:

- **`main` auto-deploys to production.** So no loop ever merges on its own. The
  review loop can only mark a PR `Ready to launch`; **you** authorize the merge.
- **Every loop runs in its own worktree.** Two agents in one folder clobber
  each other's files — the single most common way this repo breaks. The build
  skill creates a fresh worktree per task automatically.
- **Every build passes the full gate set before a PR opens** — `typecheck`,
  the builder tests, the conventions check, the syntax check, and the rebuild
  command for any generated file. A task that can't pass gets marked
  `Needs your input` for a human instead of shipping broken.
- **Review is independent.** It re-runs everything and actually opens the page
  in a browser; it never rubber-stamps the build loop.

## Cost — the part the demos skip

A loop is an agent running continuously, so it spends tokens whether the output
is good or not. Start with **one** loop on **low-risk, self-checking work**
(e.g. test coverage) to confirm the value, then widen. Don't run six loops on
day one.

## First-time setup checklist

1. Create the **"Loop Queue"** list in the Starcaster ClickUp space.
2. In the ClickUp UI, set its statuses to the six in the table above, in that
   order, with `Live` as a **closed**-type status. Step-by-step clicks:
   `docs/CLICKUP_VIEWS.md`.
3. Build the **My Turn** view (also in `docs/CLICKUP_VIEWS.md`) so there is one
   place to look.
4. Confirm the skills live in `.claude/skills/` — Claude Code discovers skills
   nowhere else, so a skill parked in another folder cannot be invoked by name.
5. Do a **dry run:** spec 1–2 tiny test-coverage tasks, run one `loop-build`
   pass, watch it produce a clean PR, then run one `loop-review` pass. Only
   after that cycle works should you trust it with real feature work.

## Good first applications (ranked by safety)

- 🟢 **Test-coverage backfill** — self-verifying, tiny blast radius. Best first.
- 🟢 **Editor-form standardization** — one module per task; wants many passes.
- 🟢 **Mobile-responsive pass** across modules — same repetitive shape.
- 🟡 **Module manufacturing** — great, but watch the dual-registration landmine.
- 🟡 **Vanilla-JS → React migration** — huge and repetitive, but `public/js/`
  is fragile; needs the heaviest review. A later-phase target.
