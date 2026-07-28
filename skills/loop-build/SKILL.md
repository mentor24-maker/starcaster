---
name: loop-build
description: Pick the next "todo" task from the Starcaster "Loop Queue" ClickUp list and build it end-to-end into a pull request — in its own git worktree, passing every build gate — then move the task to "review". Designed to be run on a timer with `/loop 30m loop-build`. Never edits main, never merges.
---

# Loop: Build

This is step 2 of 3 in the Starcaster development loop (spec → build → review).
See `docs/LOOP_ENGINEERING.md` for the whole system.

Each run of this skill builds **one** task into **one** PR. When run under
`/loop`, it repeats, draining the queue one clean PR at a time.

## Workflow

1. **Claim the next task.** Find the oldest `todo` task (highest priority first)
   in the **Loop Queue** list (Starcaster space, id `90146476303`). If none,
   report "queue empty" and stop — do not invent work. Set its status to
   `building` so a parallel build loop won't grab the same one.

2. **Get an isolated workspace — MANDATORY.** Create a dedicated worktree and
   branch off the latest main. Never build in a shared folder; never edit main.

   ```bash
   git -C /Users/mentor/WebApps/starcaster fetch origin --quiet
   git -C /Users/mentor/WebApps/starcaster worktree add \
     .claude/worktrees/<task-slug> -b <task-slug> origin/main
   cd /Users/mentor/WebApps/starcaster/.claude/worktrees/<task-slug> && npm ci
   ```

   `<task-slug>` = short kebab-case name from the task. Do ALL work for this
   task inside that worktree.

3. **Build to the acceptance criteria.** Implement exactly what the task's
   Scope and Acceptance criteria describe. Respect the Non-goals — do not
   refactor unrelated code. Edit source, never generated artifacts (a hook
   blocks that anyway).

4. **Run the build gates — the definition of done.** All must pass:
   - `npm run typecheck`
   - Affected tests: `npm run test:builder-ui` and/or `npm run test:builder`
   - The rebuild command for **every** generated artifact touched (see the
     CLAUDE.md artifact table). Landmine: editing `builder-template.ts` without
     `npm run build:builder-template` silently turns the module into `"text"`.
   - `node scripts/check_conventions.cjs`
   - `npm run check:syntax` if `public/js/` or `public/shared/` was touched.

   If a gate fails and you cannot fix it **within the task's scope**, set the
   task to `blocked`, add a ClickUp comment explaining exactly what failed, and
   stop. Do not force a broken build through, and do not expand scope to chase
   an unrelated failure.

5. **Commit and open the PR.**
   - Inspect `git diff --cached` before committing (staging is whole-file; make
     sure no stray edits ride along). Never commit generated artifacts.
   - Commit message ends with the Co-Authored-By trailer from CLAUDE.md.
   - Push the branch and open a PR to `main` with `gh`. The PR body must
     include: link to the ClickUp task, a plain-language summary, the task's
     "How to test" steps, and a note that a Vercel preview will be attached.
     End with the Generated-with trailer.

6. **Hand off to review.** Set the task status to `review` and add the PR URL
   as a ClickUp comment. **Do NOT merge** — `main` is PR-protected (the
   "verify" check must go green) and merges happen only on the operator's
   explicit say-so. The `loop-review` skill takes it from here.

7. **Report** which task you built and the PR number, then finish (the `/loop`
   wrapper will re-invoke you for the next task).

## Guardrails

- **One task, one worktree, one PR.** Never build two tasks in one branch.
- **Never touch a task that isn't `todo`.** `building`/`review`/`blocked` are
  owned by another step.
- If the task description is too vague to build safely, set it `blocked` with a
  comment asking for a `loop-spec` pass — don't guess.
- Leave the worktree in place until the PR merges; `loop-review` may reuse it.
