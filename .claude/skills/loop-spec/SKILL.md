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
runnable form, its ACTUAL output pasted in a ``` fence, and when you ran it in
his clock ("measured at 8:04pm").
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
   the total. Remind the operator they can now start the build loop:
   `/loop 30m loop-build` — from wherever this session already is; the build
   loop makes its own worktree per task.

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
