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
npm run clickup -- ask --task <id> --status "Needs your input" --body-file - # hand it to Dane: card + status
npm run clickup -- pr-opened --task <id> --pr <pr-url>          # record the PR (loop-build step 7 — required)
npm run clickup -- verdict --task <id> --pass|--fail --if-status "In review" --body-file -  # the review verdict (loop-review step 4)
npm run clickup -- loop-note --task <id> --transition review-started        # loop-review's visible claim, before it verifies
npm run clickup -- comment --task <id> --body-file -           # a plain note (progress, context)
npm run clickup -- describe --task <id> --body-file -          # REPLACE the description (the left column)
npm run clickup -- chat --channel 2kydhxeu-474 --body-file -   # post to the bus
npm run clickup -- attach --task <id> --file a.png --file b.png             # before/after pictures
```

`status` enforces the handoff rule by itself: moving into any machine status
clears assignees, and both halves of the write are verified from the response.
`--if-status` makes a claim safe against a parallel loop: it exits code 3
without writing if the task has already moved. It **refuses** to move a ticket
into `Needs your input` or `Ready to launch` — see the next section.

### The two traces a ticket must carry (added 2026-08-22, task 86bbjt18r)

`pr-opened` and `verdict` are not politer spellings of `comment`. Each writes
one exact shape, and each **reads it back through the same parser its consumer
uses** — so a comment that the merge step could not act on is a comment these
commands refuse to call written. Both exit non-zero when the trace does not
land, and a non-zero exit fails the loop run.

They exist because both traces used to be prose in a skill file, and prose is
followed most of the time. Draining the Ready-to-launch backlog on 2026-08-22
found what the other times cost:

- **Four approved tickets had no `PR opened:` comment**, so the merge step
  correctly refused to guess which PR they meant — and two of those PRs also
  shipped with no ClickUp link in the body, so ticket and PR could only be
  paired by reading titles. `pr-opened` now checks the PR body FIRST (exit 4
  if the link is missing) and only then writes the ticket side.
- **Two tickets reached `Ready to launch` with no passing review on them.**
  That status is the operator's "safe to merge" signal; he approved both in
  good faith. `ask` and `status` now both refuse to set it unless the newest
  verdict on the ticket is a PASS. `--operator-asked` overrides, and says in
  the transcript that a human took responsibility for it.

**What the gate does NOT cover, stated out loud.** `status` and `ask` in
`scripts/clickup_direct.mjs` are the only two writers of that status anywhere
in this repo — `scripts/reconcile_clickup_github.cjs` treats operator statuses
as read-only and never sets them — so every loop path is now closed. Two doors
remain open that code here cannot reach: the ClickUp **web UI** (a person
dragging a card), and the claude.ai **ClickUp connector** (`clickup_update_task`),
which any agent session can call directly without passing through this script.
If an unreviewed ticket turns up in `Ready to launch` again, look there first
— and the loops should keep using `npm run clickup`, which is the only door
with a lock on it.

### Two passes, one ticket: claim it visibly, guard every verdict (added 2026-08-23, task 86bbjk5rw)

Claiming is check-then-act — read the status, compare it, write — and there is
no way to make that one indivisible step. `--if-status` is what makes it safe
anyway: the write is refused, with nothing sent, if the ticket is no longer
where you found it. `loop-build` has claimed that way since it shipped.
`loop-review` did not, and on 2026-08-22 at 03:41 the hole opened:

- **Two review passes verified PR #362 end to end at the same time.** Neither
  could see the other, because a review in flight left no trace anywhere — the
  ticket sits in `In review` while it is being reviewed and also while it is
  waiting to be, and those look identical.
- **The slower one then wrote `Ready to launch` over the faster one's FAIL
  verdict — and over a fresh `Building` claim** — from a queue snapshot about
  25 minutes stale. Repaired by hand on 86bbggw48. Had nobody looked, a change
  its own reviewer had failed would have gone to the operator wearing "safe to
  merge".

The two rules that came out of it, and where each one lives:

1. **A review claims its ticket before it verifies anything**, by stamping the
   Loop note: `loop-note --transition review-started` writes
   `🔍 being checked — a review pass started 8/23 3:41am`. Both `queue` and
   `get` print the Loop note now, so the next pass sees the claim in the one
   command it already runs — no extra call, nothing to remember. The note
   carries the **date** as well as the clock, because the next pass has to be
   able to tell a claim that is running from one that died hours ago; past
   about 45 minutes it is abandoned and may be taken over, out loud.
   No new status was added for this: the six are the six, and `In review` still
   means what it meant.
2. **Every verdict write says which status it was claimed under.**
   `verdict --if-status "In review"` is **required** — the command refuses
   without it (exit 2) and refuses again, writing nothing, if the ticket has
   moved (exit 3, the same code `status --if-status` uses). The skill's
   instruction on a refusal is one line: re-read the ticket and its comments,
   then stand down — no verdict, no status move, take the next task.
   `--no-guard` opts out and says so in the transcript.

   The send-back path carries the same guard (`status --status Queued
   --if-status "In review"`). The pass path needs no second guard, because
   `ask --status "Ready to launch"` already refuses unless the newest verdict
   is a PASS — so a verdict the guard refused blocks the status move behind it.

Guarded live against scratch ticket 86bbgm68r before shipping: refused on a
stale status (exit 3), refused with the flag missing (exit 2), allowed with a
matching one — and the ticket's comment count moved only on the last of the
three. `scripts/builder/reviewRaceGuard.test.js` keeps both rules in place;
it fails on every one of its seven assertions against the pre-fix script.

### A refusal is not a verdict on the ticket

The merge step marks an authorization it has acted on, so the same answer is
never posted twice. Until task 86bbjt18r that marker was permanent even for a
**refusal**, which meant a refused ticket was never looked at again. On
2026-08-22 two tickets were refused for "no PR opened: comment", the comment
was added by hand minutes later, and the next three passes did not re-read
them: they simply dropped out of the run. Dane's approval was still there,
still valid, and only a human audit would ever have found it.

Refusal markers now record their reason and are **re-decided on every pass**.
Nothing extra is posted while the reason still holds — the same answer twice
says nothing new — but the moment it changes, or goes away, the ticket goes
through with no second word from him. A completed **merge** stays terminal,
because re-deciding a merged PR is the one mistake that cannot be undone.

### A conflict hand-off is not one either (2026-08-23, task 86bbk0g4u)

A conflict hand-off used to be terminal alongside the merge, and the comment
posted beside it said the opposite in so many words: *"then your merge still
stands and this goes through."* It did not. Nothing looked at that
authorization again, ever.

On 2026-08-23 eleven `Ready to launch` tickets were sitting on a spent
approval from a conflict that was not even real — GitHub cannot run our
asset-pin merge driver, so clean branches read as conflicting (fixed
separately by `branchCatchUp.js` in #415). Dane had approved every one of
them, been told his approval still stood, and been given nothing. On one
ticket he said "merge" twice, four hours apart, and hit the same dead end
both times.

Two things changed:

- **A conflict hand-off is re-decidable.** Resolving the branch is a job for
  a person; saying "merge" a second time afterwards is not. Once someone
  merges `main` into the branch and CI goes green, the next relay pass merges
  it on his original word. A genuinely still-conflicted ticket stays silent
  in the meantime — the pass re-derives the same answer and posts nothing —
  and shows up in the run summary as *unchanged since last pass* rather than
  vanishing from the count.
- **The comment and the marker are now built together**, by one function per
  outcome in `scripts/builder/mergeOnComment.js` that returns both. A test
  walks every notice the merge path can post and fails if a body promises the
  approval carries over while its marker says otherwise. They drifted because
  they were written in two different files; now they cannot.

**The eleven fixed themselves.** There is no `unstick` command to remember to
run: `parseMergeMarker` reads the pre-2026-08-23 hand-off marker
(`conflict hand-off on PR #N`, no `refused:` prefix) back as re-decidable, so
every stuck ticket healed on the first pass after this shipped. A merged
marker does not match that shape, and `githubGate` refuses an already-merged
PR regardless, so the migration cannot reach anything irreversible. A ticket
whose PR was merged by hand during the stall gets one truthful comment saying
so instead.

## The two columns, and the operator card (ratified 2026-08-22)

ClickUp puts the task description on the **left**, wide, and the comment stream
on the **right**, narrow. Until 2026-08-22 the loops had that backwards: the
description held a spec written for a machine, and every piece of human-facing
reasoning went into a comment — so it reached Dane as a wall of text in the
skinniest part of the screen.

Two tickets stalled on it the same day. **Sync 6/7** (`86bbev0g3`) carried a
long comment offering three ways to slice the work; Dane answered "build the
chip display", the relay handed the ticket back to `Queued` still wearing its
original wide scope, and the next unattended build pass would have built the
half he had just deferred — the one that rewrites ~35 live tenant pages.
**Sync 7/7** (`86bbev0gx`) sat in his inbox for a day under a red *Needs your
input* badge with no answerable question anywhere on it; it was not blocked on
him at all, it was blocked on 6/7.

So:

**Detail goes left.** `describe --task <id> --body-file -` replaces the whole
description, refuses an empty body, and reads the result back (a description
write that normalizes to nothing returns a clean 200 — DOCTRINE 3.10). The
description shape lives in `loop-spec`'s SKILL.md and now opens with
**## Dane asked for** — his own words, verbatim, that caused the ticket to
exist. If it descends from a standing decision instead, say so and name it.
Never invent a quote.

**The right column carries the operator card, and nothing else.** One command
posts it and moves the status together, so the two can never come apart:

```bash
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -
npm run clickup -- ask --task <id> --status "Ready to launch" --body-file -
```

The body is four sections. The check runs **before** the first network call, so
a card that fails the shape leaves the ticket exactly where it was:

```
@@ASKED
build the chip display
@@WHEN
2026-08-22 10:56am, on this ticket          (optional)
@@CONTEXT
The problem and the fix in plain English. 50-100 words — enforced, not
suggested. Under 50 it stops carrying enough for him to act on without opening
anything else; over 100 it becomes the wall of text this replaces.
@@NEEDED
The specific ask. "Nothing right now" is a good answer and a useful one, but it
has to be written down rather than left blank.
```

`@@NEEDED` renders under a banner he can find without reading:

```
#############################
NEEDED FROM DANE: 
#############################
```

The shape is a real module (`scripts/builder/operatorCard.js`) with real tests
(`scripts/builder/operatorCard.test.js`), not a convention an agent has to
remember. `status --status "Needs your input"` refuses on its own and prints
the `ask` form; `--no-card` is the escape hatch, and like `--operator-asked`
above it is a written claim in the transcript, not a permission check.

### ClickUp deletes `> ` blockquotes — from comments AND descriptions

Found live while building the above, on 2026-08-22. A body posted with
`> quoted words` comes back with those lines **gone** — not unformatted, not
escaped, absent — and the write returns a clean 200 with a healthy-looking
character count. The first two operator cards ever posted lost Dane's own
words that way, which is the one part of a card nobody can reconstruct later.

A probe of six forms against the live API (scratch task `86bbgm68r`) settled
which are safe:

| Form | Survives? |
|---|---|
| `> blockquote` | **no — deleted entirely** |
| ` ``` ` fenced block | yes |
| `***bold italic***` | yes |
| four-space indent | yes |
| `"plain quotation marks"` | yes |
| `**— bold with a dash**` | yes |

So verbatim text goes in a fence, which is also the only form that leaves its
contents uninterpreted. `describe` refuses a body containing a blockquote
before it sends; `ask` refuses one in any card section, and after posting reads
the card back and confirms Dane's words are actually in it. A `>` inside a
fence is fine and is not flagged.

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

## The Approvals surface

Visual/content before-after sign-offs arrive **on the Loop Queue ticket
itself**, as images attached by `npm run check:shots` — see
**`docs/APPROVALS.md`** for what Dane's answer means and how agents file.

A separate Approvals list was specified on 2026-08-18 and declined on 08-23:
this list's id is hard-coded in 18 places across 11 files, so moving approvals
off it is its own epic, and it buys a tab. A saved view does the same job with
nothing moved.

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
  as your hands. No fresh comment from you, no move, ever.

  Since 2026-08-21 (task 86bbjd5nn) the same is true at the other end. On a
  `Ready to launch` ticket, a comment from you that is **exactly** a merge
  command — `merge`, `merge it`, `ship it` or `approve`, the whole comment,
  nothing else — merges the PR and closes the ticket as `Live`. Anything
  longer is just a comment: "merge after the other one lands" changes
  nothing. This is still your merge, not the loop's; the only thing that
  changed is that you no longer have to wait for a session to notice. Before
  it merges, the relay re-checks every gate itself:

  - the ticket is in `Ready to launch` **now**;
  - the comment is yours, checked by ClickUp user id, never by display name
    (an agent comment saying "merge" does nothing, and there is a test that
    fails if that ever stops being true);
  - the newest review verdict on the ticket is a PASS, and your comment came
    **after** it — so a "merge" from an earlier round cannot release a PR
    that was rebuilt since;
  - the PR named in the ticket's own `PR opened:` comment is open, not a
    draft, and its checks are green (a PR with no checks at all is refused —
    unverified is not green);
  - the branch does not conflict with `main`.

  If the branch is merely behind `main`, the relay catches it up and waits
  for CI to re-run rather than merging on a stale green. If it **conflicts**,
  the relay stops, says so on the ticket in plain language and on the bus,
  and leaves the ticket where it is: a script never resolves a conflict — but
  it no longer spends your approval on the way past, so once a session fixes
  the branch it merges on its own (see *A conflict hand-off is not one
  either*, above). Any other refusal is written on the ticket with the
  reason. Nothing is ever half-moved, and no refusal is posted twice.

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

Two commands, each in **its own session**:

```
# In session A:
/loop 30m loop-build

# In session B:
/loop 30m loop-review
```

**Start them wherever you like — the main checkout is the natural place.**
Neither loop edits the folder it is started in: `loop-build` creates a
per-task worktree and works there, `loop-review` checks a PR out into one.
The main checkout stays on `main` and stays clean, so the collision that
"one worktree per thread" guards against — two sessions sharing one HEAD and
one set of uncommitted edits — is not reachable here.

This paragraph used to say each loop needed **its own worktree**, and called
that the #1 safety rule. It contradicted `loop-build`'s own step 2, which
derived its checkout with `git rev-parse --show-toplevel` — *"the folder I am
in"*. Follow the old advice and the loop nested its per-task worktrees inside
the worktree it was started in. Nothing errored; the work simply happened
somewhere nobody expected. Step 2 now asks `scripts/lib/main_checkout.mjs`
instead, which answers the same from anywhere, so where you start no longer
matters — but two documents giving different instructions is the part that
had to stop (2026-08-22, after NODES Slice A #368).

The "one worktree per thread" rule in `CLAUDE.md` is untouched and still
applies to **building**: every piece of work gets its own folder and branch.
That is what the loops do for each task. It was never about where a loop
session is launched from.

`/loop 30m X` means "run X, then run it again every 30 minutes." Build drains
the `Queued` pile into PRs; review drains the `In review` pile into
`Ready to launch` PRs that ping you.

Your day:
1. **Morning:** run `loop-spec`, answer its questions, approve the task list.
2. **During the day:** the loops build and review. You get a message per
   `Ready to launch` PR with a preview link and test steps.
3. **When you're ready:** reply **`merge`** on the ticket — just that word.
   Within one bus-relay cycle (every 10 minutes) it is merged and the ticket
   closes as `Live`, provided the PR is still open, green and conflict-free. Telling a
   CC session "merge PR #NN" still works and is faster if one is open; the
   comment is the version that works when nobody is watching. Either way the
   decision is yours — see Safety.
4. **When a ticket asks you a question** (`Needs your input`): answer it as a
   comment on the ticket. Within one bus-relay cycle (every 10 minutes) your
   answer is posted to the bus and the ticket goes back to `Queued` for a build
   loop to pick up — the comment alone is enough, no status clicking.

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

## Visual changes come to you as pictures

A ticket that changes what a page *renders* arrives with before/after
screenshots attached, so the question you are asked is "does this look right"
rather than "check out this branch and run it". The build loop runs
`npm run check:shots --task <ticket>`, which builds the code as it is on `main`,
builds the branch, photographs six pages through both, and attaches every pair
that differs.

If the two pictures are identical, nothing is attached and nothing interrupts
you. Full details, including why the comparison has no tolerance and what a
green run does *not* prove: **`docs/VISUAL_REVIEW.md`**.

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
  Since 2026-08-21 that authorization can be a one-word comment on the ticket
  and the relay carries it out within 10 minutes (task 86bbjd5nn) — which
  moves the *hands*, not the *decision*. The relay merges nothing you did not name, on a
  ticket no independent review passed, or on a branch that is red or in
  conflict. It exists because on 2026-08-20 three tickets you had already
  approved sat unmerged for hours waiting for a human to notice: the
  checkpoint was doing its job, the delay after it was pure friction.
- **Every TASK is built in its own worktree**, created automatically — that is
  what keeps two builds off each other's files, the single most common way this
  repo breaks. It is the per-task folder that matters, not where the loop
  session itself was started: the loops never edit the folder they run in, so
  they can be started anywhere (see "How to run it"). This bullet used to say
  "every loop runs in its own worktree", which is where the contradiction
  described in that section came from.
- **Every build passes the full gate set before a PR opens** — `typecheck`,
  the builder tests, the conventions check, the syntax check, and the rebuild
  command for any generated file. A task that can't pass gets marked
  `Needs your input` for a human instead of shipping broken.
- **Review is independent.** It re-runs everything and actually opens the page
  in a browser; it never rubber-stamps the build loop.
- **And since 2026-08-25 one of these is a check, not a convention.** Every
  bullet above binds only an actor that has read this file; PR #432 was merged
  unreviewed by a session that had not. The `review-gate` status check refuses a
  merge whose ticket carries no review PASS newer than the code — see "The
  review gate" below, including the two settings that switch it from a warning
  into a block.

## The review gate — the rule the repository enforces (2026-08-25, task 86bbmfbkv)

Everything in "Safety" above is a **convention**, and a convention only reaches
the actors that know they are bound by it.

On 2026-08-25 at 12:38 PR #432 was merged to production with no review verdict
on its ticket and no merge word from Dane. Ticket 86bbjt1aq went `Live` without
ever reaching `Ready to launch`. None of the unattended machinery did it: it was
**a second Claude Code session on the MacBook** running `gh pr merge 432
--squash` — an ordinary session, with ordinary `gh` access, that had no way to
know a review lane was waiting for that PR.

A fresh session, a forgotten terminal window, an operator in a hurry: none of
them have read this file. So the rule stops being something every actor must
remember and becomes a **status check**.

### What it checks

`.github/workflows/review-gate.yml` runs `scripts/review_gate.mjs` on every
pull request. It reads the ticket id out of the PR body, reads that ticket's
comments, and finds the newest `REVIEW:` verdict. It **passes only if that
verdict is a PASS and it is newer than the PR's newest commit** — a PASS on
older code is not a review of what is about to merge.

The verdict parser is **imported** from `scripts/builder/mergeOnComment.js`,
never re-implemented, and a test asserts the gate, the merge step and
`loopTrail.readyToLaunchGate` all agree across a fixture set. A gate that
disagreed with the merge step about what a PASS is would be worse than no gate.

| Situation | Verdict |
|---|---|
| Newest verdict is a PASS, newer than the newest commit | **pass** |
| No `REVIEW:` verdict on the ticket at all | **fail**, naming the ticket |
| Newest verdict is a send-back | **fail** |
| PASS older than the newest commit (sent back, fixed, pushed) | **fail** |
| No ClickUp link in the PR body | **fail** |
| `[gate-waived: <reason>]` in the PR body | **pass**, and announced on the bus |
| ClickUp unreachable, or the CI token missing | **CANNOT TELL** — never a pass |

Every failure names the ticket, says what the newest verdict actually is, and
states the one thing that has to happen next. A red X that teaches nothing
teaches people to route around it.

**Lane A is not exempt.** Auto-merging a docs- or test-only change removes the
*operator's word*, never the review (vault `doctrine/AUTO-MERGE-LANES.md`).

**Freshness measures the branch's own commits, not its catch-up merges.**
Branch protection is `strict: true` and this repo catches up by merging
`origin/main` in rather than rebasing (DOCTRINE §6.6), so every catch-up adds a
commit newer than any review. Counting those would deadlock the pipeline —
catch up, go stale, re-review, catch up again. Merge commits are excluded by
**parent count**, which is what a merge *is*, rather than by matching a merge
message, which is only what a script currently writes. Checked against the live
record before shipping: PRs #400 and #406 both failed the naive rule and pass
the real one, while #432 (the incident) and #419 still fail correctly.

### The waiver

A waiver line passes the gate, including past the no-ticket rule — a hotfix
opened by hand at 2am is what it is for. A reason is **required**; an empty one
is not a waiver, and neither is a placeholder pasted out of this document.

**It must sit ALONE on its own line**, and that anchor is load-bearing. The
first version matched anywhere in the body, and the first CI run caught it on
the gate's own pull request: that PR necessarily *documents* the syntax, so the
gate read its own documentation as a live waiver and let itself through. Any PR
quoting the syntax — a doc change, a rules table, a discussion — would have
bypassed the gate while looking entirely ordinary. Mentioning a waiver inside a
sentence or a table cell is now only mentioning it, exactly as `mergeOnComment`
anchors its verdict regexes so that prose about a rule is not the rule.

**And a waiver shown as CODE is an example, not an instruction.** The anchor
alone still let a realistic waiver through if it sat on its own line inside a
code fence — which is exactly how this repo writes down its own rules, so the
next docs page with a plausible reason in it would have reopened the same hole
one step out (found in review, 2026-08-25). Both ways Markdown says "this is
an example" are skipped: a fenced block (triple backtick or triple tilde) and a
four-space-indented block. Both skips fail **closed**: an unclosed
fence hides the rest of the body, so a real waiver after it is ignored and the
gate goes on to check the ticket. Losing a waiver costs one edit; granting one
costs a merge. That is why the table above and every example in this document
can quote the syntax safely.

Using one **posts to the party line** with the reason, the PR and who did it.
An override nobody can see is not an override, it is a hole, so the price of
reaching for it is visibility. If the bus post fails the gate still passes but
says so loudly — tell the party line by hand.

### It is ADVISORY until Dane ticks the box

Making a check *required* is a branch-protection change in GitHub's settings, a
browser action on his account that an agent may not perform. Until then the job
annotates loudly, writes its verdict to the run summary, and **exits 0**.

Exiting 0 rather than going red is deliberate and load-bearing:
`mergeOnComment.githubGate` refuses to merge **any** PR carrying a red check. An
"advisory" gate that went red would therefore not be advisory at all — it would
silently block every merge the relay makes, through a rule nobody had agreed to
enforce yet.

**To switch it on, both halves, in one visit:**

1. **Settings → Branches → `main` → Require status checks to pass → add
   `review-gate`.**
2. **Settings → Secrets and variables → Actions → Variables → New variable:
   `REVIEW_GATE_ENFORCING` = `true`.**

The variable exists so the two halves cannot drift. With the box ticked but the
token missing or revoked, the gate answers CANNOT TELL and stays shut, instead
of quietly reverting to advisory and waving everything through. Inferring the
mode from "is the token present?" would have exactly that hole.

### Before ticking the box: two things must be true

1. **The CI ClickUp token must exist.** The workflow reads
   `secrets.CLICKUP_API_TOKEN` — the same name the rest of the repo uses
   (`scripts/clickup_direct.mjs`), not a new one invented for CI. **As of
   2026-08-25 this repository has no Actions secrets at all**, so the gate
   currently answers CANNOT TELL on every PR and, being advisory, exits 0.
   Adding it is Settings → Secrets and variables → Actions → New repository
   secret.
2. **Something must re-run the gate after a review lands.** A status check is
   computed once per commit. loop-review posts its PASS *after* the last push,
   so the check that already ran saw no verdict and will not re-run on its own.
   Today the answer is by hand — `gh run rerun <run-id>` — which is fine while
   the gate is advisory and **not** fine once it is required. Teaching the merge
   step to re-run a stale gate before merging is the follow-up that has to land
   first.

## How often the relay wakes, and why that number (2026-08-23, task 86bbk2fuh)

The relay runs **every 10 minutes** (`StartInterval` 600). It was hourly until
2026-08-23. The interval lives in `scripts/install_bus_relay.sh`
(`INTERVAL_SECONDS`), which generates the launchd plist — so it is changed by
editing the repo and re-running the installer, never by hand-editing the plist
on the machine.

**Why it moved.** Hourly was a fair default while the relay only *notified*.
On 2026-08-21 it started **merging** (task 86bbjd5nn), which made it the
consumer for the whole pipeline, and the default was never revisited. Nothing
about the work justified an hour: a pass costs **no tokens at all** — it is a
plain Node script, not a Claude session — and finishes the entire job in about
**14 seconds**. So an approved PR could sit up to an hour waiting on the
*interval*, not on any work. That was the ceiling, and it is the one thing this
change removed.

**What it costs, measured.** ClickUp allows roughly **100 requests per minute**.
A steady pass, measured on 2026-08-23 against a queue of 15 open tickets
carrying 22 already-relayed operator comments, used **39 requests** — leaving
**61 requests of headroom**, about 61%. The relay prints this itself now, on
every pass:

```
requests this pass: 39 (ClickUp allows ~100/minute)
```

Two things about that number are worth keeping straight:

- **The interval does not multiply it.** ClickUp's budget resets every minute,
  and a 14-second pass every 10 minutes never shares a minute with the next
  one. Peak usage is one pass, whatever the interval. Going 3600 → 600 raised
  requests *per hour* from 39 to 234, and ClickUp does not meter per hour.
- **Queue size does multiply it.** The count is roughly `2 list reads + 1 per
  open ticket + 1 per operator comment on those tickets`, so it grows with how
  much work is open, not with how often the relay runs. Reaching 100 would take
  roughly 2.5× the current open queue. This is also the real shape of the 429
  on 2026-08-23 that reported six tasks as "could not read comments": that was
  a 24-comment backlog drain, a *volume* problem wearing a rate-limit hat, and
  shortening the interval does not make it likelier. **If "requests this pass"
  starts creeping toward 100, the fix is a cheaper pass — not a longer
  interval.**

**Overlap: what actually prevents a double-post.** At 10 minutes a slow pass
overlapping the next is far likelier than at 60, so this was verified rather
than assumed. It matters because the relay's own dedup guard would *not*
survive an overlap: "has this comment been relayed?" is a read, a comparison,
then a write against a remote API, and two passes can both read "no" before
either writes its marker. The code says so itself, about two machines.

**launchd is the guard, and it holds.** A launchd job is one instance per
`Label`: it will not start a second copy while the first is still running.
Probed directly on the Mini — a scratch job with `StartInterval` 10 running a
25-second script, which would overlap 2–3 deep if overlap were possible:

```
START pid=2550 23:32:15    END pid=2550 23:32:41
START pid=3013 23:32:51    END pid=3013 23:33:16
START pid=3165 23:33:26    END pid=3165 23:33:51
START pid=3832 23:34:01
```

Never two STARTs before an END — which is the load-bearing finding, and it was
confirmed a second time by an independent 16-run probe in review.

Note what the timings do *not* prove. Each run begins 10 seconds after the
previous one **ended**, and it is tempting to read that as launchd restarting
the countdown from exit. Apple documents `StartInterval` as a plain periodic
timer whose firings are **coalesced** when the job is still running — several
missed firings collapse into a single start. With a 25-second job on a
10-second interval those two mechanisms produce identical logs, so this data
cannot tell them apart, and coalescing is the documented one. The practical
consequence is the same either way and is what actually matters: **a pass
that runs long never stacks — it swallows the firings it overran.** The cost
of a long pass is therefore a delay, not a double-post: approvals arriving
while it runs wait on work already in flight. That is why the merge pass's
worst case is pinned below one interval in
`scripts/builder/mergeOnComment.test.js`.

The consequence worth remembering: **overlap safety comes entirely from
launchd, not from the relay's code.** Anything that runs the relay outside that
schedule — a second machine, a hand-run pass alongside the timer, a future
wrapper that backgrounds it — loses the guarantee. `lib/nodeRoles.js` covers
the second-machine case; the others are on whoever types the command.

**The interval is still only on one machine.** The generated plist lives at
`~/Library/LaunchAgents/com.starcaster.bus-relay.plist` on the Mini and is not
in the repo, so it is invisible to everyone and lost if the machine is rebuilt.
That belongs to the **NODES** slices, not to this ticket — recording the number
here is the stopgap. The closest live one is **Slice D, "provision a node by
script, not by document"** (`86bbhbaay`); treat this relay interval as a worked
example of why a machine-only config is a config nobody can review. (Task
86bbk2fuh cited "NODES Slice B (86bbh9kh2)" for this, but that id is
"Make Pulse path-portable" and no Slice B ticket could be found — A, C, D and E
exist. Verify before citing it again.)

**The drift check, and why it has three answers.** Changing
`INTERVAL_SECONDS` in the repo does not change the machine — that needs the
installer re-run, by hand, by a person. So `scripts/bus_relay_interval.sh`
compares the two on every relay pass and in `install_bus_relay.sh --status`,
and it answers one of **three** ways, never two:

| | |
|---|---|
| `interval: every 600s, matching the repo` | both values read, and equal |
| `interval: MISMATCH — this machine wakes every 3600s, the repo says 600s.` | both read, different — prints the installer command, pointed at the **main** checkout (the installer refuses to run from a worktree) |
| `interval: CANNOT TELL — …` | no plist, no readable `StartInterval`, or no readable `INTERVAL_SECONDS` — it names which |

The third one is the point. This check is the compensating control for the one
thing the change could not do for itself: the installer re-run is a human step,
and this is what keeps it from being forgotten silently forever. Its first
version had only two answers, so an unparseable `StartInterval` printed
`every ?s, matching the repo` — claiming a match while the `?` admitted it had
no value — and a missing plist printed nothing at all, which reads as no news.
Both were false all-clears in the one check whose whole job is to make silent
drift loud (`docs/DOCTRINE.md` 3.11: *checked*, *empty* and *could not check*
are three outcomes, and the third is never folded into the second). Caught in
review, 2026-08-24. `scripts/builder/busRelayInterval.test.js` pins all three,
and each was verified by reintroducing the defect and watching the test fail.

Review round 2 then found a **fourth** answer hiding in the same check, and the
worst kind: confidently wrong. A plist is XML, not a line-oriented file, so
launchd is content with the whole `<dict>` on one line — and the value was read
with `grep -A1` plus a greedy `sed`, which takes the **last** `<integer>` on the
line rather than the one belonging to `StartInterval`. A single-line plist
saying 600, with any later integer-valued key (`Nice`, `ThrottleInterval`),
reported that other key's number as the schedule. The match is now anchored to
the value that follows `<key>StartInterval</key>`, and the test file pins it.

**The interval is written down in more places than the two that run it.**
Round 1 of review fixed the check; round 2 caught what the check cannot see.
`INTERVAL_SECONDS` and the plist are the two copies that *take effect*, and the
drift check compares those. But the number is also stated in prose, and prose
that says "hourly" after the machine stopped being hourly is wrong in exactly
the way nobody notices — it never fails, it just misinforms.

**Do not trust a list here to be complete — run the search.** The list below
was published in review round 2 under the heading "every place that had to
change", and round 3 found it short by eight: the same stale word sitting in
code comments and in one line of operator-visible stderr. A hand-maintained
inventory of a scattered fact is itself a scattered fact. The check is one
command and it is the only thing that actually answers the question:

```
git grep -niE "hourly|every hour"
```

Search for the **outgoing** wording, not the incoming one — the stale copies are
the ones still saying the old thing. And search for the number spelled out as
well as in digits: two of the six records above say "every **ten** minutes", so
a future change away from 10 minutes wants
`git grep -niE "ten minutes|10 minutes"` and would miss half the list without
the words.

Three families come back, and only the first needs touching:

1. **States the current cadence** — the rows below. These go stale on a change.
2. **Describes the past on purpose** — `scripts/bus_relay_interval.sh`,
   `scripts/install_bus_relay.sh` (the `INTERVAL_SECONDS` history note), the
   "it was hourly until 2026-08-23" sentences in this file, and every dated
   entry in `docs/WORK-LOG.md`. Correct as they stand; changing them would
   falsify the record. The work log in particular is a record of what was true
   on a date and must never be back-edited to match today.
3. **A different feature entirely** — `lib/builderPageRevisionsStore.js` and
   its tests use "hourly" about page-revision bucketing. Unrelated; never touch.

The places that state the cadence, and why each one matters:

| Where | Why it matters |
|---|---|
| `scripts/install_bus_relay.sh` → `INTERVAL_SECONDS` | the source of truth; generates the plist |
| `~/Library/LaunchAgents/com.starcaster.bus-relay.plist` | what actually runs; only changes when the installer is re-run |
| `docs/ecosystem/inventory.yaml` → `job-bus-relay` | **published** — `build_ecosystem_html.mjs` and `ecosystemNotes.js` render it, so a stale value ships to the page people read |
| `docs/APPROVALS.md` | the operator-facing description of the one-word merge flow; a faster merge is the whole visible point of the change |
| `.claude/skills/loop-review/SKILL.md` | tells the review loop what happens after `Ready to launch` |
| `scripts/install_bus_relay.sh` install-time stderr | a person reads this one, on the machine, when doppler is missing |
| code comments in `scripts/clickup_direct.mjs` and `scripts/builder/mergeOnComment.js` (+ its test) | they explain *why* a guard exists; a wrong cadence there misleads the next person to change the guard |
| this file | the reasoning, the measurement, and the table you are reading |

**Most of those comments no longer name a cadence at all.** Where the sentence
only meant "on every pass" — dedup markers, quieted repeat comments, "ask again
next time" — it now says exactly that, and is immune to the next change. Only
the places where the *number itself* is load-bearing still carry one, and the
one that matters most (the merge pass's worst-case bound) no longer states it
in prose either: `scripts/builder/mergeOnComment.test.js` reads
`INTERVAL_SECONDS` and asserts a pass cannot outlast one interval, so shortening
the cadence again fails a test instead of quietly permitting an overrun.

**Nothing checks the prose, and one thing nearly could.**
`scripts/check_ecosystem_drift.cjs` probes the bus-relay job with its
`launchctl` probe, which asks only whether `detail.label` is loaded on the host
machine — it never reads `StartInterval`, so `schedule:` in the inventory can be
wrong forever without a single check complaining. That checker is the one place
positioned to catch this class, since it already talks to the real machine and
already holds the inventory's claim beside it. Teaching it to compare
`detail.schedule` against the live plist is a **follow-up, deliberately not done
here** — it needs a schedule vocabulary (`hourly`, `every 10 minutes`, a cron
expression) before it can compare anything, which is a design question and not a
one-line fix. Until then, the table above is the manual answer: this number
changes in six places or it is wrong in some of them.

**Known and not fixed here:** the launchd log now grows 6× faster with no
rotation. It is small (a few KB per pass) but unbounded, and belongs to a
housekeeping ticket rather than this one.

## A build node must be able to make GitHub run its checks

Every gate downstream of the build loop reads GitHub's checks. `ship` waits for
them, the review loop re-runs them, and the merge-on-comment relay refuses a PR
that has none ("nothing verified this branch"). So a build node that cannot get
a check run created produces PRs that can never be merged — and nothing says so,
because a checkless PR looks calm rather than broken.

**Setting up a new node, check this before trusting it.** The credential the
node pushes and opens PRs with has to be one whose events trigger workflows: a
`gh auth login` user token (`gho_…`, scopes must include `repo` and `workflow`)
or a classic PAT. A `GITHUB_TOKEN` from an Actions run, or a GitHub App
installation token, deliberately does **not** trigger workflows — a node wired to
one of those opens checkless PRs forever. Confirm with:

```
gh auth status                      # Token: gho_… , scopes include repo + workflow
gh pr list --limit 5 --json number,createdAt   # then, for a PR this node opened:
gh run list --branch <branch> --json createdAt,event
```

A healthy node's first run appears **3–4 seconds** after `gh pr create`.

### The failure that is NOT the credential (2026-08-23, PRs #387 and #389)

Ticket 86bbjv61n was filed as "PRs pushed from the second build node never
trigger CI". They do: nine PRs were opened from the Mac Mini on 22–23 August and
seven started `verify` within four seconds. The two that did not share something
else — **a second push landing about fifteen seconds after `gh pr create`**
(a work-log commit on #387, a force-push on #389). In both, the `opened` run and
that second push's run are both missing from `gh run list`, and the branch then
sat checkless for half an hour until an unrelated push finally produced one.

Two things follow, and both used to be got wrong:

- **A missing run does not arrive later on its own.** A run exists only because
  an event created one. "Wait a bit longer" and "run `npm run ship` again" are
  both useless — ship pushes nothing on a re-run, so there is no new event.
  Only a **new head SHA** fires `synchronize` and makes GitHub create the run.
- **So `ship` now pushes an empty commit** once its grace window is spent, and
  gives the checks one more window (`scripts/builder/waitForChecks.js`, the
  `nudge` hook). It does that at most once, and if a run still does not appear
  it says plainly that this is no longer a delay.

**Recovering a checkless PR by hand** — any new commit will do:

```
git commit --allow-empty -m "Nudge GitHub into creating a check run" && git push
```

**Avoiding it in the first place:** do not push again in the seconds right after
`gh pr create`. Open the PR, wait until `gh pr checks <pr>` lists a run, and
only then push the work-log commit — the ordering
`.claude/skills/loop-build/SKILL.md` step 7 spells out.

This used to say the opposite: push the work-log commit *before* opening the PR.
That advice was self-contradictory (the entry carries the PR number, so it
cannot be written before the PR exists) and it caused the OTHER failure while
avoiding this one. Follow it and the work-log commit is the newest
hand-authored commit when the PR is named, so `pickPullRequestCommit` titles the
PR after it — `SHIP_AUTHORED_SUBJECTS` skips only the re-pin and nudge subjects,
and a work-log commit is hand-authored. Squash-merge then makes that title
permanent. That is exactly the #304 failure, and why
`docs/MISLABELED_MERGES.md` exists.

## The party line is not the only way out — and the 2026-08-23 outage

The relay only hands a ticket back once the operator's answer has been
**delivered**. That gate is right: a ticket must never move on an answer that
nobody received. But until 2026-08-23 "delivered" meant exactly one thing —
a chat message posted to the party line — and that made the busiest surface in
the stack a single point of failure for the whole pipeline.

**What happened.** For about sixteen hours, every chat write in the workspace
returned `HTTP 400` and every custom-field write returned `usages exceeded`.
The party line's own history dates it precisely: last message before the gap
**06:00:08Z**, next message **22:04:00Z**, nothing in between. Twenty-three
comments and five handbacks piled up behind it, including two answers written
at 06:19 that sat for the rest of the day. Then it cleared on its own. Cause
unknown, and almost certainly ClickUp-side.

**The first diagnosis was wrong, and it is worth knowing why.** The failures
were read as the Free Forever plan blocking chat posting, and the proposed fix
was to pay for an upgrade. Two commands disproved it once the outage lifted:

```bash
# Still on the same plan it was on before, during and after:
GET  /api/v2/team/<team>/plan                     # 200 — "Free Forever", plan_id 13

# And chat posting works on that plan:
POST /api/v3/workspaces/<ws>/chat/channels/<ch>/messages   # 200 — message id returned
```

Nothing about the plan had changed, so nothing about the plan could explain a
window that opened and closed. **If you see a wall of 400s from chat writes,
check whether it is a window before you go looking for a permission** — read
the channel's own timestamps, and try again in an hour. Paying would have
fixed nothing.

**What changed as a result.** The gate stayed; its target moved. Delivery is
now a chain, not a single call (`deliverToBus` in `scripts/clickup_direct.mjs`,
decisions in `scripts/builder/busRelayPlan.js`):

1. Post to the party line.
2. If that fails — **and only on a watch that hands the ticket back** — post a
   short **receipt comment** on the ticket the message concerns. Task comments
   were the one write that kept working throughout. It is a receipt, not a
   re-quote: his words are already on that ticket one comment up; what was
   missing was the acknowledgement they were read.
3. The handback fires if **either** landed.

**That carve-out in step 2 is the most important line here.** Of the three
watched cases only one hands a ticket back (`needs your input` in the Loop
Queue). On the other two — the Agent Response list, and `ready to launch` —
**nothing reads the ticket**: the party line IS the delivery. So no receipt is
written there at all, the message stays undelivered, it lands in "Could not
fully verify", and it retries every pass until the bus takes it. Counting a
receipt there would post a note to Dane on a ticket he is already looking at,
write the permanent dedup marker, and lose the bus message for good once chat
recovered — turning a self-healing retry into silent permanent loss.

The receipt is **read back before it is trusted**, and it is identified by the
comment id ClickUp returned plus the ISO instant folded into its signature line
— never by its wording. A receipt's wording is a constant, so matching on that
would let a leftover receipt from an earlier outage "verify" a fresh write that
never stuck, which is the exact case the read-back exists to catch.

The dedup marker records which surface carried it — `[bus-relay] sent to
channel X at …` versus `[bus-relay] chat unavailable, receipted on the ticket
at …` — behind the same prefix the "already relayed" check reads, so the trail
stays legible without changing how it is parsed.

A chat failure that was covered this way is **not a run failure**. It prints
under its own heading (*"Party line unavailable — N bus post(s) skipped; the
record is on the ticket in each case"*) and the pass still exits 0. The same
goes for the merge step's three bus posts: each of those writes its real
explanation onto the ticket first, so a failed bus post there was only ever
cosmetic and should never have stopped a pass. Those merge-step entries carry
**no receipt comment** — their record is the explanation the merge step already
wrote — which is why the heading says "the record is on the ticket" rather than
naming receipts.

What did **not** change: a message that reached neither surface is still
undelivered, still lands in "Could not fully verify", still exits 1, and still
moves no ticket. The gate was re-pointed, not weakened.

### Running the relay by hand

`bus-relay` belongs to the Mac Mini (`lib/nodeRoles.js`), so every hand-run of
it happens over `ssh` — and a non-interactive `ssh` shell has neither `doppler`
nor `node` on its `PATH`. Export it first or the command fails with a bare
"command not found" that looks nothing like a relay problem:

```bash
export PATH=/opt/homebrew/bin:$PATH

npm run clickup -- bus-relay --dry-run              # says what it would do, writes nothing
npm run clickup -- bus-relay --only-task <task-id>  # one ticket, real writes
```

To exercise the fallback deliberately rather than waiting for the next outage,
point the pass at a channel id that does not exist:

```bash
npm run clickup -- bus-relay --only-task <task-id> --channel 0000-nonexistent
```

Green is: **exit 0**, a receipt comment on the ticket, the ticket moved to
`Queued`, and the skipped bus post named under *"Party line unavailable"*
rather than under *"Could not fully verify"*.

That test needs a **fresh, un-relayed comment from the operator** — the relay
filters on `OPERATOR_ID` and skips anything already carrying a `[bus-relay]`
marker. The cheap way to make one is to ask Dane to comment on any parked
ticket; it costs him ten seconds. `CLICKUP_OPERATOR_ID` is an env override, so
a scratch ticket plus a comment of your own works too. Do **not** delete an
existing `[bus-relay]` marker to manufacture one — that is destructive, and the
run will then send his real answer to a dead channel.

## The pulse — is anything actually moving? (2026-08-25, task 86bbm9h60)

```
npm run pulse                 # human-readable, exit 0 whatever it finds
npm run pulse -- --json       # machine-readable
npm run pulse -- --exit-code  # 0 clean / 1 findings / 2 could not look
npm run pulse -- --job loop-review   # read a different loop's log
```

**Seven incidents in the week to 2026-08-25. Not one of them was a crash.**
Every single one was a component that ran, exited 0, and accomplished nothing:
a build loop that declined thirteen passes in a row on a deadlocked cap,
tickets sitting seventy hours in `Building`, a pull request and its ticket
linked in only one direction. A health check would have passed during all of
them, because every process was alive and every exit code was 0.

That is why the pulse measures **flow, never status**. "Is it running" is the
question that failed; "is anything moving" is the question that works.

It is **read-only** — three GET-only sources, no write path in the file at all,
and a test that fails if one is ever added. It reports and stops. Repairs live
in `npm run reconcile`, deliberately: the fourth drift shape below has two
valid fixes and only a person knows which one is right.

### A1 — the no-op streak

Consecutive loop passes that claimed nothing. A declining pass and a healthy
quiet pass are byte-identical from outside, which is how fourteen hours of a
dead build loop read as a quiet morning.

| Number | Value | Where it came from |
|---|---|---|
| Streak threshold | **3 passes** | One claimless pass is normal, two is plausible. Eight happened; thirteen happened on 2026-08-25. Three is the first count that cannot be explained away. |
| Gate | **only while `Queued > 0`** | A loop declining an empty queue is working perfectly. Alarming on that teaches the reader to ignore the alarm. |
| Hung pass | **4 hours** | A pass is 10–15 minutes of work; the longest in a 580-pass sample was 38 minutes. |

The source is `~/loop-logs/loop-build.log`, whose body is **the agent's own
prose report, not tool output** — there is no structured claim record to read.
So a pass is classified off the *deterministic strings the loop's own commands
print* and a declining pass quotes verbatim: `wipCap.js`'s "WIP cap reached —
N PR(s) open, cap M", `nodeRoles.js`'s "so it did nothing.", and the harness's
own quota notice. Measured against 580 real passes, **90% classify; the other
10% are reported as CANNOT TELL, never as a decline.** That asymmetry is the
point — guessing "declined" invents an outage, guessing "claimed" hides one.

An early draft matched `wip-check` and `exit 3` *anywhere* in the body and
mislabelled a genuine claim, because `build-start` — a different command — had
exited 3 for an unrelated reason. Requiring the quoted message is the fix.

### A2 — stage residency

How long each ticket has sat where it is.

| Stage | Threshold | Where the number came from |
|---|---|---|
| Building | **2 h** | A build takes 10–15 minutes. Three tickets measured 65–72 hours on 2026-08-25. |
| In review | **4 h** | A review takes about 10 minutes on an hourly poll, so 4 hours is already several missed polls. |
| Ready to launch | **24 h** (notice, not alarm) | Operator-held. Surface it; do not alarm — only Dane moves a ticket out of it. |
| Queued | **7 days** (notice) | Long is fine. Forgotten is not. |

**`date_updated` is a proxy for stage entry, not a measurement of it.** ClickUp
bumps it on any edit, so a comment or a Loop-note stamp resets the clock. The
error runs one way — it makes a stuck ticket look *fresher* than it is — so the
check under-reports, and every run says so rather than implying a precision the
data does not have. A stage with no threshold (`Needs your input`, `Live`) is
listed as **not measured**, never silently skipped.

### B1 — ticket ↔ PR drift, in both directions

| Shape | Meaning | Severity |
|---|---|---|
| 1 | Non-terminal ticket, PR **merged** — the work is live and the ticket did not follow | notice (`reconcile` repairs it) |
| 2 | Terminal ticket, PR still **open** — a zombie branch | alarm |
| 3 | In-flight ticket, **no PR on either side** — stranded | alarm |
| 4 | A PR names a ticket, **the ticket has no record of that PR** | alarm |

**Shape 4 is the dangerous one, and the reason this check reads both
directions.** `build-start` decides whether a branch already exists by reading
*the ticket*. A link that exists only on the PR side is invisible to it, so the
next pass opens a second branch for work that already has one — exactly how
duplicate PRs #407 and #408 were born. Real case: PR #373 ↔ 86bbjj6qb, found
while writing the design and since repaired by hand.

Two distinctions cost false positives on the first production run, and both are
now guarded by tests:

- **`Queued` is neither in-flight nor terminal.** A queued ticket with an open
  PR is a **send-back** — the ordinary state of work a review handed back, and
  the exact state `build-start` exists to recognise. Reading "not in flight" as
  "finished" called two of them zombies.
- **A PR *mentioning* a ticket is not a PR *claiming* one.** The link is the
  ClickUp URL line the PR body is required to carry, not any id appearing in
  prose. PR #435 discusses four other tickets — one of them the literal example
  `86bbnonexistent` — while declaring exactly one.

### The five rules, which matter more than the checks

1. **Silence is never all-clear.** Every check prints a section whether or not
   it found anything, so "all clear" and "the job died" can never look alike.
2. **"Cannot tell" is its own state**, never folded into "fine" (DOCTRINE
   3.11) — and it has its own exit code (2) so a caller can treat "I could not
   look" differently from "I looked and it was fine".
3. **Every count carries its breakdown.** `7 open, cap 5` was true and hid a
   deadlock for four passes.
4. **The bottleneck is named in a sentence** — "Bottleneck: BUILD (4
   consecutive claimless passes, 26 queued). Ready to launch holds 1." A table
   of rates makes the reader do arithmetic they will skip.
5. **The pulse cannot fail silently either.** Every completed run ends with
   `PULSE COMPLETE <timestamp>`, so a scheduled run that does not print that
   line is itself the alert. It writes no heartbeat file, because the ticket's
   non-goals forbid the pulse writing anything; a persisted heartbeat belongs
   to phase 2 alongside the daily digest.

### Where the code lives

`scripts/builder/pulse.js` is **pure** — every threshold, every classification
and every sentence, with no clock, no network and no disk (a test enforces
that). `scripts/pulse.cjs` holds only the reads. That split is what makes a
threshold break-testable, and a threshold nobody can break-test is one that
gets tuned by whoever is annoyed that day.

Phase 1 is deliberately only these three checks — the ones that would have
caught real incidents — so the value is provable before the other nine in the
design are written. **There is no dashboard, on purpose:** a screen nobody
opens manufactures the feeling of oversight, which is the failure being
designed against.

## Reading the queue at a glance — the Loop note

The Status column says which STAGE a ticket is in; the **Loop note** column
says what is actually happening and what happens next, in plain language:
`🔨 building — claimed 10:12am`, `🔀 PR #351 open — waiting for a review pass`,
`🔍 being checked — a review pass started 8/23 3:41am`,
`👀 verified — waiting on Dane to say "merge"`, `↩ returned to the line…`,
`✅ live 8/20`. An empty note means "waiting in line" — correct, not a gap.
The note is not decoration in one case: `🔍 being checked` is loop-review's
**claim** on a ticket, and the next review pass reads it to decide whether to
leave that ticket alone (see "Two passes, one ticket" above). `queue` and `get`
both print it, as the last column and as a `loop note:` line.
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

## Per-repo gates — a task declares its repo

The Loop Queue is not starcaster-only. A task declares its repo with a
`repo:<name>` **tag**; no tag means `starcaster` (so nothing already in the
queue changes). The resolver is `scripts/builder/taskRepo.js` — one function,
not prose each loop re-reads differently — and the `queue`/`get` commands
surface the result (`queue` prints a **repo** column, `?<name>` = "escalate,
do not build"; `get` prints a `repo:` line). An unknown repo name, or two
different `repo:` tags, is never guessed: the build loop moves the task to
`Needs your input`.

Each repo runs its OWN gates in its OWN checkout. A repo without a test suite
declares what it *does* have rather than silently running nothing:

| Repo | Checkout | Gates a loop runs |
|---|---|---|
| `starcaster` | `~/WebApps/starcaster` | the full set above — `typecheck`, `test:builder` / `test:builder-ui`, generated-artifact rebuilds, `check_conventions`, and the UI checks when a panel or render changed |
| `normie` | `~/WebApps/normie` (sibling) | that repo's own `npm run typecheck` and test suite; it shares the Builder schema, so schema-touching work rebuilds the same generated artifacts |
| `pulse` | `~/WebApps/pulse` (sibling) | no app test suite — `node --check` on every changed `.mjs`/`.cjs`, plus any generator's determinism check (run it twice, diff); say in the PR that this is the whole gate |
| `vault` | `~/vault` | a no-machinery, prose-only repo — there is no build. The gate is a clean `git` diff reviewed by eye plus the vault-drift check (`npm run check:vault-drift`, once it lands); **the loop never runs machinery inside the vault**, it only edits and commits prose |

The checkout paths are derived at runtime (`taskRepo.js` finds the main
starcaster checkout via git and its siblings beside it; the vault is
`~/vault`), never hardcoded — NODES P1. A sibling repo whose checkout is not
present on the machine is an escalation, not a silent skip.

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
