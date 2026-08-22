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

## ClickUp access — the single source of truth for ids and commands

Every ClickUp touch by a loop goes through **`npm run clickup -- <command>`**
(`scripts/clickup_direct.mjs`, wrapped in Doppler by package.json so the token
is supplied without any agent or human handling it — DOCTRINE 4.1). The
claude.ai connector's shared rolling budget starves under loop traffic and
fails with junk wait times; ClickUp's own API allows ~100 requests/minute,
which the loops cannot exhaust. Use the connector only when the direct script
itself is broken, and say so in the run report.

The ids, written down exactly once, here:

| Thing | Id |
|---|---|
| Workspace ("Alphire AI Agency") | `90141423066` |
| Starcaster **space** | `90146476303` |
| **Loop Queue list** | `901418546619` |
| The operator's inbox (Dane's **developer** account, dane@alphire.agency) | `48012725` |
| The machine (**Pulse** / mentor24 — the service account; do NOT assign it) | `54254347` |
| The bus (party-line chat) | `2kydhxeu-474` |

**The two-account model (ratified 2026-08-18, after one same-day reversal —
read this before "fixing" either id):** Dane is TWO members of this workspace,
by design:

- **Pulse / mentor24 (`54254347`) is the machine.** It is the Administrator,
  it holds the API token, and every write the loops and scripts make appears
  as Pulse. It is a service account. **Never assign tasks to it** — ClickUp
  does not notify a user about their own actions, so Pulse assigning Pulse is
  a handoff with no ping, and an inbox mixed with automation is not an inbox.
- **Dane / dane@alphire.agency (`48012725`) is the human.** His daily login,
  his developer seat, his My Work. All operator handoffs assign this id, so
  every assignment is Pulse→Dane: a real notification, and an activity trail
  where "Pulse did it" always means the machine and "Dane did it" always
  means him.

**Id trap (cost an hour on 2026-08-18):** a space id where a list id belongs
earns ClickUp's misleading "Team not authorized" 401. When in doubt,
`npm run clickup -- lists --space 90146476303` resolves list ids by name.

The everyday commands (run `npm run clickup` bare for the full list):

```bash
npm run clickup -- queue --list 901418546619 --status Queued   # first line = the task to claim
npm run clickup -- get --task <id>                             # header + body
npm run clickup -- comments --task <id>                        # where the PR URL lives
npm run clickup -- status --task <id> --status Building --if-status Queued   # safe claim
npm run clickup -- status --task <id> --status "Needs your input"            # auto-assigns Dane
npm run clickup -- comment --task <id> --body-file -           # body on stdin
npm run clickup -- chat --channel 2kydhxeu-474 --body-file -   # post to the bus
```

`status` enforces the handoff rule by itself: moving into `Needs your input`
or `Ready to launch` assigns Dane automatically, moving into any machine
status clears assignees, and both halves of the write are verified from the
response. `--if-status` makes a claim safe against a parallel loop: it exits
code 3 without writing if the task has already moved.

**Urgent is the human lane (ratified 2026-08-18).** The queue sorts
priority-then-age, so an Urgent flag is a human override that outranks
everything the loop decided — with no other machinery needed, as long as
agents cannot set it themselves. `task --priority urgent` and
`priority --task <id> --priority urgent` both refuse outright unless
`--operator-asked` is also passed:

```bash
npm run clickup -- task --list 901418546619 --name "..." --priority urgent --body-file -    # REFUSED
npm run clickup -- task --list 901418546619 --name "..." --priority urgent --operator-asked --body-file -   # OK — the operator asked for this
npm run clickup -- priority --task <id> --priority high      # lowering never needs the flag
npm run clickup -- priority --task <id> --priority urgent --operator-asked   # raising to urgent does
```

`--operator-asked` is not a permission check — nothing here can verify who
actually typed the command. It is the agent's own written claim that the
operator asked for Urgent, sitting in shell history and the session
transcript where it can be checked later. Loop-filed tasks (`loop-spec`) are
High or below by default; Urgent only on the operator's explicit word.

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
  `Ready to launch` on its own.** Once a ticket is handed to you it stays
  handed to you until you act. A loop that could quietly reclaim its own
  escalation would defeat the whole checkpoint.

  "Until you act" includes acting by comment (2026-08-19, task 86bbh9g7k):
  when you REPLY on a `Needs your input` ticket, bus-relay posts your answer
  to the bus and moves the ticket back to `Queued`, where a build loop picks
  it up with your answer sitting in the comments. That is not a loop
  reclaiming its escalation — it is you releasing the ticket, with the relay
  as your hands. No fresh comment from you, no move, ever. And a comment on
  a `Ready to launch` ticket moves nothing: that status waits on the merge
  you alone authorize, so the relay only carries your words to the bus.

`Live` is configured as a **closed**-type status in ClickUp, not merely the
last active one. That is what makes finished work disappear from the open
view instead of piling up forever.

### Killing a ticket ("we are not doing this")

There is no `Won't do` status — adding one is currently impossible because
ClickUp's Edit Statuses dialog opens **empty** for this list (observed
2026-08-19, from three different doors, surviving a hard refresh; the API
reads the statuses fine, so it is display-only breakage — but do NOT press
Apply changes on that empty dialog, which could strip the list's statuses).

Until that heals, the convention is: close the ticket as `Live` **plus the
`wont-do` tag**, with a comment saying what was decided and that nothing
shipped. `Live` is what hides it; the tag is what keeps the record honest.
Two of the three ClickUp surfaces for statuses are worth knowing anyway:
the status *pill* at the head of each group in List view grows a `⋯` menu
on mouse-over (`+ New status` there creates inline, skipping the broken
dialog), and statuses live on the **list**, not the space — the space
settings' generic `TO DO / IN PROGRESS / COMPLETE` are not this board.

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
4. **When a ticket asks you a question** (`Needs your input`): answer it as a
   comment on the ticket. Within one bus-relay cycle (hourly) your answer is
   posted to the bus and the ticket goes back to `Queued` for a build loop to
   pick up — the comment alone is enough, no status clicking. This does NOT
   apply to `Ready to launch`: a comment there is relayed but the ticket
   waits for your merge.

### The one place to check: Assigned to me

Work waits on you in two different places: this Loop Queue (Starcaster space),
and the **Agent Response** list the channel steward feeds (Dane of Earth
space). Checking two lists is two chances to miss something.

The fix is **assignment**, not a saved view. When a loop hands you a ticket —
`Needs your input` or `Ready to launch` — it assigns the ticket to you. When
it takes the ticket back, it clears the assignee. So ClickUp's own
**Assigned to me** becomes your whole inbox: it spans every space for free,
needs no setup, and notifies you when something lands.

A hand-built "My Turn" view was tried first and abandoned. A ClickUp view is
scoped to one space, so it could see Loop Queue or Agent Response but never
both — and the workspace-wide level made a status filter unwieldy, since it
offers every status in the workspace at once. Assignment sidesteps all of it.

If you ever see a ticket assigned to you sitting in `Queued`, `Building`, or
`In review`, that is a bug in a loop, not a job for you — tell CC.

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

## Reading the queue at a glance — the Loop note

The Status column says which STAGE a ticket is in; the **Loop note** column
says what is actually happening and what happens next, in plain language:
`🔨 building — claimed 10:12am`, `🔀 PR #351 open — waiting for a review pass`,
`👀 verified — waiting on Dane to say "merge"`, `↩ returned to the line…`,
`✅ live 8/20`. An empty note means "waiting in line" — correct, not a gap.
A pinned **Loop heartbeat** ticket carries one line per pass
(`pass finished 10:48am — 33 in line, next up: "…"`) so you can tell whether
the line is MOVING, not just how long it is.

The loops stamp these themselves (`loop-note` / `loop-heartbeat` in
`scripts/clickup_direct.mjs`, wording in `scripts/builder/loopNote.js`) — one
write per real transition, never per queued ticket (that would be ~33 writes a
pass against a rate-limited API for what the sort order already shows).

**One-time setup (ClickUp UI — the API cannot create either):**
1. On the Loop Queue list: Columns → + → Create field → **Text**, named
   exactly **Loop note**. Add it to the List view. Until it exists the loops
   print `CANNOT STAMP` and carry on — the note is missing, nothing else is.
2. Create one ticket named **Loop heartbeat** in the list; put its id in
   `CLICKUP_HEARTBEAT_TASK` (Doppler) so `loop-heartbeat` has a home.

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
3. Nothing to build for "what needs me" — that is ClickUp's own
   **Assigned to me**, fed by the loops assigning and unassigning you. See
   `docs/CLICKUP_VIEWS.md` for why a saved view was tried and dropped.
4. Confirm the skills live in `.claude/skills/` — Claude Code discovers skills
   nowhere else, so a skill parked in another folder cannot be invoked by name.
5. Confirm Doppler holds the ClickUp token in the config this machine uses:
   `npm run clickup -- whoami` must print "Token valid. Acting as: ...". If it
   does not, the OPERATOR (never an agent) adds it once:
   `pbpaste | tr -d '[:space:]' | doppler secrets set CLICKUP_API_TOKEN --project starcaster --config dev`
   with the token on the clipboard.
6. Do a **dry run:** spec 1–2 tiny test-coverage tasks, run one `loop-build`
   pass, watch it produce a clean PR, then run one `loop-review` pass. Only
   after that cycle works should you trust it with real feature work.

## Good first applications (ranked by safety)

- 🟢 **Test-coverage backfill** — self-verifying, tiny blast radius. Best first.
- 🟢 **Editor-form standardization** — one module per task; wants many passes.
- 🟢 **Mobile-responsive pass** across modules — same repetitive shape.
- 🟡 **Module manufacturing** — great, but watch the dual-registration landmine.
- 🟡 **Vanilla-JS → React migration** — huge and repetitive, but `public/js/`
  is fragile; needs the heaviest review. A later-phase target.
