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
3. **When you're ready:** reply **`merge`** on the ticket — just that word.
   Within one bus-relay cycle (hourly) it is merged and the ticket closes as
   `Live`, provided the PR is still open, green and conflict-free. Telling a
   CC session "merge PR #NN" still works and is faster if one is open; the
   comment is the version that works when nobody is watching. Either way the
   decision is yours — see Safety.
4. **When a ticket asks you a question** (`Needs your input`): answer it as a
   comment on the ticket. Within one bus-relay cycle (hourly) your answer is
   posted to the bus and the ticket goes back to `Queued` for a build loop to
   pick up — the comment alone is enough, no status clicking.

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
  and the hourly relay carries it out (task 86bbjd5nn) — which moves the
  *hands*, not the *decision*. The relay merges nothing you did not name, on a
  ticket no independent review passed, or on a branch that is red or in
  conflict. It exists because on 2026-08-20 three tickets you had already
  approved sat unmerged for hours waiting for a human to notice: the
  checkpoint was doing its job, the delay after it was pure friction.
- **Every loop runs in its own worktree.** Two agents in one folder clobber
  each other's files — the single most common way this repo breaks. The build
  skill creates a fresh worktree per task automatically.
- **Every build passes the full gate set before a PR opens** — `typecheck`,
  the builder tests, the conventions check, the syntax check, and the rebuild
  command for any generated file. A task that can't pass gets marked
  `Needs your input` for a human instead of shipping broken.
- **Review is independent.** It re-runs everything and actually opens the page
  in a browser; it never rubber-stamps the build loop.

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
