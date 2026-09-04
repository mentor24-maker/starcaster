---
name: loop-spec
description: Turn a rough idea from the operator into a set of small, well-scoped, independently-shippable work items filed as ClickUp tasks in the Starcaster "Loop Queue" list, each with acceptance criteria and test steps. This is the ONLY manual step of the loop — run it at the start of a work session to feed the build/review loops.
---

# Loop: Spec

This is step 1 of 3 in the Starcaster development loop (spec → build → review).
See `docs/LOOP_ENGINEERING.md` for the whole system.

Your job: interview the operator about an idea, then break it into a queue of
small tasks that the `loop-build` skill can build one PR at a time. You do NOT
write any code here. You produce well-formed tasks.

## Inputs

- A rough idea or goal from the operator (one sentence is fine to start).
- Optionally: a target ClickUp list name (default: **"Loop Queue"**, list id
  `901418546619` — ids and the space-vs-list trap are documented once in
  `docs/LOOP_ENGINEERING.md` §"ClickUp access"). File tasks through the
  direct script, which carries priority and tags and verifies the body saved:
  `npm run clickup -- task --list 901418546619 --name "..." --status Queued --priority high --tags "epic-name" --body-file -`
  (body on stdin). The connector works too when its budget allows, but the
  direct route is the one that cannot be starved by other sessions.
  **File at High or below.** Urgent is the operator's own lane (ratified
  2026-08-18) — the queue sorts priority-then-age, so an Urgent flag is a
  human override that outranks everything the loop decided, and that only
  works if agents never set it themselves. `task --priority urgent` refuses
  outright unless `--operator-asked` is also passed, and that flag is a
  claim, not a permission check — only add it when the operator explicitly
  asked for Urgent, by voice or in writing.

## Workflow

1. **Interview until confident.** Ask the operator focused questions — a few at
   a time, plain language — until you understand the goal well enough to write
   tasks a fresh agent could build with no further context. Cover: what "done"
   looks like, which modules/screens/files are in scope, what is explicitly NOT
   in scope, how a human would verify it, and any visual/UX reference. Keep
   asking until you could hand it to someone who has never seen the idea.

2. **Split into small, independent tasks.** Each task must be:
   - **One PR's worth of work** — if it needs more than a few files or touches
     unrelated systems, split it.
   - **Independent** — buildable without waiting on another task in the queue,
     so parallel loops don't collide. If two tasks must touch the same file,
     merge them into one task or note the ordering explicitly.
   - **Reviewable by a human in a couple of minutes.**

3. **Write each task.** File a ClickUp task in the target list with
   `status: "Queued"`, **no assignee** (assignment is how the loops hand a
   ticket to Dane — see below), and a `markdown_description` in exactly this
   shape.

   **If the task is not for starcaster, tag it `repo:<name>`** (`normie`,
   `pulse`, or `vault`). A task with no `repo:` tag builds in starcaster — the
   default, so most tasks need no repo tag at all. Only tag when the work
   lives in another repo; an unknown repo name makes the build loop escalate
   the task rather than build it, so use exactly one of the four known names
   (`starcaster`, `normie`, `pulse`, `vault`).

   **The description is the LEFT column, and it is where the detail goes.** The
   right-hand column is narrow; reasoning written there arrives as a wall of
   text in the skinniest part of the screen. Ratified 2026-08-22, after Sync
   6/7 and 7/7 both stalled on exactly that. The right column carries only the
   operator card (see "The operator card" below).

   **Never use a `> ` blockquote anywhere in a ClickUp body.** ClickUp *deletes*
   those lines — from descriptions and from comments alike. They do not arrive
   unformatted, they arrive not at all, and the write still returns a clean 200.
   Found live on 2026-08-22, on the first ticket rewritten with this template:
   the quoted instruction was gone and nothing said so. Use a fenced block.
   `describe` and `ask` both refuse a body containing one.

   ## Goal
   One or two sentences: what this task does about it.

   ## Scope
   - Bullet list of what this task changes.

   ## Non-goals
   - What this task must NOT touch (prevents scope creep in the build loop).

   ## Affected files / artifacts
   - Source files likely involved — real paths, checked, not guessed.
   - Generated artifacts + their rebuild command (see CLAUDE.md table), e.g.
     "edits builder-template.ts → MUST run `npm run build:builder-template`".

   ## Acceptance criteria
   - [ ] Concrete, checkable outcomes. The build loop is done when all are met.

   ## How to test
   - Steps **the operator** can follow, not steps a developer can follow.
     Every step is one of exactly two things:
       1. **a link he can click**, or
       2. **an exact command to copy and paste**, with the output it should
          print written next to it.
     No step may assume the reader knows where to go or what "right" looks
     like. "Open the page in a browser" is not a step. Neither is "run the
     generator and open the SVG" — that is a developer's instruction wearing
     a test's clothes.

   ## Risk
   low | medium | high — and one line on the blast radius.
   ````

   Tag each task with the feature/epic name so the queue stays legible.

   To rewrite an existing task's description, use the direct script — it
   refuses an empty body and reads the result back, because this write
   **replaces** the whole left column:

   ```bash
   npm run clickup -- describe --task <id> --body-file -
   ```

## Never say something is waiting on Dane without checking

**One command, run BEFORE the sentence leaves your mouth:**

```bash
npm run clickup -- waiting                    # what actually needs him, both lists
npm run clickup -- waiting --task <id>        # one ticket: status, assignee, last word, verdict
```

Read-only, a couple of seconds, exit **0** nothing of his / **3** something IS
his / **1** could not tell. It reports the verdict from three live facts — the
status, whether he is assigned, and whether the newest comment is his — so a
ticket he has already answered can never be handed back to him a second time.

Twice on 2026-08-23 an agent told him something was waiting on him when it was
not, and he acted on it both times: eleven of "seventeen tickets waiting on
your merge word" already carried his approval, and the YouTube worker question
he was asked again had been answered `A` an hour earlier. Him, that night:
*"The issue is making assumptions and stating them with confidence. It has come
up many times."* Every wrong claim that evening was a confident sentence with
nothing attached; every right one carried its evidence. This is the evidence,
and it is cheaper to run than the claim is to reason about.

Applies to the run report as much as to a comment. `ask` enforces the same rule
at its own end — it refuses to hand a ticket back when his comment is already
the newest one on it (`--after-his-answer` overrides, on the record).

## The operator card — the only thing that goes in the right column

Anything a loop puts in front of Dane goes through **one** command, which posts
the card and moves the status together so the two can never come apart:

```bash
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -
```

The body is four sections plus a fifth that costly asks must carry, and the
check runs **before** anything is sent:

```
@@ASKED
build the chip display
@@WHEN
2026-08-22 10:56am, on this ticket
@@CONTEXT
The problem and the fix in plain English. 50-100 words, enforced — under 50 it
stops carrying enough to act on, over 100 it becomes the wall of text this
replaces. The long version belongs in the description.
@@NEEDED
The specific ask. "Nothing right now" is a good answer and a useful one — but it
has to be written down, not left blank.
@@EVIDENCE
Required ONLY when the ask costs money or cannot be undone (spend, buy,
subscribe, upgrade, plan change, credential rotation, deletion): the command in
runnable form, its ACTUAL output pasted in a ``` fence, and one line saying
when you ran it — `@@MEASURED 8:04pm`, the clock and nothing else. That line is
the only thing that dates the card; every other clock in the section, narrated
or inside the paste, is ignored.
```

It renders with `@@NEEDED` under a banner he can spot without reading:

```
#############################
NEEDED FROM DANE: 
#############################
```

`status --status "Needs your input"` now refuses on its own and points here.
The escape hatch is `--no-card`, which is a written claim that no card is owed,
not a way around the format.

4. **Report back.** List the tasks you filed (name + risk + one-line goal) and
   the total.

   **Then say what the build loop is actually doing — never tell him to start
   one without checking.** Both lanes have run unattended on the Mac Mini as
   launchd agents since 2026-09-02 (`com.starcaster.loop-build`,
   `com.starcaster.loop-review`, driving the committed
   `scripts/loop_runner.sh`). The line that used to close this step —
   *"you can now start the build loop: `/loop 30m loop-build`"* — was written
   when loops were started by hand, and it is now wrong in both directions:

   - If a loop IS running and he starts another, the second one is a second
     claimant. Claiming a ticket is check-then-act (a GET, a comparison, a
     PUT), which is only sound with exactly one claimant — the whole reason
     `lib/nodeRoles.js` exists.
   - If it is running on a machine this session is not on, the pass he starts
     declines and exits 0, and a queue that never moves looks exactly like a
     queue with nothing to do.

   It happened on 2026-09-03: a session filed three tickets, recited this line,
   and the loop was already alive on the Mini with a pass 40 minutes old. Dane
   caught it (ticket 86bbuv0kp).

   One command answers it, run on the machine that owns the role — from here,
   over SSH to the Mini:

   ```
   ./scripts/install_loop_runner.sh --status
   ```

   It reports, per lane: installed, loaded (a PID means the runner is alive),
   whether the lock is held by a live pid, and when the log was last written.
   Report that in plain language, plus the two states that matter most, because
   **a loop that is alive and claiming nothing is the failure that reads as
   healthy**:

   - the work-in-progress cap is full (`5 in flight, cap 5`) — the merge side
     is the bottleneck, not the queue. Say which tickets are waiting to merge.
   - the pipeline is paused (`npm run pipeline -- check`, exit 3) — say since
     when and why.

   Offer to start a loop by hand ONLY when the check shows none running AND
   this machine owns the role (`npm run node:owns -- loop-build`, exit 0).
   Then, and only then, the command is `/loop 30m loop-build` — the loop makes
   its own worktree per task, so it may be started from any folder.

## Evidence, or it is a question

A **defect ticket must cite its mechanism**: the file and function (or line)
of the code it claims is wrong, quoted — not the log line that prompted the
suspicion. A log line is where a defect is NOTICED; the mechanism is where it
IS, and the two disagree more often than anyone expects.

WHY THIS IS A RULE AND NOT ADVICE (2026-09-02, task 86bbtujfj). Of five
defect tickets filed that morning by the session with the most context on the
system, **four had a materially wrong premise** — every one written from a
log line before reading the code. One said four slots were dead when it was
two and named the wrong counting mechanism entirely; one's core ask was
reversed by reading the module it targeted; one's proposed fix was killed by
measuring the thing it wanted to alarm on. Each needed a correction comment
before building. The loops build unattended from exactly this text: a wrong
premise in a description becomes a wrong build with nobody checking the
reasoning.

Two requirements, checked by the review loop on the other end:

*   **Quote the mechanism.** An `EVIDENCE:` line (or section) naming
    `file — function/line` and quoting the behaviour claimed. If you cannot
    cite it, you have a suspicion, not a defect — **file it as a QUESTION**
    (a ticket that asks, in its name, rather than asserts) and let the
    builder's first step be reading the code.
*   **A threshold or trade-off names its measurement.** "Alarm after N hours"
    carries what N was measured against — or says plainly *"not measured"*,
    which hands the measuring to the builder as the first acceptance
    criterion. The 2026-09-02 recency-alarm ticket died precisely there: 189
    real closures showed its proposed threshold firing on eleven nights in
    fourteen.

## Guardrails

- **Prefer low-risk tasks first** when ordering a new queue, so the loop earns
  trust before touching fragile areas (`public/js/`, module dual-registration,
  anything that publishes to tenant sites).
- **Flag anything that can't be a clean small PR.** If an idea is really a big
  refactor, say so and propose how to slice it, rather than filing one giant
  task.
- Never file a task whose acceptance criteria you couldn't verify yourself.
- **Read your own "How to test" back as Dane.** He said it plainly on task
  86bbh7qer:

  > This should include a clickable link I can click to test... none of the "How to test" options are clear how I actually do it.

  A step he
  cannot act on without asking a follow-up question is not a test step, and a
  ticket full of them hands the verifying back to him at the exact moment the
  loop was supposed to have done it. If the work has a visible surface and you
  cannot name a link, say so in the ticket — that is a scoping problem worth
  seeing, not a formatting one to paper over.

## First-time setup

If the "Loop Queue" list does not exist yet, create it in the Starcaster space
and tell the operator to confirm (once, in the ClickUp UI) that it uses this
status set, in this order:

| Status | Type in ClickUp | Meaning |
|---|---|---|
| `Queued` | not started | waiting for a build loop to pick it up |
| `Building` | active | a build loop is writing the code |
| `In review` | active | a review loop is verifying the PR |
| `Needs your input` | active | **operator's** — a human must answer something |
| `Ready to launch` | active | **operator's** — built and verified, awaiting the merge |
| `Live` | **closed** | merged and shipped; leaves the open view |

`Live` must be set as a **closed**-type status, not just another active one, or
finished work never leaves the operator's open list. The build and review loops
key off these names (matched case-insensitively).

**Assignment carries the handoff, not a saved view.** Dane's "what needs me"
is ClickUp's built-in *Assigned to me*. A hand-built filtered view was tried
and abandoned: Loop Queue lives in the Starcaster space and the steward's
Agent Response list lives in Dane of Earth, and a ClickUp view scoped to one
space cannot see the other. Assignment crosses spaces for free and notifies
him. So loops assign Dane when a ticket enters `Needs your input` or
`Ready to launch`, and clear assignees when it goes back to a machine status.
Tasks you file here start unassigned.
