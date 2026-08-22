---
name: loop-build
description: Pick the next "Queued" task from the Starcaster "Loop Queue" ClickUp list and build it end-to-end into a pull request — in its own git worktree, passing every build gate — then move the task to "In review". Designed to be run on a timer with `/loop 30m loop-build`. Never edits main, never merges.
---

# Loop: Build

This is step 2 of 3 in the Starcaster development loop (spec → build → review).
See `docs/LOOP_ENGINEERING.md` for the whole system.

Each run of this skill builds **one** task into **one** PR. When run under
`/loop`, it repeats, draining the queue one clean PR at a time.

## ClickUp access: use the direct script, not the connector

Every ClickUp touch goes through **`npm run clickup -- <command>`** — a full
standalone command each time (shell functions do not survive between tool
calls). Doppler supplies the token; you never see or handle it. The command
list, the ids, and the reasoning live in ONE place: `docs/LOOP_ENGINEERING.md`
§"ClickUp access". The moves this loop makes:

```bash
npm run clickup -- queue --list 901418546619 --status Queued   # FIRST LINE is the task to claim
npm run clickup -- status --task <id> --status Building --if-status Queued   # safe claim; exit 3 = someone beat you, take the next
npm run clickup -- status --task <id> --status "In review"                   # hand off (assignees auto-cleared)
npm run clickup -- status --task <id> --status "Needs your input"            # escalate (Dane auto-assigned)
npm run clickup -- comment --task <id> --body-file -                         # body on stdin
```

Use the connector only if the direct script itself is broken, and say so in
the run report.

## Workflow

1. **Claim the next task.** Find the oldest `Queued` task (highest priority
   first) in the **Loop Queue** list (id `901418546619`). If
   none, report "queue empty" and stop — do not invent work. Claim it with
   `--status Building --if-status Queued`: the guard makes the claim atomic,
   so a parallel build loop that got there first shows up as exit code 3 —
   take the next task instead of proceeding.

   The list's six statuses, in order, are `Queued → Building → In review →
   Needs your input / Ready to launch → Live`. Match them case-insensitively.
   Two of them belong to the operator and no loop may set or clear them except
   as described below: **Needs your input** (a human must answer something) and
   **Ready to launch** (a human must authorize the merge).

   **Assignment is the handoff signal.** Dane's ClickUp view of "what needs me"
   is ClickUp's own *Assigned to me*, not a hand-built filter — a filtered view
   cannot span the Starcaster and Dane of Earth spaces, but assignment does.
   So the rule is mechanical:

   - Moving a ticket **into** `Needs your input` → Dane must be assigned.
   - Moving a ticket into any machine status (`Queued`, `Building`,
     `In review`) → assignees must be cleared, so it leaves his list the
     moment it stops being his.

   `npm run clickup -- status` enforces both automatically and verifies the
   assignee half of the write — you only need flags to deviate.

   A ticket sitting in a machine status with Dane still assigned is a bug: it
   puts noise in the one view he trusts. The claim in step 1 clears assignees
   automatically; if the status command ever reports an assignee that did not
   stick or clear, treat that as a failed handoff, not a cosmetic detail.

   **Which repo the task belongs to.** The Loop Queue carries work for more
   than one repo. A task declares its repo with a `repo:<name>` tag (known:
   `starcaster`, `normie`, `pulse`, `vault`); no tag means `starcaster`. The
   `queue` and `get` commands already resolve it — `queue` prints a **repo**
   column (`?<name>` there means "does not resolve — escalate"), and `get`
   prints a `repo:` line. The rule the resolver enforces
   (`scripts/builder/taskRepo.js`):

   - **A known repo, present on this machine** (or no tag → starcaster) →
     build in THAT repo (step 2).
   - **An unknown repo tag, or two different repo tags** → do NOT build. Move
     the task to `Needs your input`, assign Dane, comment why (quote the
     `get` command's `repo:` line), and take the next task. Guessing would
     build in the wrong checkout against the wrong gates and call it done.
   - **A known repo whose checkout is NOT on this machine** → escalate too.
     The `get` command's `repo:` line reads
     `ESCALATE — repo:<name> is not checked out on this machine (<path>)`;
     quote it. (This is why step 2 can assume `$REPO` exists.)

2. **Get an isolated workspace — MANDATORY.** Create a dedicated worktree and
   branch off the latest main, **inside the repo the task declares**. Never
   build in a shared folder; never edit main. `$REPO` is that repo's checkout,
   resolved by `taskRepo.repoHome('<repo>')` — this checkout for `starcaster`,
   the sibling or `~/vault` for the others. (Step 1 already ESCALATED a repo
   whose checkout is missing, so by here `$REPO` exists.)

   Run this as ONE command — shell variables do not survive between tool
   calls, and `REPO` has to still be set when the later lines use it. `npm ci`
   is skipped where the repo has no `package.json` (the vault is prose-only):

   ```bash
   REPO="$(node -e "console.log(require('$(git rev-parse --show-toplevel)/scripts/builder/taskRepo.js').repoHome('<repo>'))")" && \
     [ -n "$REPO" ] || { echo "repoHome returned empty — do not build"; exit 1; } && \
     git -C "$REPO" fetch origin --quiet && \
     git -C "$REPO" worktree add "$REPO/.claude/worktrees/<task-slug>" \
       -b <task-slug> origin/main && \
     cd "$REPO/.claude/worktrees/<task-slug>" && \
     if [ -f package.json ]; then npm ci; else echo "no package.json (e.g. vault) — skipping npm ci"; fi
   ```

   The checkout is **derived, never written down**: this skill runs on more
   than one machine, and a literal path is an assumption that fails silently
   on every machine but the one it was typed on (vault `doctrine/NODES.md`,
   principle P1). Start the loop session in the main starcaster checkout, not
   inside an existing worktree — `--show-toplevel` locates this checkout so
   `taskRepo.js` can be required, and `repoHome()` derives the target repo.

   `<task-slug>` = short kebab-case name from the task. Do ALL work for this
   task inside that worktree. A repo other than `starcaster` runs THAT repo's
   gates (see `docs/LOOP_ENGINEERING.md` → "Per-repo gates"), not starcaster's.

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
   - `node scripts/check_ui_doctrine.cjs` if any UI was touched
   - `npm run check:syntax` if `public/js/` or `public/shared/` was touched.
   - `npm run check:screens` if a CRUD screen's layout changed — it drives the
     real app in a browser and checks the width rules in `docs/UI_RULES.md`.
     Needs `npm run dev` and `npm run seed:ui-fixture` first, and is **not** a
     CI gate (CI has no browsers), so nothing else will catch a regression here.

   If a gate fails and you cannot fix it **within the task's scope**, set the
   task to `Needs your input` **and assign Dane (`48012725`)**, add a ClickUp
   comment explaining exactly what failed, and stop. Do not force a broken
   build through, and do not expand scope to chase an unrelated failure. That
   status is the operator's inbox: write the comment for a non-programmer, and
   end it with the specific question or decision you need from him.

5. **Add a plain-English work-log entry.** Prepend one dated entry to
   `docs/WORK-LOG.md` (newest first) describing this task the way you would
   explain it to a non-programmer: what changed and why it mattered, plus the
   `(#PR)` number once known. Keep it to a short paragraph. This entry is part
   of the task's own PR, so the log lands on `main` at the same moment the work
   does — never edit `docs/WORK-LOG.md` directly on `main`. If a parallel task
   causes a merge conflict here, it is trivial (two entries at the top); resolve
   by keeping both.

6. **Commit and open the PR.**
   - Inspect `git diff --cached` before committing (staging is whole-file; make
     sure no stray edits ride along). Never commit generated artifacts.
   - Commit message ends with the Co-Authored-By trailer from CLAUDE.md.
   - Push the branch and open a PR to `main` with `gh`. The PR body must
     include: link to the ClickUp task, a plain-language summary, the task's
     "How to test" steps, and a note that a Vercel preview will be attached.
     End with the Generated-with trailer.

7. **Hand off to review.** Set the task status to `In review`, leave it
   unassigned (it is the machine's turn, not Dane's), and add the PR URL as a
   ClickUp comment. **Do NOT merge** — `main` is PR-protected (the "verify"
   check must go green) and merges happen only on the operator's explicit
   say-so. The `loop-review` skill takes it from here.

8. **Report** which task you built and the PR number, then finish (the `/loop`
   wrapper will re-invoke you for the next task).

## Guardrails

- **One task, one worktree, one PR.** Never build two tasks in one branch.
- **Never touch a task that isn't `Queued`.** Every other status is owned by
  another step or by the operator.
- **Never set `Ready to launch` and never clear `Needs your input`.** Those two
  are the operator's; only he moves a task out of them.
- If the task description is too vague to build safely, set it
  `Needs your input` with a comment asking for a `loop-spec` pass — don't
  guess.
- Leave the worktree in place until the PR merges; `loop-review` may reuse it.
