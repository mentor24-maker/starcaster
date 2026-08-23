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

## Before anything else: is this the machine that runs this loop?

Two machines can both reach ClickUp, and claiming a ticket is check-then-act —
a read, a comparison, then a write. There is no way to make that one atomic
step, so it is only sound while exactly ONE machine is claiming. Which machine
that is lives in `lib/nodeRoles.js`, the same table `db:refresh` and the bus
relay read.

**Run this first, before reading the queue or touching anything:**

```bash
npm run node:owns -- loop-review
```

*   **exit 0** — this machine owns the loop. Carry on.
*   **exit 3** — another machine owns it. **Stop.** Claim nothing, build
    nothing. Report the message it printed, which names the owning machine,
    and finish the run. This is a normal outcome, not a failure.
*   **exit 1** — it could not tell which machine this is. **Stop and say so
    loudly.** Do not treat it as "not mine": "someone else is doing it" and
    "nobody is doing it" look identical from here, and only one of them is
    safe. The message says exactly what to type to fix it (one line, once per
    machine). `npm run node:whoami` shows the whole picture.

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
npm run clickup -- verdict --task <id> --pass --body-file -                   # RECORD THE VERDICT FIRST — the gate reads this
npm run clickup -- verdict --task <id> --fail --body-file -                   # ... or the send-back, same shape
npm run clickup -- ask --task <id> --status "Ready to launch" --body-file -   # pass: card + status together
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -  # a judgment call only he can settle
npm run clickup -- status --task <id> --status Queued               # send back (assignees auto-cleared)
npm run clickup -- comment --task <id> --body-file -                # a plain note
npm run clickup -- describe --task <id> --body-file -               # REPLACE the description (left column)
npm run clickup -- chat --channel 2kydhxeu-474 --body-file -        # post to the bus
```

## The two columns — which one you are writing to

Detail goes **left** (the description). The **right** column carries only the
operator card. Ratified 2026-08-22, after Sync 6/7 and 7/7 both stalled because
the loops' reasoning arrived as walls of text in ClickUp's narrow right column.

Handing a ticket to Dane is one command, not two: `status` refuses to set
`Ready to launch` or `Needs your input` on its own and points at `ask`. The card
body is four sections, checked before anything is sent:

```
@@ASKED     his own words that caused this ticket, verbatim — never invented
@@WHEN      optional — when and where he said it
@@CONTEXT   the problem and the fix in plain English, 50-100 words (enforced)
@@NEEDED    the specific ask, under a banner he can spot without reading
```

Use the connector only if the direct script itself is broken, and say so in
the run report.

## Loop note — stamp your verdict (queue visibility)

When you decide, stamp the ticket's **Loop note** so the queue shows it:

```bash
npm run clickup -- loop-note --task <id> --transition verified    # PASS -> Ready to launch
npm run clickup -- loop-note --task <id> --transition sent-back   # FAIL -> back to Queued
```

`CANNOT STAMP` means the one-time "Loop note" field is not set up yet (see
`docs/LOOP_ENGINEERING.md`) — note it and carry on; it never blocks a verdict.

## Workflow

1. **Claim the next task.** Find the oldest task with status `In review` in the
   **Loop Queue** list (id `901418546619`) — the queue command's first line.
   If none, report "nothing to review" and stop. Read the task
   (`get`), then read its comments (`comments`) to find the PR URL the build
   loop posted there.

   The list's six statuses, in order, are `Queued → Building → In review →
   Needs your input / Ready to launch → Live`. Match them case-insensitively.

   **Assignment is the handoff signal.** Dane finds his work through ClickUp's
   own *Assigned to me*, not a hand-built filter — a filtered view cannot span
   the Starcaster and Dane of Earth spaces, but assignment does.
   `npm run clickup -- status` enforces the mapping automatically and
   verifies it stuck: `Ready to launch` / `Needs your input` assign Dane,
   `Queued` clears assignees. Flags exist only to deviate.

2. **Check out the PR in a worktree — in the task's repo.** A task declares
   its repo with a `repo:<name>` tag (`starcaster` default; also `normie`,
   `pulse`, `vault`); `npm run clickup -- get --task <id>` prints the resolved
   `repo:` line. Verify in THAT repo's checkout and run THAT repo's gates
   (`docs/LOOP_ENGINEERING.md` → "Per-repo gates") — verifying a vault task
   against starcaster's gates proves nothing. An unknown/ambiguous repo tag is
   the build loop's to escalate, not review's; if you meet one In review,
   send it back to `Queued` with a note. Reuse the build worktree if present,
   or add one from the PR branch. Run `npm ci` if dependencies changed.

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

4. **Decide — and record the verdict BEFORE you move anything.**

   ```bash
   npm run clickup -- verdict --task <id> --pass --body-file -   # or --fail
   ```

   `Ready to launch` is the operator's "safe to merge" signal, and since task
   86bbjt18r `ask` and `status` both **refuse** to set it unless the newest
   verdict on the ticket is a PASS. That is not paperwork: on 2026-08-22 two
   tickets reached that status with no passing review recorded on them at all,
   and he approved both in good faith. The command writes the one shape the
   gate and the merge step both read, and verifies it through the gate itself.

   `--body-file -` takes your one-line reason on stdin — what you ran, what you
   walked through, what convinced you. Then:

   - **Pass** → `ask --status "Ready to launch"`. `@@ASKED` carries the
     instruction the ticket came from; `@@CONTEXT` says in 50-100 words what
     changed and what he will see; `@@NEEDED` is the merge approval, with the
     PR link, the Vercel preview link, the exact address and clicks to check it,
     and the line **"Tell me to merge when you're ready."** Put the full "How to
     test" walkthrough in the description with `describe` if it runs long.
     Also post the compact version to the bus channel.
     Do **NOT** merge — per standing rule, CC merges only on the operator's
     explicit command, and only with all checks green.
   - **Fail, and a machine can fix it** → `verdict --fail` first, then set the task back to `Queued`,
     **clear its assignees**, and add a ClickUp comment listing precisely what
     to fix and why. The `loop-build` skill will pick it up again. Do not fix
     it yourself inside the review step — keep build and review separate so the
     check stays honest.
   - **Fail, and only a human can settle it** (the task is ambiguous, the
     acceptance criteria contradict what the code should do, or the fix is a
     product decision) → `ask --status "Needs your input"`. Put the evidence in
     the description with `describe`; keep `@@CONTEXT` to the 50-100 words he
     needs to decide, and give `@@NEEDED` named options to choose between
     rather than an open question. Do not bounce a judgment call around the
     loop; that is what this status exists for.

5. **Report** the task and your verdict, then finish (the `/loop` wrapper
   re-invokes you for the next one).

## Guardrails

- **Never merge autonomously.** `Ready to launch` ≠ merged. The operator
  merges — either by telling a CC session to, or by replying `merge` on the
  ticket, which the hourly bus-relay pass carries out for him (task
  86bbjd5nn). Either way the authorization is his and this loop never
  supplies it. This is the human checkpoint that keeps a bad change off the
  auto-deploying `main`.
  One consequence for the pass message: the "Reply/tell me to merge when
  you're ready" line is now literal — replying the single word `merge` on the
  ticket is enough, and is the route that works when no session is open.
- **Only the operator moves a task out of `Ready to launch` or
  `Needs your input`.** Putting a task into one of those two is handing it to
  him; taking it back out is his call, not a loop's.
- **Independence is the whole point.** Re-run everything; don't rubber-stamp.
- If the PR has merge conflicts with main, send it back to `Queued` with a note
  to rebase — don't resolve conflicts blind.
- Keep review comments plain-language and specific enough that the next build
  pass can act on them without re-reading the code.
