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

## Then: has the operator taken the deck?

There is a sanctioned way for Dane to clear the decks and run something
through fast, and it is a switch rather than an improvisation. While it is on,
the machines stop taking new work so nothing lands under him while he is
working.

```bash
npm run pipeline -- check
```

*   **exit 0** — the pipeline is running. Carry on.
*   **exit 3** — **paused.** Claim nothing, review nothing, merge nothing,
    and write NOTHING to ClickUp — no status, no comment, no Loop note. Report
    the line it printed and finish the pass **successfully**. This is a normal
    outcome, the same shape as another machine owning the job.

It **fails safe**: if the switch cannot be read at all, it says so and still
exits 3. That is deliberate. Running while the operator has the deck collides
with whatever he is doing there; pausing when he does not costs idle machines
and one loud message. Those are not symmetric, so the tie goes to stopping.

**Never resume it.** An agent may pause the line — that is a safety move
anyone should be able to make — but only Dane hands the deck back
(`npm run pipeline -- resume --operator-asked`). `npm run pipeline -- status` says
whether it is on, since when, who put it there and why.

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
npm run clickup -- loop-note --task <id> --transition review-started           # CLAIM THE REVIEW — do this before you verify
npm run clickup -- verdict --task <id> --pass --if-status "In review" --body-file -   # RECORD THE VERDICT FIRST — the gate reads this
npm run clickup -- verdict --task <id> --fail --if-status "In review" --body-file -   # ... or the send-back, same shape
npm run clickup -- send-back-rounds --task <id>                     # how many rounds already? exit 3 = escalate, do not send back
npm run clickup -- ask --task <id> --status "Ready to launch" --body-file -   # pass: card + status together
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -  # a judgment call only he can settle
npm run clickup -- status --task <id> --status Queued --if-status "In review" # send back (assignees auto-cleared)
npm run clickup -- comment --task <id> --body-file -                # a plain note
npm run clickup -- waiting [--task <id>]                            # read-only: is this ACTUALLY waiting on Dane? run it before saying so
npm run clickup -- describe --task <id> --body-file -               # REPLACE the description (left column)
npm run clickup -- chat --channel 2kydhxeu-474 --body-file -        # post to the bus
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

## The two columns — which one you are writing to

Detail goes **left** (the description). The **right** column carries only the
operator card. Ratified 2026-08-22, after Sync 6/7 and 7/7 both stalled because
the loops' reasoning arrived as walls of text in ClickUp's narrow right column.

Handing a ticket to Dane is one command, not two: `status` refuses to set
`Ready to launch` or `Needs your input` on its own and points at `ask`. The card
body is four sections plus a fifth that costly asks must carry, all checked
before anything is sent:

```
@@ASKED     his own words that caused this ticket, verbatim — never invented
@@WHEN      optional — when and where he said it
@@CONTEXT   the problem and the fix in plain English, 50-100 words (enforced)
@@NEEDED    the specific ask, under a banner he can spot without reading
@@EVIDENCE  required ONLY when the ask costs money or cannot be undone: the
            command, its real output in a fence, and a "@@MEASURED 8:04pm"
            line saying when you ran it — that line is the only thing that
            dates the card; every other clock in the section is ignored
```

### A `Ready to launch` card must carry a link he can click

If the work has **any visible surface**, the card names a URL he can open and
says what he should see there. One of these, in order of preference:

1. **The Vercel preview URL** for the PR — every PR gets one, it is already
   built, and it is the real thing rather than a description of it. Name the
   exact page: not the site root, the page the change is on.
2. **A published Artifact page** — for work with no page of its own (a
   generated diagram, a report, a before/after pair).
3. **The exact localhost URL with the command that starts the server**, both
   copy-pasteable, when neither of the above can exist.

Then two or three lines of **what to look for**, in his words, not the
ticket's: *"the chip on each block header should say Following, Changed or
Independent"* — not *"verify the lineage state renders"*.

**No link, on work with a visible surface, is a review FAILURE.** Not a
footnote, not an apology in the run report — send it back. Dane said it
outright on task 86bbh7qer:

> This should include a clickable link I can click to test... none of the "How to test" options are clear how I actually do it.

A card that hands him a branch name and a build command has moved the work to
his desk at the exact moment the loop was supposed to have finished it.

Work with genuinely no visible surface — a guard, a script, a docs change —
says so in one line (*"nothing to look at; this is a check that runs at commit
time"*) rather than leaving him to wonder whether a link was forgotten.

Use the connector only if the direct script itself is broken, and say so in
the run report.

## Loop note — your claim, then your verdict (queue visibility)

The **Loop note** is the only place a review IN FLIGHT is visible. `queue` and
`get` both print it, so one command answers "is somebody already on this?":

```bash
npm run clickup -- loop-note --task <id> --transition review-started  # CLAIM — before you verify anything
npm run clickup -- loop-note --task <id> --transition verified    # PASS -> Ready to launch
npm run clickup -- loop-note --task <id> --transition sent-back   # FAIL -> back to Queued
```

The send-back note carries its **round** and reason — `↩ round 3 — three docs
now contradict the change (12:28pm)` — and reads both off the ticket's own
verdict comments, so run it **after** `verdict --fail`, not before. Nothing to
pass by hand.

`CANNOT STAMP` means the one-time "Loop note" field is not set up yet (see
`docs/LOOP_ENGINEERING.md`) — note it and carry on; it never blocks a verdict.

## Workflow

1. **Claim the next task — visibly, before you verify anything.** Find the
   oldest task with status `In review` in the **Loop Queue** list (id
   `901418546619`) — the queue command's first line. If none, report "nothing
   to review" and stop. Read the task (`get`), then read its comments
   (`comments`) to find the PR URL the build loop posted there.

   **Read the Loop note column before you take one.** A ticket reading
   `🔍 being checked — a review pass started 8/23 3:41am` already has a review
   running on it: skip it, take the next one. There is no "reviewing" status to
   move a ticket into — the note IS the claim, and it is printed by both
   `queue` and `get`, so seeing it costs nothing extra.

   Then claim the one you took, before you check anything out:

   ```bash
   npm run clickup -- loop-note --task <id> --transition review-started
   ```

   A claim more than about **45 minutes** old is an abandoned pass, not a
   running one — a review is minutes, not hours. Taking one over is allowed and
   ordinary: re-stamp it with your own claim so the next pass sees a fresh time,
   and say in your run report that you did it and how old the claim was. (The
   claim carries the date as well as the clock precisely so you can tell today's
   from yesterday's.)

   Why any of this: on 2026-08-22 two review passes verified PR #362 end to end
   at the same time — neither could see the other — and the second one then
   overwrote the first one's verdict. See step 4 for the other half of the fix.

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
   npm run clickup -- verdict --task <id> --pass --if-status "In review" --body-file -   # or --fail
   ```

   **`--if-status` is required, and it is the guard that matters.** A review
   takes many minutes, so by the time you decide, the queue snapshot you started
   from is old news. If the ticket has moved — another pass took it, the
   operator answered something, a rebuild claimed it — the command writes
   **nothing** and exits 3. When that happens: **re-read and stand down.** Read
   the comments (`comments --task <id>`) and the ticket (`get --task <id>`) to
   see what actually happened, do not write the verdict, do not move the status,
   report what you found, and take the next task. Your verdict was about a state
   that no longer exists; writing it anyway is precisely the 2026-08-22 failure.

   The same guard belongs on every status write that follows a review, so the
   send-back in this step carries `--if-status "In review"` too. The pass path
   needs no separate guard: `ask --status "Ready to launch"` refuses unless the
   newest verdict on the ticket is a PASS, so a refused verdict already blocks
   the status move behind it.

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
   - **Fail, and a machine can fix it** → `verdict --fail` first, then set the
     task back to `Queued` (`status --status Queued --if-status "In review"`),
     **clear its assignees**, and add a ClickUp comment listing precisely what
     to fix and why. The `loop-build` skill will pick it up again. Do not fix
     it yourself inside the review step — keep build and review separate so the
     check stays honest.

     `--body-file` is **required** on a send-back and its FIRST LINE is the
     reason the board will show, so write that line as one short clause a
     non-programmer can read at a glance ("three docs now contradict the
     change"), then the detail below it.

     **`verdict --fail` refuses on what would be the fourth send-back** (exit
     3, nothing written) and prints what each previous round found. That is not
     an error to work around: three rounds means the **spec** is wrong, not the
     build, and the next move is Dane's. Escalate instead — `ask --status
     "Needs your input"` with all three rounds named one line each in
     `@@CONTEXT` (or in the description if it runs long), and `@@NEEDED`
     offering him named options — respec, split, or drop — rather than an open
     question. Then `loop-note --transition escalated`. The reasoning is in
     `docs/LOOP_ENGINEERING.md` → "A send-back says which round it is".
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
  ticket, which the bus-relay pass carries out for him within about ten
  minutes (task 86bbjd5nn). Either way the authorization is his and this loop never
  supplies it. This is the human checkpoint that keeps a bad change off the
  auto-deploying `main`.
  One consequence for the pass message: the "Reply/tell me to merge when
  you're ready" line is now literal — replying the single word `merge` on the
  ticket is enough, and is the route that works when no session is open.
- **Only the operator moves a task out of `Ready to launch` or
  `Needs your input`.** Putting a task into one of those two is handing it to
  him; taking it back out is his call, not a loop's.
- **Independence is the whole point.** Re-run everything; don't rubber-stamp.
- **Claim before you verify, and never write a verdict past a refused guard.**
  Two passes reviewing one ticket is wasted work; two passes *writing verdicts*
  on one ticket is a wrong answer reaching the operator. If `--if-status`
  refuses, that is the system working — re-read, stand down, move on.
- **Never force a fourth send-back through.** `--fourth-round-anyway` exists
  for the case where Dane has already settled the ticket and another round is
  genuinely right; it is a written claim, not a way past a refusal you did not
  want. A ticket going round a fourth time is the loop failing to notice it is
  stuck.
- If the PR has merge conflicts with main, send it back to `Queued` with a note
  to rebase — don't resolve conflicts blind.
- Keep review comments plain-language and specific enough that the next build
  pass can act on them without re-reading the code.
