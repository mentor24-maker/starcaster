# Starcaster — repo invariants

Read this file plus the `CLAUDE.md` nearest the files you are editing
(`components/`, `src/css/`, `routes/`, `public/js/`, `lib/builder-client/`).
Architecture, known issues, and roadmap: `docs/FABLE_OVERHAUL_PLAN.md`.
**Hard-won rules, each with the incident that produced it: `docs/DOCTRINE.md`.**
Read it before diagnosing a "it worked yesterday" failure, writing an error
message, or adding a check that could silently not run.

## IMPORTANT: Coach the operator

The operator (Dane) directs this project but is not a career programmer —
his background is hands-on HTML/LAMP-era building, and modern dev jargon
does not land. Every agent working here must:

- **Use plain language.** Explain any technical term the first time it
  matters ("a branch is a separate copy of the code you can work on
  without touching the live site"). Never bury a decision in jargon.
- **Coach in the moment, kindly.** When he is about to do something risky
  (working directly on the live `main` branch, pushing without a passing
  build, running two tasks in the same folder), say so plainly, explain
  the risk in one sentence, and offer the safer step as a ready-to-run
  command with a one-line note on what it does.
- **Prompt, don't assume.** He has asked to be trained in best practices
  as work proceeds. Treat that coaching as part of every task's
  deliverable — not an interruption or an afterthought.
- **Do the housekeeping silently.** Merged worktrees, stale branches,
  asset-stamp conflicts, missing generated artifacts, scratch files: clean
  them up as you go, without asking and without a section explaining it.
  He has given blanket authorization (`docs/DOCTRINE.md` §6.4). The one
  thing that earns an interruption is **him** actively causing a problem —
  then say so immediately and completely. Everything else is a chore, and
  chores are silent.

- **CC runs the operational commands.** Scripts, `doppler run`, SSH to the
  Mini, publishing: the agent session runs them and reports the outcome in
  plain English. Handing him a command to paste is itself a claim that CC
  cannot run it, and he reads it that way every time. There are four
  exceptions — a real secret VALUE (`docs/DOCTRINE.md` §4.1), a billing
  screen, a browser login, and a decision that is genuinely his — and a
  hand-off **names which one applies**. A gate or permission refusal is not
  one of them: it refused one call, not the session, so retry it when the
  step actually comes and say so in one line if it is refused again. And
  never leave a production fix as a two-step for him — if a script has a dry
  run and an `--apply`, run both and report what changed. He has raised this
  three times (2026-08-07, 08-23, 08-30); the incident is
  `docs/DOCTRINE.md` §6.9.

- **A person is a human being. An agent is not.** `person` and `human` mean
  Dane, or another actual human. An agent session is an **agent session** —
  never a person, a human, somebody, or anyone. He has raised this at least
  three times and it is not a style note: it is the answer to *whose hands
  does this need, and are they mine?* Saying an automation "asked a person"
  when it posted a request for an agent session told him he was the blocker
  when he was not, and hid the fact that nothing was listening — four days
  on ticket 86bbmfc15. The rule and its guardrail (a hand-off names the
  actor; passive voice implying an unnamed one is itself the defect) are
  `docs/DOCTRINE.md` §2.5, ratified in vault `doctrine/TERMINOLOGY.md`.
  Do not over-correct: most existing uses mean a human and are right.

StarCaster (company: Alphire) is a multi-tenant platform: an admin SPA plus a
visual site Builder whose published pages serve as tenant public sites on
custom domains. Backend is Node with a shared dispatcher `routes/index.js`
(`server.js` locally, `api/[...slug].js` on Vercel). Database is Supabase
Postgres. Admin UI is split between a frozen vanilla-JS app (`public/js/`)
and the React/TypeScript builder (`components/` + `lib/builder-client/`).

## Generated files — never hand-edit, never commit

These are **gitignored build artifacts**. Edit the source, run the rebuild
command so your local app reflects the change — but do NOT commit them;
Vercel and CI regenerate everything from source via `npm run build`.
A PreToolUse hook blocks direct edits; the conventions checker blocks
commits of them. After a fresh clone, run `npm run build` once to create
them locally.

| Artifact | Source | Rebuild |
|---|---|---|
| `public/app-shell.html` | `src/layout.html` + `src/pages/**` | `npm run build:html` |
| `public/about.html`, `site.html`, `explore.html`, `builder-preview.html` | `src/static-pages/*` | `npm run build:html` |
| `public/privacy-policy.html`, `terms-of-service.html`, `data-deletion.html` | `src/legal/*` | `npm run build:html` |
| `public/styles.css` | `src/css/main.css` + partials | `npm run build:css` |
| `public/builder-bundle.js` | `builder-react-entry.tsx`, `components/**`, `lib/builder-client/**` | `npm run build:builder` |
| `public/bundle.js` | `react-entry.js` + campaigns components | `npx esbuild react-entry.js --bundle --outfile=public/bundle.js --loader:.js=jsx` |
| `public/js/richtext-vendor.js` | `public/js/richtext-vendor-entry.js` | `npm run build:richtext` |
| `lib/builder/template.js`, `lib/builder/email-template.js`, `lib/builder/template-frame.js` | `lib/builder-client/builder-template.ts`, `builder-email-template.ts`, `builder-template-frame.ts` | `npm run build:builder-template` |
| `lib/builder/email-render.js` | builder-client sources | `npm run build:builder-email-render` |
| `lib/site-import/dist/*.js` | `lib/site-import/*.ts` | `npm run build:site-import` |
| `lib/build-stamp.json` | `scripts/write_build_stamp.mjs` (records build time) | `npm run build:stamp` |

**No committed file carries a `?v=` hash** (2026-08-24, tasks 86bbkh1nn +
86bbkh288). Sources keep bare asset references; the build applies content
hashes to the generated, gitignored outputs in `public/`. To edit About, Site,
Explore or the builder preview page, edit `src/static-pages/*` and run
`npm run build:html`. This closed the whole class of `?v=` trouble — pin merge
conflicts, stale pins after catch-up merges, and GitHub's phantom conflicts —
and retired the `asset-pins` merge driver with it. CI enforces the invariant
directly: a clean build must not modify any tracked file.

**`src/layout.html` is no longer pinned** (2026-08-24, task 86bbkh1nn). Its
asset references are bare in source; the hashes are applied to the file the
build produces, `public/app-shell.html`, which is gitignored. Removing it from
the pin targets left that generated shell **byte-identical**, which is the
proof the source pins were pure redundancy — they were re-derived on the output
every build, while making the busiest file in the repo change on every asset
change. That is where most `?v=` merge conflicts, stale-pin CI failures and
phantom GitHub conflicts came from. Four committed files still carry pins
(`public/about.html`, `site.html`, `builder-preview.html`, `explore.html`);
task 86bbkh288 removes those too, and with them the merge driver and the
clean-build CI check.

### The other kind: committed, but regenerated wholesale

The table above is gitignored artifacts, which are easy to spot. There is a
second, nastier category — files that **are** committed and look completely
ordinary, but a script rewrites them end to end:

| File | Regenerated by | Put hand-written rules in |
|---|---|---|
| `src/css/_builder-react.css` | `npm run extract:builder-css` | `src/css/_builder-react-overrides.css` |

An edit here is not wiped on the next build — it survives, ships, works, and
then disappears whenever someone regenerates. Nothing tests CSS, so the
deletion is silent: commit `2bd3018` took the CRM modal styles out this way
and Contacts delete was broken for a month. The same PreToolUse hook blocks
these edits now, and `check_conventions.cjs` blocks the commit behind it.

## Landmines

1. **Builder module types need dual registration.** After editing
   `lib/builder-client/builder-template.ts`, run
   `npm run build:builder-template`. If the server bundle
   (`lib/builder/template.js`) doesn't know a module type, it silently
   coerces it to `"text"` on every page load.
2. **`App.els` is a static registry.** New DOM element ids used by vanilla
   JS must be registered in `App.els` in `public/js/core.js`, or `els.*`
   returns `undefined` at runtime with no error.
3. **`public/js/` is frozen.** Bugfixes only. New admin UI is React
   (`components/` + `lib/builder-client/`). Never add new files there.
4. **`main` auto-deploys to production.** Run the full `npm run build` and
   `npm run typecheck` before any push to main.
5. **Staging is whole-file.** `git add <file>` stages ALL uncommitted edits
   in that file, not just yours. Inspect `git diff --cached` before
   committing; the working tree often carries someone else's pending edits.
6. **Never write `data/*.json` from production code paths.** Vercel's
   filesystem is read-only; writes silently vanish. Use Supabase.
7. **Never expose `SUPABASE_SERVICE_KEY` (or any secret) to the browser.**
8. **`?v=` asset pins come from built files, not from source — and they only
   exist on generated, gitignored files** (since 2026-08-24, task 86bbkh288;
   before that they were committed, and were the largest source of phantom
   conflicts and stale-pin CI failures in the repo's history). Never hand-edit
   a `?v=` value, and never commit a file that carries one — CI fails if a
   clean build modifies any tracked file.
   The same hash also breaks if the FOLDER reaches its dependencies oddly:
   esbuild stamps each bundled module's path into the output as a comment, so
   a worktree whose `node_modules` is a symlink to another checkout emitted
   `../../../node_modules/...` and pinned a hash no clean build could
   reproduce (PR #149). Every build script now shares
   `scripts/esbuild-common.mjs` (`--preserve-symlinks`), and
   `npm run check:build-paths` fails the commit if any artifact still points
   outside the repo. If CI rejects pins on files you never touched, run that
   check — the answer is almost always your folder, not your change.
9. **`public/js/` is parsed by nothing but the browser.** It is excluded from
   `tsconfig.json`, has no linter, and loads as plain `<script src>` tags
   rather than being bundled — so unlike `components/` (bundled) and
   `routes/`+`lib/` (required by the node tests), a syntax error there reaches
   production. And a syntax error discards the WHOLE file, so every function
   it defines goes silently dead. `npm run check:syntax` now gates this in
   pre-commit and CI, but it catches syntax only: a typo like
   `App.assset.foo()` still parses and fails at runtime. Open the app and
   check the browser console after editing these files.
   **`scripts/` and `lib/` have the same hole**, and it is worse there because
   most of those files are one-shot tools nothing imports, so no test executes
   them. On 2026-08-30 a "keep both sides" merge resolution fused two
   statements in `scripts/clickup_direct.mjs` — valid to git, a SyntaxError to
   node, and it would have stopped every loop pass on line 1 with no verdict
   written anywhere. `check:syntax` now parses every hand-written
   `.js`/`.mjs`/`.cjs` under both (generated artifacts excluded — landmine 14
   means they do not exist at CI time). `docs/DOCTRINE.md` §6.7.
10. **Vercel bakes env vars in at build time.** Editing one in the dashboard
    does NOT reach the deployment already serving traffic — it takes a redeploy.
    So "the value is wrong" and "the value is right but not live" look
    identical. This cost an hour on 2026-07-29; before suspecting a credential,
    compare the build time (`lib/buildInfo.js`) with when the variable changed.
11. **`checkEndpointLimit` returns `true` when it has ALREADY sent a 429.**
    `if (checkEndpointLimit(...)) return true;` is correct. The inverted form
    bails out of every normal request and writes nothing at all — status 0,
    empty body, a completely dead endpoint that still looks fine in review.

12. **A tenant-scoped table needs BOTH `project_id` and `owner_user_id`.**
    `lib/projectScope.js` decides whether to stamp a tenant by probing the
    table for both (`select=project_id,owner_user_id`). A table carrying only
    `project_id` fails that probe, and `scopedInsertRow` quietly stops stamping
    **either** column — the insert still succeeds, nothing errors, and the rows
    land with no tenant.
    It cost twice on 2026-08-16. `builder_published_pages` wrote ten rows with
    a blank `project_id` and every published page then read back as
    unpublished — caught in minutes because the feature visibly did not work.
    `builder_page_revisions` had the same gap since it shipped and nobody
    noticed for two days, because its reads filter by `page_id` and skip the
    project scope too, so Page History behaved perfectly while all 550
    production rows sat untenanted.
    **The visible failure is the lucky one.** If a new table is scoped, give it
    both columns; if a store writes through `scopedInsertRow`, check the rows
    afterwards rather than trusting the insert's success.
    A dozen older tables still have this gap (`git grep -l 'project_id text'
    docs/SQL | xargs grep -L owner_user_id`); they are only a problem where a
    store actually uses `scopedInsertRow`.
12. **Store calls take the limit FIRST and return an envelope.**
    `listPages(limit, scope)` — `listPages(scope)` reads the scope as a limit
    and returns **every project's pages**, which is a tenant leak that looks
    like a successful query. Every store returns `{ ok, status, data }`, never
    the row: `job.status` off the envelope is `200`, so a complete job reads
    as status "200". Unwrap with a `must(res, what)` helper.
13. **A page write takes `layoutSections` as the ARRAY of sections**, not the
    `{ sections: [...] }` shape the column stores. The wrong shape does not
    throw — the serializer reads no sections and writes an **empty page**.
    Fourteen pages were emptied that way on 2026-08-16, every write reporting
    success. Spread the page (`{ ...page, layoutSections: next }`) so
    `pageBackground` and `theme` are not reset, and read the page back after
    writing before you touch the next one.
14. **A vitest test must not require a generated server lib.** CI runs
    `npx vitest run` BEFORE `npm run build`, so anything under `lib/builder/`
    (`template.js`, `document.js` → `./template`, …) does not exist at vitest
    time — a test reaching it passes locally forever and fails CI forever
    (PR #343). vitest (`components/**`, `lib/builder-client/**`) tests TS
    sources only; a test needing a generated lib goes in the node suite
    (`scripts/builder/*.test.js`, run after the build). Enforced by
    `check_vitest_generated_lib.cjs`; full story in `docs/DOCTRINE.md` §5.18.

## Working locally

Production is not where you find out whether something works. Full guide:
**`docs/LOCAL_DEVELOPMENT.md`**.

```
npm run doctor        # what is up, what is stale, which database am I on
npm run env:local     # a NEW worktree: point it at this machine's database
npm run db:refresh    # make this copy match production (about two minutes)
npm run db:use        # which database am I on? add local/cloud to switch
npm run schema:check  # has production's structure moved away from the record?
```

The admin app carries a strip across the top saying which database it is
talking to, `npm run dev` refuses to start against the live one without
`ALLOW_CLOUD_DEV=1`, and all three read the same classifier
(`lib/environmentBanner.js`) so they cannot disagree.

**A fresh worktree has no settings file, so run `npm run env:local` in it
first.** It writes one pointed at the Supabase on this machine, using the
development defaults `supabase status` prints — no live credential is involved,
so an agent may run it. This is what makes `check:panels` runnable in a
worktree; the old advice (`cp ../../../.env.local .`) was a live-secret copy an
agent may not perform, which left the one gate CI cannot run also unrunnable by
an unattended pass.

**`db:refresh` costs production disk IO.** Six runs in one day exhausted the
budget and left every tenant site down on 2026-08-17 (`docs/DOCTRINE.md` §1.5).
Weekly is the rhythm; `doctor` says when you have drifted.

## Some jobs run on exactly one machine

There is more than one machine now, and three jobs are not safe to run twice
at once: **`bus-relay`** (two relays both post the same comment), **`db:refresh`**
(Supabase disk IO is one budget for the whole company — six runs in a day took
every client site down on 2026-08-17) and **the loop skills** (claiming a
ticket is check-then-act, which is only sound with a single claimant).

Which machine owns which job is a committed table in **`lib/nodeRoles.js`**,
and every one of those jobs asks it first. Moving a job to another machine is
a one-line edit there plus a commit — deliberately reviewable, rather than a
setting somebody flips on one machine at 2am.

```
npm run node:whoami          # which machine is this, and what may it run
npm run node:owns -- <job>   # 0 = yes, 3 = another machine's job, 1 = cannot tell
npm run doctor:node          # is this MACHINE a valid node? (read-only, safe anywhere)
npm run provision:node       # what would it take to make it one? (dry run)
```

**Standing a new machine up is a script, not a document**
(`docs/NODE_PROVISIONING.md`). `doctor:node` is to a machine what `doctor` is to
a folder: identity, toolchain, checkouts, config and schedules, each answered
PASS / FAIL / **CANNOT TELL** — never a pass for a check that could not run.
`provision:node` fixes what a script is allowed to fix and prints the rest as
`::: PROMPT FOR DANE :::` blocks; it is a dry run unless you add `--apply`.
The two are separate programs on purpose — a provisioner that graded its own
work would grade it by the assumptions it acted on — but they read ONE inventory
(`lib/nodeProvision.js`), because two definitions of "provisioned" disagree
quietly. **Installing the pulse schedules reports CANNOT DO YET on every run**
until Slice B (`86bbh9kh2`) exists: a green check on a machine that runs no jobs
is the exact failure the NODES plan was written against.

### A job that stops firing has to say so

`doctor:node` answers "is this machine set up?", and a schedule can be
installed, loaded and completely dead. Two different things go wrong on a
machine nobody is looking at, and only one of them used to make a noise:

```
npm run heartbeat                        the roll call — when did each job last succeed?
npm run heartbeat -- --check             the same, and post to the bus if one has gone quiet
npm run heartbeat -- --beat --role X     record a successful run (jobs call this; you never do)
```

A job that **fails** writes a log line and posts to the bus
(`scripts/report_job_failure.mjs`, one post per job per 6h, cleared by the next
success). A job that **never fires** writes nothing at all, and nothing is
indistinguishable from a quiet week — so each job records a *beat* when it
succeeds, and something notices when the beats stop.

**The beats live where both machines can read them**, on a ClickUp ticket
called *Node roll call* whose description is rewritten in place — no channel
messages, so no "all is well" ×365. The bus only ever hears about a **miss**.

**And the check runs from the machine that does NOT own the job.** This is the
whole trick, and it is easy to get backwards: a watchdog running only where its
job runs cannot detect that machine being switched off, which is the case it
exists for. `scripts/run_bus_relay.sh` therefore performs the check *before* it
asks whether it owns the relay — the non-owning machine was already waking
every ten minutes and doing nothing at all, and that idle wake is the one
vantage point that survives the owning machine being dead.

Two clocks, on purpose: the local stamp is written on **every** success (free,
offline — it is what `doctor:node` reads to say when each owned job last
actually worked here), and the shared row is pushed **at most once a day**,
which is the resolution the requirement needs and what keeps the ticket quiet.

**Only `bus-relay` beats today.** The two loop lanes run inside long-lived
agent sessions with no committed runner to hang an emitter on, `db-refresh` has
no schedule on purpose, and `pulse-pipelines` lives in another repo. Those
report **NOT REPORTING with the reason**, every run — never as healthy, because
a system that is one-fifth instrumented must not read as a green board. Adding
a role to `lib/nodeRoles.js` without deciding either way fails a test.

Each machine says who it is in `~/.alphire-node` (one short line:
`macbook-pro` or `mac-mini`). Without that file it falls back to the hostname,
which is a guess — rename the Mac and the guess changes. **A machine whose
name is not recognised does not quietly skip; it refuses out loud**, because
"another machine is doing it" and "nobody is doing it" look identical
otherwise, and only one of them is safe.

### And a job that runs but ships nothing has to say so too

The heartbeat measures **liveness**. There is a failure it structurally cannot
see, and it is worse, because it writes a full cheerful log:

```
npm run throughput                          is the queue getting shorter?
npm run throughput -- --check               the same, and post to the bus if it has STALLED
npm run throughput -- --check --dry-run     say what it WOULD post, send nothing
```

On 2026-08-31 the build loop fired every hour, exited 0 every time, and did not
move the queue — 52 queued, 1 in review, the oldest rework PR sitting since
Aug 25. Every gate was green and every green was honest. Nothing in the system
asked *is the queue getting shorter?*, so finding it took a morning of reading
logs by hand (task 86bbqrw3p).

It prints tickets closed per day, the backlog at the end of each day, and how
long the oldest rework pull request has sat — and gives one of **four**
verdicts, never two: `MOVING`, `IDLE` (nothing closed because there was nothing
to close — healthy, and it says why), `STALLED`, or `UNKNOWN` when a reading
could not be taken. Exit 0 / 0 / 1 / 2. **"Alive but useless" never renders as
healthy**, and neither does "could not tell".

`--check` posts to the bus only on `STALLED`, once per 6 hours, cleared by the
next run that is not stalled — the same discipline the failure alert uses, so
there is no "all is well" ×365. `scripts/run_bus_relay.sh` runs it **before**
the ownership check, for the same reason the heartbeat runs there: the machine
that does not own the relay is already awake doing nothing, and that idle wake
is the vantage point that survives the owning machine being dead.

Two numbers in that report answer the same question — the last point of the
backlog curve and "open in total" — so they are computed to agree by
construction. The first live run had them disagreeing by one, because a single
ticket sat in `Live` with no closure date; the curve now defers to the status
and **says how many tickets it had to guess about** rather than adjusting
quietly.

## The pipeline can be paused — ask before you claim or merge

Sometimes Dane needs the deck: something is urgent, and the loop lane — spec,
build, review, merge — is about a day end to end. Until 2026-08-25 the only way
to go fast was to step outside the system entirely, into the one place where
none of the guards apply. That is a missing lane, not a person being careless,
so there is now a switch:

```
npm run pipeline -- status                    is it running? if not, since when, who, and why
npm run pipeline -- check                     the same question for a script: 0 = running, 3 = paused
npm run pipeline -- pause --why "..."         stop new claims, then WAIT for work in flight to finish
npm run pipeline -- resume --operator-asked   hand the deck back (Dane's call, never an agent's)
```

**Type the `--`.** It is not decoration: without it npm swallows every `--flag`
before the command sees it. Leave it out and `resume --operator-asked` is
refused for missing the very flag you just typed, and `pause --now` waits the
full half hour instead of returning at once.

**Every actor asks, not just the loops.** A pause only the loops respected
would not have prevented the collision it was written for — the session that
merged PR #432 was hand-driven and would never have looked. So: **before
claiming a ticket, and before merging anything, run `npm run pipeline -- check`.**
Exit 3 means claim nothing, merge nothing, write nothing to ClickUp; say so
once and stop. That is a normal outcome, exactly like `node:owns` saying
another machine owns the job.

**It fails safe.** If the switch cannot be read, it counts as paused. Running
while Dane has the deck collides with whatever he is doing on it; pausing when
he does not costs idle machines and a loud message. Those are not symmetric.

**It drains, it does not kill.** `pause` stops new claims the instant it writes
the flag and then waits for anything already building, because killing a pass
mid-build strands its ticket in `Building` forever — the loops only ever claim
from `Queued`, and that happened twice in the week the switch was written.
`--now` skips the wait and names exactly what it left running. `resume` also
unsticks anything a dead pass left behind: a stranded build goes back to
`Queued` with a note, while a stranded review stays in `In review` — its build
is finished and its PR is open, so only the stale claim is cleared.

**An agent may pause; only Dane resumes.** Anyone should be able to stop the
line — it is a safety move. Handing the deck back is his, because only the
person standing on it knows whether he is finished. A pause that outlives two
hours announces itself on the bus and keeps saying so hourly, because a pause
nobody remembers looks exactly like a pipeline that has broken.

## The fast-track lane — "Let's fast track <ticket-id>"

Said at the start of a session, that sentence is a **complete instruction**
(Dane, 2026-08-30): run the human lane end to end, and end the session with a
clean merge. It is the loop's job done by hand, not a way around the loop's
guards — every check below is one the loops also run. Full version, with the
incidents behind each step: `docs/LOOP_ENGINEERING.md`, "The fast-track lane".

1. `npm run pipeline -- check` — exit 3 means stop; say so once.
2. Read the ticket **and its comments**. On a send-back, the review notes ARE
   the job; the description is context.
3. Claim it: `npm run clickup -- status --task <id> --status Building
   --if-status Queued`. **Priority is not a guard** — only status is, and
   only `--if-status` makes the claim atomic. Leave the priority alone.
4. `npm run clickup -- build-start --task <id>` — exit 3 means a branch
   already exists; work on THAT branch (`git worktree add
   .claude/worktrees/<topic> -b <branch> origin/<branch>`, then `npm ci`,
   `npm run build`, `npm run env:local`, and stamp
   `git config branch.<branch>.clickup-task <id>`). Otherwise
   `npm run thread <topic> <id>`.
5. **On a send-back, merge `origin/main` in BEFORE touching a line.** The fix
   review asked for may already have landed on `main` under another name —
   on 2026-08-30 it had, and reworking first cost a conflict (`docs/DOCTRINE.md`
   §6.7).
6. Build. Every Definition-of-done gate, and break each fix on purpose —
   revert it, watch the named test fail, restore it.
7. `npm run ship`. **No pause to merge**: merges never collide with the
   loops, `pause` drains for up to half an hour, and a pause older than two
   hours nags the bus hourly. `ship` re-runs the gates, pushes, **records the
   PR on its ticket**, waits for CI, merges and tidies; if it stops on a
   conflict, resolve by hand and run it again.
   You do not run `clickup pr-opened` by hand here — `ship` writes that trail
   itself, from the branch's `clickup-task` stamp, which is why step 4 stamps
   it even on an existing branch. Without the trail the review gate answers
   CANNOT TELL and refuses the PR once branch protection is enforcing
   (`docs/LOOP_ENGINEERING.md`, "Who writes the PR trail"). A branch with no
   stamp still ships; it says out loud that nothing was recorded.
8. Ticket to Live with the closing note (gates, live probe, what was
   break-tested); `npm run tidy`; one line on the bus.

A ticket already **In review** with an open PR is the review half of this
lane: skip the claim in step 3 (never drag it back to `Building`), do steps
4–8 on the existing branch, re-run the gates on the *merged* code yourself, and
close with `--if-status "in review"`. A job another machine owns (`bus-relay`)
exits 0 here having tested nothing — rehearse it on the owning machine.

## One thread, one topic, one session

A worktree keeps two threads from corrupting each other's files. It does
nothing about the other failure, which is quieter and cost a whole epic on
2026-08-20: **a single session that starts on one topic and drifts onto
another.** Nothing objects, because every tool here answers "which folder am
I in" and none of them answers "is this still the same job".

That day a session opened to set up the Mac Mini — ops work, no repo changes,
correctly in the main folder. It drifted into building the ecosystem-map epic,
created two worktrees, and kept working inside them by `cd`-ing from the same
session, so the status line still read `MAIN FOLDER` the whole time. Meanwhile
a *different* session was building the same epic. They collided: the other one
pushed a commit onto this one's branch, merged its PR, and closed its ticket,
all discovered afterwards. Neither had any way to see the other.

Four rules, in the order they would have broken that chain:

1. **The agent names the thread, and re-names it when it changes.** Every
   session states its topic in its first substantive reply. When a request
   does not belong to that topic, the agent **stops** and says so plainly —
   *"Topic change: this thread is X, you are asking for Y"* — before touching
   anything. The operator should never be the one to notice first. He has
   raised this repeatedly; assume he will not raise it again.

2. **One session, one folder — a hard stop at the first commit.** Ops,
   diagnosis, reading and ClickUp work may happen wherever the session already
   is. The moment work will produce a **commit**, the session sets up the
   worktree, hands over the command to open a session there, and **stops
   building**. It does not `cd` in and continue. A session that builds in a
   folder it did not open in is invisible to every tool the operator has.

3. **Claim the ticket before building — hand-built work included.** ClickUp
   status is the only surface where two sessions can see each other, and the
   atomic claim (`--if-status`) exists exactly for this. Hand-building is not
   an exemption; on 2026-08-20 two sessions built the same epic because
   neither ticket was ever moved to `Building`.

4. **Before starting on an epic, run `npm run map` and read the queue.** Ten
   seconds. It catches the case where somebody else is already on it.

Rules 1 and 2 are the agent's job and cost the operator nothing. Rule 2 costs
him one window-open per piece of real work, which is the whole price of the
system.

## One worktree per thread

Two sessions in one folder share a single working tree and a single HEAD: a
branch switch in session A rewrites session B's files, and each one's
uncommitted edits ride along in the other's commits. The symptom is
"unrelated" modified files you never touched.

Give every thread its own worktree — a separate folder with its own branch,
sharing the same repo history. **Use the command, not the raw git:**

```
npm run thread <topic> <clickup-task-id>   # tidy first, branch off CURRENT origin/main, npm ci, build
npm run ship               # catch up, verify, push, PR, wait for CI, merge, tidy
npm run map                # what exists, what is shipped, what is still live work
npm run tidy               # delete shipped branches, remove finished worktrees
```

**A thread exists only while its ClickUp task is open** (Charter Q1,
2026-08-18). The task id is required, not optional — `npm run thread` stamps
it onto the branch (`git config branch.<topic>.clickup-task <id>`, the same
`branch.<name>.*` namespace git/VS Code already use for per-branch metadata)
and refuses to create a thread for a task that is not confirmed open. `npm
run tidy` reads the stamp back and cleans up a thread whose task has since
closed — branch deleted, worktree removed, logged to `tidy-restore.log` —
**even if its commits never shipped**, which the older shipped-only check
could never reach (an abandoned thread's commits are legitimately "active" by
`git cherry`, and would otherwise sit there forever). A branch whose ClickUp
status can't be determined (network, auth, rate limit) is never treated as
closed — only a clean, confirmed read authorizes a delete.

`npm run ship` is the other end of `thread`: the nine hand-run steps between
"the work is done" and "it is live", in order, with the state checked between
each one. Run it again if `main` moves while it runs — it picks up where it
got to. `--dry-run` says what it would do; `--no-merge` stops before merging.

**It never force-pushes.** It catches up by merging `origin/main` in rather
than rebasing, so the branch only ever gains commits and an ordinary push
always works. That is deliberate: a force-push inside a script is invisible to
the operator's `Bash(git push --force*)` deny rule, and a convenience command
does not get to route around a standing decision (`docs/DOCTRINE.md` §6.6).
Squash-merge discards the merge commits anyway, so it costs nothing.
`scripts/builder/shipThread.test.js` fails if a future edit reintroduces one.

**Four merges in `main` are named after housekeeping, not their work** —
`ship` used to title the PR from `git log -1`, which by then was often its own
asset-pin commit, and a squash-merge makes that title permanent. Fixed
(`scripts/builder/pullRequestCommit.js`); the four that already landed are
listed with their real subjects in `docs/MISLABELED_MERGES.md`. They are not
being renamed, because that means force-pushing shared history.
**That fix only skips commits `ship` itself wrote.** The PR is named after the
newest *hand-authored* commit, so if shipping turns up an unrelated fix, commit
it BEFORE the feature (or fold it in) — otherwise the chore takes the name,
which is exactly how #304 landed titled after a `.gitattributes` line.

**The `?v=` asset pins cannot conflict any more, because they are not in git**
(2026-08-24, task 86bbkh288). They used to live inside committed HTML, which
made any two branches touching styling collide there — most of the conflict
traffic on 2026-08-11 — and needed a local merge driver GitHub could not run,
which made clean branches read as `CONFLICTING` and stalled eight approved
merges on 2026-08-24. Now every pinned file is generated and gitignored, the
driver is gone, and a pin conflict is structurally impossible. If a `?v=`
value ever shows up in `git diff` again, something has re-committed a
generated file — `check_conventions` blocks exactly that.

`npm run thread` exists because each hand-rolled step had already cost time:
branching off a stale local `main` (forces a rebase later, which is where the
asset-stamp conflicts come from), skipping `npm ci`, and never cleaning up —
41 local branches and 10 worktrees accumulated in six weeks. The equivalent
by hand, if you ever need it:

```
git worktree add .claude/worktrees/<topic> -b <topic> origin/main
cd .claude/worktrees/<topic> && npm ci && npm run build
```

Order matters in that second line: creating the worktree fires `post-checkout`,
which cannot build before `npm ci` has run — so build afterwards or the folder
keeps whatever the failed build left behind. It is the **full** `npm run build`,
not `build:assets`: the shorter one skips `public/app-shell.html`, which IS the
admin app, and `lib/builder/template.js`, which the server-side tests require.
A folder missing those passes review and then serves a 404 to a browser — on
2026-08-15 that read as `check:panels` being broken and cost an hour twice.

Cleanup is automatic now and should never need thinking about: GitHub deletes
each branch as its PR merges, `post-merge` deletes the local copy once its work
is live, and `npm run thread` tidies before it starts. `npm run tidy` never
touches uncommitted work, a locked worktree, the folder you are in, or a branch
with unshipped commits; deletions are logged with restore commands in
`.git/tidy-restore.log`.

**Squash-merging is why `git branch -d` is useless here.** It rewrites the
commit, so `-d` calls shipped work "not fully merged" and refuses. `git cherry`
(patch equivalence) is the only correct test — that is what `map` and `tidy`
both use, from one shared module so they can never disagree.

`git worktree list` shows every active thread; `git worktree remove
.claude/worktrees/<topic>` cleans one up. Caveat: `.git/hooks` is **shared**
across worktrees, so `npm install` in one reinstalls hooks for all of them.

**`npm run reconcile`** (Charter Q2, 2026-08-18) catches the drift the tools
above can't see on their own: a Loop Queue task left in-flight after its PR
already merged (moves it to Live), and a branch stamped with a task
(`npm run thread`) that has since closed but is still on the Mac (flags it to
the bus — `npm run tidy`'s own closed-task cleanup should have caught it).
Dry-run by default (`npm run reconcile`); `-- --live` performs the repairs.
Meant to run on a schedule — see the Mac Mini engine-room task for when that
lands; today it's a command to run by hand.

**Dev servers collide on port 3001, and `pkill` is a shared-resource action.**
Every worktree's `npm run dev` wants the same port, so the first one started
owns it and the others silently fail — which means a browser check can be
driven against ANOTHER thread's code and reported as yours. On 2026-08-16 that
produced a page that appeared to 404, and a fix was nearly written for a bug
that did not exist; the same session had already killed a teammate's server
with `pkill -f "node server.js"`, which matches every worktree at once.
Start this folder's own server on its own port and point the harness at it:

```
PORT=3057 node server.js
UI_HARNESS_BASE_URL=http://localhost:3057 npm run check:panels
```

`scripts/ui/app-driver.mjs` now refuses to run when the app on the target port
is serving a different build than the checkout, and names the fix. Trust that
message: it is almost always another worktree, not your code.

Run the real `npm ci` — **never symlink `node_modules` to another checkout**
to save the ~270MB. Builds are supposed to be a function of the source, and a
symlink leaks the folder's layout into the bundle bytes (landmine 8).
`--preserve-symlinks` now absorbs it and `npm run check:build-paths` catches
what slips through, but a real install is still the setup everything else
assumes.

## Definition of done

Before reporting a task complete, run and state the results of:

1. `npm run typecheck`
2. Affected tests — `npm run test:builder-ui` (React/builder-client) and/or
   `npm run test:builder` (server-side builder libs)
3. The rebuild command for every generated artifact your change affects
4. `node scripts/check_conventions.cjs` (also runs at pre-commit;
   `SKIP_CONVENTIONS=1` bypasses — if you bypass, say so and why)
5. `npm run check:syntax` if you touched `public/js/`, `public/shared/`,
   `scripts/` or `lib/` — a parse gate over every hand-written
   `.js`/`.mjs`/`.cjs` in those trees (also runs at pre-commit and gates CI).
   Run it after resolving ANY merge conflict by keeping both sides.
6. **`npm run check:panels` if you touched ANY settings panel or its CSS**,
   and it is not optional because CI cannot run it — CI has no browser, so
   this check only ever runs if a person runs it. A staggered panel reached
   the operator on 2026-08-12 and again on 2026-08-13; both times the code
   was reviewed, the rule was read, and nobody ran the check.

   **A green run is only evidence if the fixture exercises your panel.**
   `check_panels` measures what it can see: seed real content for your
   module in `scripts/ui/seed_fixture.mjs`, then **break the layout on
   purpose and watch it fail** before you believe the pass. An item manager
   that declares `data-lattice-pairs` and renders no fields now fails
   outright rather than passing silently, which is the specific hole that
   let both of those panels through.

7. **`npm run check:render` if you changed what a module RENDERS** — its
   markup, its animation, or the CSS behind either. It drives a real browser
   over `builder-preview.html` and needs **no database, no login and no
   fixture**, so it costs about 30 seconds:

   ```
   PORT=3058 node server.js
   UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:render
   ```

   New rendering behaviour means a contract in
   `scripts/ui/render-contracts.mjs` — and **break it on purpose and watch it
   fail before believing the pass.** That step is not ceremony: it has caught
   two assertions that could not fail, including one where the check was
   comparing a setting to itself.

8. **`npm run check:shots` on every task, not only the visual-looking ones.**
   It builds `main`'s code and this branch's code, photographs six pages
   through both, and attaches every pair that differs to the ClickUp ticket —
   so a change to what a page renders reaches the operator as pictures rather
   than as a branch to check out (charter Q5). Deciding for yourself that a
   change "is not visual" is the failure it exists to prevent, and it costs
   about ten seconds to say so and stop when no watched file changed.

   ```
   PORT=3058 node server.js
   UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:shots -- --task <clickup-id>
   ```

   Its comparison is exact — one differing pixel counts — which is only
   affordable because it proves its own instrument before trusting a reading.
   If that control ever fails, fix the scene, never the comparison.
   `docs/VISUAL_REVIEW.md`.

`npm run check:css` is deliberately absent from this list: CI runs it on
every pull request, so it is the one visual gate nobody has to remember.
What it and `check:render` do **and do not** cover is `docs/DOCTRINE.md`
§5.14 — read that before treating a green run as proof a page looks right.
Neither of them can tell a bounce from a wobble.

9. **Say where you looked at it.** Not a command — a sentence naming the
   screen you opened and what you saw. Every gate above can pass on a change
   that is visibly broken: nothing here tests CSS, and the panel bugs of
   2026-08-12, 08-13 and 08-16 all reached the operator green. The local app
   is the only place that catches them, and it is now trustworthy — real
   pages, real assets, and `npm run doctor` to prove the folder is sound.

   ```
   npm run doctor        # is this folder actually able to run?
   npm run dev           # http://localhost:3001
   ```

   Two worktrees cannot share port 3001; give this one its own
   (`PORT=3057 node server.js`) or you will check another thread's code and
   report it as yours.

"It should work" is not done. Passing commands are done — and for anything
with a visible surface, so is having looked at it.

## Session-close capture (binding)

Before the window closes, get the keepers onto the shared record, unprompted:
decisions to the party line (the ClickUp bus), artifacts and findings to the
docs of the repo that owns them, canon changes to the vault's
`doctrine/_proposals/`. A standing instruction Dane gives verbatim is always a
keeper. If the destination is somewhere CC-starcaster cannot write — vault
doctrine, another repo's docs — hand it to the agent that can, on the wire, in
this session. Noticing is not capturing. (Vault `doctrine/OPERATIONS.md`,
Session-close capture; ratified 2026-08-14.)

## Naming: UI term vs code/DB term

| UI | Code / DB |
|---|---|
| Builder | `develop`, `develop_*` tables, `/api/builder/*` + `/api/develop/*` |
| Messaging: Topics | `topics` |
| Ask Roger (dev agent) | `devAgent` |
| StarCaster | package `starcaster` |

## API conventions

- Response envelope: `{ ok: true, data }` / `{ ok: false, error: { message, code? } }`
- Session cookie `app_session`; active project via `x-project-id` header
- Tenant-scoped tables carry `project_id`; scope every query
  (`lib/projectScope.js`) — uniqueness is per-project, not global
