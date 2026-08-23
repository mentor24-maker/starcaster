---
name: loop-build
description: Pick the next "Queued" task from the Starcaster "Loop Queue" ClickUp list and build it end-to-end into a pull request — in its own git worktree, passing every build gate — then move the task to "In review". Designed to be run on a timer with `/loop 30m loop-build`. Never edits main, never merges.
---

# Loop: Build

This is step 2 of 3 in the Starcaster development loop (spec → build → review).
See `docs/LOOP_ENGINEERING.md` for the whole system.

Each run of this skill builds **one** task into **one** PR. When run under
`/loop`, it repeats, draining the queue one clean PR at a time.

## Before anything else: is this the machine that runs this loop?

Two machines can both reach ClickUp, and claiming a ticket is check-then-act —
a read, a comparison, then a write. There is no way to make that one atomic
step, so it is only sound while exactly ONE machine is claiming. Which machine
that is lives in `lib/nodeRoles.js`, the same table `db:refresh` and the bus
relay read.

**Run this first, before reading the queue or touching anything:**

```bash
npm run node:owns -- loop-build
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
npm run clickup -- queue --list 901418546619 --status Queued   # FIRST LINE is the task to claim
npm run clickup -- status --task <id> --status Building --if-status Queued   # safe claim; exit 3 = someone beat you, take the next
npm run clickup -- status --task <id> --status "In review"                   # hand off (assignees auto-cleared)
npm run clickup -- ask --task <id> --status "Needs your input" --body-file - # escalate: card + status together
npm run clickup -- pr-opened --task <id> --pr <pr-url>                        # record the PR — REQUIRED, and it verifies itself
npm run clickup -- comment --task <id> --body-file -                         # a plain note (progress, notes)
npm run clickup -- describe --task <id> --body-file -                        # REPLACE the description (left column)
```

## The two columns — which one you are writing to

ClickUp shows the description on the **left**, wide, and comments on the
**right**, narrow. Detail goes left. The right column carries the PR URL and the
operator card, nothing else.

Ratified 2026-08-22 after Sync 6/7 and 7/7 both stalled: the loops had been
writing their reasoning as long comments, so it arrived as a wall of text in the
skinniest part of the screen while the roomy left column held a machine-shaped
spec. Dane could not tell what was being asked of him on either ticket.

**Escalating is one command, not two.** `status --status "Needs your input"`
refuses on its own now — a status move with no stated ask is a red badge in his
inbox with no answerable question on it, which is exactly how 7/7 sat there for
a day. Use `ask`, whose body is four sections, checked before anything is sent:

```
@@ASKED     his own words that caused this ticket, verbatim — never invented
@@WHEN      optional — when and where he said it
@@CONTEXT   the problem and the fix in plain English, 50-100 words (enforced)
@@NEEDED    the specific ask; "Nothing right now" is fine, but say it out loud
```

`@@NEEDED` renders under a banner he can spot without reading. If the ticket
genuinely has no instruction behind it, say that in `@@ASKED` and name the
standing decision it descends from.

Use the connector only if the direct script itself is broken, and say so in
the run report.

## Loop note — stamp the queue as you go (queue visibility)

At each transition you perform, stamp the ticket's **Loop note** so the Loop
Queue shows what is happening at a glance (not just the stage). One write per
real transition — never per queued ticket:

```bash
npm run clickup -- loop-note --task <id> --transition claimed        # when you claim it
npm run clickup -- loop-note --task <id> --transition pr-open --pr <n>   # when the PR is open / handed to review
npm run clickup -- loop-note --task <id> --transition escalated       # when you move it to Needs your input
```

If it prints `CANNOT STAMP — custom field "Loop note" not found`, that is not a
failure of your build: the field is a one-time ClickUp setup (see
`docs/LOOP_ENGINEERING.md`). Note it in your run report and carry on.

At the END of the pass, one heartbeat so the list shows the pipeline is alive:

```bash
npm run clickup -- loop-heartbeat --in-line <queued count> --next "<next task name>"
```

## Workflow

1. **Claim the next task.** Find the oldest `Queued` task (highest priority
   first) in the **Loop Queue** list (id `901418546619`). If
   none, report "queue empty" and stop — do not invent work. Claim it with
   `--status Building --if-status Queued`: the guard makes the claim atomic,
   so a parallel build loop that got there first shows up as exit code 3 —
   take the next task instead of proceeding.

   **Then, BEFORE creating a branch, ask whether one already exists:**

   ```bash
   npm run clickup -- build-start --task <id>
   ```

   *   **exit 0** — no PR, or its PR is closed/merged. A fresh branch is right;
       carry on to step 2.
   *   **exit 3** — a PR for this ticket is **still open**. Do NOT start a
       second branch. Check that one out, read the send-back that returned the
       ticket to `Queued`, fix what it named, and push to the SAME PR. The
       command prints the branch.
   *   **exit 1** — it could not tell. **Stop and say so.** Do not start a
       branch on a guess; that is the failure this step exists to prevent,
       arriving through the check meant to catch it.

   The claim in the line above and this check answer DIFFERENT questions, and
   conflating them cost two duplicate PRs on 2026-08-23 (#407 beside the still
   open #349, #408 beside #350). `--if-status Queued` asks *"is anyone else
   starting this right now"* — it was working perfectly. Nothing asked *"was
   this already started and handed back"*, and a sent-back ticket is genuinely
   `Queued` with its PR genuinely still open. Reading the comments would have
   shown it; a pass that must remember to read is a pass that will forget.

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
   MAIN="$(node "$(git rev-parse --show-toplevel)/scripts/lib/main_checkout.mjs")" && \
     [ -n "$MAIN" ] || { echo "main checkout came back empty — do not build"; exit 1; } && \
     REPO="$(node -e "console.log(require('$MAIN/scripts/builder/taskRepo.js').repoHome('<repo>'))")" && \
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
   principle P1).

   **It no longer matters where the loop session starts.** `--show-toplevel`
   answers *"the folder I am in"*, and using it for the ANSWER meant a loop
   started inside a worktree — which is what `docs/LOOP_ENGINEERING.md` used to
   tell you to do — put its per-task worktrees **inside another worktree**.
   Nothing errored; the work just happened somewhere nobody expected.
   `main_checkout.mjs` asks git for `--git-common-dir`, which points at the
   MAIN checkout's `.git` from inside a linked worktree, so the answer is the
   same from anywhere. `--show-toplevel` survives here only to locate that
   file, which every worktree carries, and is correct for that.

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

5. **Photograph the change if it altered a rendering.** Charter Q5: a visual
   change reaches Dane as before/after pictures on the ticket, so the decision
   he is asked for is "does this look right" rather than "check out this branch".

   ```
   PORT=3058 node server.js
   UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:shots -- --task <task-id>
   ```

   Run it on EVERY task, not only the ones you think are visual — deciding
   that yourself is the failure it exists to prevent. It costs about ten
   seconds when nothing under `components/`, `lib/builder-client/`, `src/css/`,
   `public/images/` or `builder-preview.html` changed: it says so and stops
   without opening a browser. When renders are identical it also files nothing,
   so a non-visual PR never interrupts him.

   `docs/VISUAL_REVIEW.md` covers the rest — in particular, that a green run
   proves something changed, never that it changed correctly.

   If a gate fails and you cannot fix it **within the task's scope**, escalate
   with `ask` (which posts the card and assigns Dane in one move) and stop. Do
   not force a broken build through, and do not expand scope to chase an
   unrelated failure. Put the full diagnosis in the **description** with
   `describe` — the failing command, its output, what you tried — and keep
   `@@CONTEXT` to the 50-100 words a non-programmer needs to decide. End
   `@@NEEDED` with the specific question, and where you can, give him named
   options to pick between rather than an open question.

6. **Add a plain-English work-log entry.** Prepend one dated entry to
   `docs/WORK-LOG.md` (newest first) describing this task the way you would
   explain it to a non-programmer: what changed and why it mattered, plus the
   `(#PR)` number once known. Keep it to a short paragraph. This entry is part
   of the task's own PR, so the log lands on `main` at the same moment the work
   does — never edit `docs/WORK-LOG.md` directly on `main`. If a parallel task
   causes a merge conflict here, it is trivial (two entries at the top); resolve
   by keeping both.

7. **Commit and open the PR.**
   - Inspect `git diff --cached` before committing (staging is whole-file; make
     sure no stray edits ride along). Never commit generated artifacts.
   - Commit message ends with the Co-Authored-By trailer from CLAUDE.md.
   - Push the branch and open a PR to `main` with `gh`. The PR body must
     include: **the ClickUp task URL** (`https://app.clickup.com/t/<id>`, on a
     line of its own — this is not optional), a plain-language summary, the
     task's "How to test" steps, and a note that a Vercel preview will be
     attached. End with the Generated-with trailer.

8. **Record the PR on the ticket — with the command, and check what it says.**

   ```bash
   npm run clickup -- pr-opened --task <id> --pr <pr-url>
   ```

   This is not the same as `comment`. It refuses first if the PR body has no
   link back to the ticket, then posts the one line the merge step can read
   (`PR opened: <url>`) and **parses it back with that step's own reader**.

   **A non-zero exit here fails the run.** Do not carry on to step 9, and do
   not hand the ticket to review — a ticket with no readable PR trail is a
   ticket the merge step will later refuse, which strands the operator's
   approval with nobody noticing. Exit 4 means the PR body is missing the
   ClickUp link: add the line, run the command again.

   Why it is a command and not an instruction: on 2026-08-22 four approved
   tickets had no `PR opened:` comment at all and two of their PRs carried no
   ClickUp link either, so ticket and PR could only be paired by reading
   titles. The step had been written down the whole time.

9. **Hand off to review.** Set the task status to `In review` and leave it
   unassigned (it is the machine's turn, not Dane's). **Do NOT merge** —
   `main` is PR-protected (the "verify" check must go green) and merges happen
   only on the operator's explicit say-so. The `loop-review` skill takes it
   from here.

10. **Report** which task you built and the PR number, then finish (the `/loop`
   wrapper will re-invoke you for the next task).

## Guardrails

- **One task, one worktree, one PR.** Never build two tasks in one branch.
- **The PR and the ticket must name each other.** `pr-opened` enforces both
  directions and verifies its own write; if it exits non-zero the run has
  failed, whatever else went right.
- **Never touch a task that isn't `Queued`.** Every other status is owned by
  another step or by the operator.
- **Never set `Ready to launch` and never clear `Needs your input`.** Those two
  are the operator's; only he moves a task out of them — in person, or through
  the bus-relay pass acting on a comment he wrote (an answer releases
  `Needs your input`; the single word `merge` releases `Ready to launch` by
  merging it). A build loop never sets either one and never merges.
- If the task description is too vague to build safely, `ask` for a `loop-spec`
  pass — don't guess. Name in `@@NEEDED` the specific thing that is missing.
- **If a task is bigger or riskier than one unattended pass should build**, say
  so with `ask` *before* building, and offer him named slices to pick from,
  smallest-and-safest first. Then **build only the slice he names** — narrow the
  description with `describe` to match his answer before you start. A ticket
  handed back to `Queued` still carrying its original wide scope is how the
  risky half gets built by accident (Sync 6/7, 2026-08-22).
- Leave the worktree in place until the PR merges; `loop-review` may reuse it.
