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

3. **Write each task.** File a ClickUp task (`clickup_create_task`) in the
   target list with `status: "Queued"`, **no assignee** (assignment is how the
   loops hand a ticket to Dane — see below), and a `markdown_description` in
   exactly this shape:

   ```markdown
   ## Goal
   One or two sentences: what and why.

   ## Scope
   - Bullet list of what this task changes.

   ## Non-goals
   - What this task must NOT touch (prevents scope creep in the build loop).

   ## Affected files / artifacts
   - Source files likely involved.
   - Generated artifacts + their rebuild command (see CLAUDE.md table), e.g.
     "edits builder-template.ts → MUST run `npm run build:builder-template`".

   ## Acceptance criteria
   - [ ] Concrete, checkable outcomes. The build loop is done when all are met.

   ## How to test
   - Steps a human (or the review loop) follows to confirm it works, including
     which page/module to open.

   ## Risk
   low | medium | high — and one line on the blast radius.
   ```

   Tag each task with the feature/epic name so the queue stays legible.

4. **Report back.** List the tasks you filed (name + risk + one-line goal) and
   the total. Remind the operator they can now start the build loop:
   `/loop 30m loop-build` (in its own worktree).

## Guardrails

- **Prefer low-risk tasks first** when ordering a new queue, so the loop earns
  trust before touching fragile areas (`public/js/`, module dual-registration,
  anything that publishes to tenant sites).
- **Flag anything that can't be a clean small PR.** If an idea is really a big
  refactor, say so and propose how to slice it, rather than filing one giant
  task.
- Never file a task whose acceptance criteria you couldn't verify yourself.

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
