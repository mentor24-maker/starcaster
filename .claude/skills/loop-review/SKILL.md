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

Every ClickUp touch goes through **`npm run clickup -- <command>`** — a full
standalone command each time (shell functions do not survive between tool
calls). Doppler supplies the token; you never see or handle it. The command
list, the ids, and the reasoning live in ONE place: `docs/LOOP_ENGINEERING.md`
§"ClickUp access". The moves this loop makes:

```bash
npm run clickup -- queue --list 901418546619 --status "In review"   # FIRST LINE is the one to review
npm run clickup -- get --task <id>                                  # the task, header + body
npm run clickup -- comments --task <id>                             # the comments — the PR URL lives here
npm run clickup -- status --task <id> --status "Ready to launch" --if-status "In review"  # pass (guarded; Dane auto-assigned)
npm run clickup -- status --task <id> --status Queued --if-status "In review"             # send back (guarded; assignees cleared)
npm run clickup -- comment --task <id> --body-file -                # body on stdin
npm run clickup -- chat --channel 2kydhxeu-474 --body-file -        # post to the bus
```

Use the connector only if the direct script itself is broken, and say so in
the run report.

## Workflow

1. **Claim the next task — visibly, before verifying.** Find the oldest task
   with status `In review` in the **Loop Queue** list (id `901418546619`) — the
   queue command's first line. If none, report "nothing to review" and stop.
   Read the task (`get`) and its comments (`comments`).

   **Then claim it so a second reviewer sees it.** There is no separate
   "reviewing" status (work within the six), so the claim is a comment:

   ```bash
   npm run clickup -- comment --task <id> --body-file -   # body: "REVIEW CLAIM: <node/session> at <UTC time>"
   ```

   Before claiming, check the comments you just read: if another session
   posted a `REVIEW CLAIM` within the last ~30 minutes and there is no verdict
   after it, **stand down and take the next task** — a review is already
   running (two sessions verified PR #362 in parallel on 2026-08-22, and the
   slower one wrote its verdict over the faster one's). The PR URL the build
   loop posted is in these same comments.

   The list's six statuses, in order, are `Queued → Building → In review →
   Needs your input / Ready to launch → Live`. Match them case-insensitively.

   **Assignment is the handoff signal.** Dane finds his work through ClickUp's
   own *Assigned to me*, not a hand-built filter — a filtered view cannot span
   the Starcaster and Dane of Earth spaces, but assignment does.
   `npm run clickup -- status` enforces the mapping automatically and
   verifies it stuck: `Ready to launch` / `Needs your input` assign Dane,
   `Queued` clears assignees. Flags exist only to deviate.

2. **Check out the PR in a worktree.** Reuse the build worktree if present, or
   add one from the PR branch. Run `npm ci` if dependencies changed.

3. **Verify independently — do not trust the build loop's word.**
   - **Check the PR's own CI FIRST:** `gh pr checks <n>` — a **red** `verify`
     is an automatic send-back, no further review needed (PR #344 sat CI-red
     through three passes because everyone checked local green, not GitHub).
     "Gates green" always includes GitHub's checks, not just a local run.
   - Re-run the gates: `npm run typecheck`, the affected tests
     (`test:builder-ui` / `test:builder`), `node scripts/check_conventions.cjs`,
     and `npm run check:syntax` if `public/js/` was touched.
   - Run `/code-review` on the branch diff for correctness/quality issues.
   - **Actually exercise it.** Use the `run` skill (or Playwright) to open the
     affected page/module and walk the task's "How to test" steps. A green
     test suite is not proof the feature works — confirm the real behavior.
   - Sanity-check against the task: are all acceptance criteria met? Any
     Non-goals violated? Any generated artifact left un-rebuilt?

4. **Decide — and write the verdict RACE-SAFELY.** Every status write below
   carries `--if-status "In review"`: your queue snapshot may be many minutes
   stale by verdict time, and the guard refuses to write if the ticket has
   moved since you claimed it (a fresh build claim, another reviewer). If the
   status command reports it did NOT claim (exit 3), do **not** retry — re-read
   the comments to see what happened and stand down; your verdict is out of
   date. (This is the 2026-08-22 incident: a stale "Ready to launch" landed on
   top of a fail verdict and a new Building claim.)
   - **Pass** → `--status "Ready to launch" --if-status "In review"` **(assigns Dane)**. Post to
     the operator (the ClickUp bus channel and/or a push notification) a
     compact message: task name, PR link, Vercel preview link, the "How to
     test" steps, and the line **"Reply/tell me to merge when you're ready."**
     Do **NOT** merge — per standing rule, CC merges only on the operator's
     explicit command, and only with all checks green.
   - **Fail, and a machine can fix it** → `--status Queued --if-status "In review"`
     (**clears assignees**), and add a ClickUp comment listing precisely what
     to fix and why. The `loop-build` skill will pick it up again. Do not fix
     it yourself inside the review step — keep build and review separate so the
     check stays honest.
   - **Fail, and only a human can settle it** (the task is ambiguous, the
     acceptance criteria contradict what the code should do, or the fix is a
     product decision) → `--status "Needs your input" --if-status "In review"`
     (**assigns Dane**), and
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
