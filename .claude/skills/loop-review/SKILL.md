---
name: loop-review
description: Pick the next "In review" task from the Starcaster "Loop Queue" ClickUp list, independently verify its pull request (build gates + code review + a real test pass), then either mark it "Ready to launch" and ping the operator to merge, or send it back to "Queued" with notes. Designed to be run on a timer with `/loop 30m loop-review`. Never merges on its own.
---

# Loop: Review

This is step 3 of 3 in the Starcaster development loop (spec → build → review).
See `docs/LOOP_ENGINEERING.md` for the whole system.

Each run verifies **one** task's PR. Run under `/loop` it keeps the review queue
drained so the operator only ever sees PRs that already passed an independent
check.

## ClickUp access: use the direct script, not the connector

Every ClickUp touch in this loop goes through `scripts/clickup_direct.mjs`
run under Doppler (which supplies the token; you never see or handle it):

```bash
CU() { doppler run --project starcaster --config dev -- node scripts/clickup_direct.mjs "$@"; }
CU queue --list 901418546619 --status "In review"   # what needs reviewing
CU get --task <id>                                  # the task, header + body
CU status --task <id> --status "Ready to launch" --assign 48012725
CU status --task <id> --status Queued --clear-assignees
CU comment --task <id> --body-file -                # body on stdin
CU chat --channel 2kydhxeu-474 --body-file -        # post to the bus
```

The claude.ai ClickUp connector is a shared rolling budget that all sessions
drain together; when it is spent, it fails with junk wait times. ClickUp's own
API allows 100 requests/minute, which this loop cannot exhaust. Use the
connector only if the direct script itself is broken, and say so in the run
report. **Id trap:** `90146476303` is the Starcaster *space*; the Loop Queue
*list* is `901418546619`.

## Workflow

1. **Claim the next task.** Find the oldest task with status `In review` in the
   **Loop Queue** list (id `901418546619`). If none, report
   "nothing to review" and stop. Read the task and find its PR URL from the
   comments.

   The list's six statuses, in order, are `Queued → Building → In review →
   Needs your input / Ready to launch → Live`. Match them case-insensitively.

   **Assignment is the handoff signal.** Dane finds his work through ClickUp's
   own *Assigned to me*, not a hand-built filter — a filtered view cannot span
   the Starcaster and Dane of Earth spaces, but assignment does. In the same
   `CU status` call that sets the status:

   - `Ready to launch` or `Needs your input` → **assign Dane** (user id
     `48012725`).
   - `Queued` (sending it back to the build loop) → **clear all assignees**.

2. **Check out the PR in a worktree.** Reuse the build worktree if present, or
   add one from the PR branch. Run `npm ci` if dependencies changed.

3. **Verify independently — do not trust the build loop's word.**
   - Re-run the gates: `npm run typecheck`, the affected tests
     (`test:builder-ui` / `test:builder`), `node scripts/check_conventions.cjs`,
     and `npm run check:syntax` if `public/js/` was touched.
   - Run `/code-review` on the branch diff for correctness/quality issues.
   - **Actually exercise it.** Use the `run` skill (or Playwright) to open the
     affected page/module and walk the task's "How to test" steps. A green
     test suite is not proof the feature works — confirm the real behavior.
   - Sanity-check against the task: are all acceptance criteria met? Any
     Non-goals violated? Any generated artifact left un-rebuilt?

4. **Decide.**
   - **Pass** → set the task to `Ready to launch` **and assign Dane**. Post to
     the operator (the ClickUp bus channel and/or a push notification) a
     compact message: task name, PR link, Vercel preview link, the "How to
     test" steps, and the line **"Reply/tell me to merge when you're ready."**
     Do **NOT** merge — per standing rule, CC merges only on the operator's
     explicit command, and only with all checks green.
   - **Fail, and a machine can fix it** → set the task back to `Queued`,
     **clear its assignees**, and add a ClickUp comment listing precisely what
     to fix and why. The `loop-build` skill will pick it up again. Do not fix
     it yourself inside the review step — keep build and review separate so the
     check stays honest.
   - **Fail, and only a human can settle it** (the task is ambiguous, the
     acceptance criteria contradict what the code should do, or the fix is a
     product decision) → set it to `Needs your input`, **assign Dane**, and
     write the comment as a plain-language question for the operator. Do not
     bounce a judgment call around the loop; that is what this status exists
     for.

5. **Report** the task and your verdict, then finish (the `/loop` wrapper
   re-invokes you for the next one).

## Guardrails

- **Never merge autonomously.** `Ready to launch` ≠ merged. The operator
  merges (via CC on explicit command). This is the human checkpoint that keeps
  a bad change off the auto-deploying `main`.
- **Only the operator moves a task out of `Ready to launch` or
  `Needs your input`.** Putting a task into one of those two is handing it to
  him; taking it back out is his call, not a loop's.
- **Independence is the whole point.** Re-run everything; don't rubber-stamp.
- If the PR has merge conflicts with main, send it back to `Queued` with a note
  to rebase — don't resolve conflicts blind.
- Keep review comments plain-language and specific enough that the next build
  pass can act on them without re-reading the code.
