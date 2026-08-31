# Standing a machine up as a node

**This page is not the authority on the steps. The script is.**

That inversion is the whole point of it. The Mac Mini setup procedure used to be
a seven-page document with about thirty hand steps (ClickUp doc `2kydhxeu-754`),
and a document with thirty steps is a document whose thirtieth step gets
skipped. Several of these steps fail *silently* when skipped — a missing
container runtime does not announce itself, it just makes the visual gates
unrunnable a week later, on a machine that looks perfectly fine.

So the steps moved into code. What is left here is the narration: what each step
is *for*, and what to do when one of them fails.

```
npm run doctor:node             is this machine a valid node?   (read-only, safe anywhere)
npm run provision:node          what would it change?           (dry run, changes nothing)
npm run provision:node:apply    do it
```

Run `doctor:node` first, always. It installs nothing and starts nothing, so it
is safe on a machine that is on fire — which is exactly when you want to ask.

---

## The two commands are deliberately two programs

`provision_node.sh` **fixes**. `doctor_node.mjs` **checks**. They are separate on
purpose, and the reason is worth keeping: a provisioner that also graded its own
work would grade it by the same assumptions it acted on. The verifier has to be
able to fail something the provisioner just "fixed".

What they *do* share is one inventory — `lib/nodeProvision.js`, the single table
of what a node consists of. Two copies of that table would be two definitions of
"provisioned", and they would disagree quietly. The same reasoning put the role
registry in `lib/nodeRoles.js` and the environment classifier in
`lib/environmentBanner.js`.

---

## Three answers, never two

Every item reports one of three things, and the third one is the one that
matters:

| | means |
|---|---|
| **PASS** | checked, and correct |
| **FAIL** | checked, and wrong — the fix is printed on the next line |
| **CANNOT TELL** | *not checked.* Never shown as a pass. |

`provision:node` adds two more: **FIXED** (it was wrong, the script corrected it)
and **WAIT** (it needs a live credential, so it is printed for Dane and never
attempted).

**A check that could not run must never report a pass.** That is `DOCTRINE.md`
§3.11, and it is here because of a real day: on 2026-08-21 a probe of the Mac
Mini reported the container runtime as fatally broken. It was not, and never had
been. The probe ran over a non-interactive SSH session with no
`/opt/homebrew/bin` on its PATH, so `colima` could not find `limactl`. Every word
it printed was consistent with a machine that was working fine.

If you are probing a node over SSH, wrap the command in a login shell or you
will get that reading again:

```
ssh <host> 'zsh -lc "cd <checkout> && npm run doctor:node"'
```

---

## What it checks, and why each one is on the list

### Identity — which node is this?

One line in `~/.alphire-node`: `macbook-pro` or `mac-mini`. Nothing else.

Without it the machine falls back to its hostname, which is a *guess* — rename
the Mac in System Settings and every guard silently stops recognising it. So a
hostname match is reported as a FAIL, not a pass: it happens to be right today.

A machine with no recognised identity **refuses every exclusive job out loud**.
That is correct behaviour, and it is also a machine sitting there doing nothing,
which is why this is checked first.

### Toolchain

`brew`, `git`, `node`, `npm`, `gh`, `doppler`, `supabase`, `jq`, `claude`.

`brew` and `claude` install by piping a URL into a shell, so the script prints
them and never runs them — that is a decision with a person's name on it, not
something a 3am pass does. Everything else is `brew install`.

**Node is pinned**, in `.nvmrc`. Not for neatness: the two machines had already
drifted apart without anyone choosing to — the MacBook on 22.22.0 via nvm, the
Mini on 22.23.2 via brew, purely because brew installed whatever was newest that
day. "Whatever brew last installed" is not a decision. The script will *not*
switch versions for you even with `--apply`, because changing Node underneath a
machine that is running the loops takes them down mid-pass.

**The container runtime is checked by whether it answers, not by which one it
is.** The MacBook runs Docker Desktop; the Mini runs Colima, because it is
headless and there is no login session to hang a GUI app on. Requiring a
specific one would fail a machine that works.

### Repos

`starcaster`, `normie`, `pulse`, `vault`.

The locations are **not written down here** — they come from
`scripts/builder/taskRepo.js`, which is what the loops themselves use to decide
where a `repo:`-tagged ticket gets built. If this list invented its own answer, a
machine could be "fully provisioned" and still escalate every ticket for a repo
it demonstrably has.

If a repo is on the machine but not where the loops look, the script says so and
**refuses to clone a second copy**. Two checkouts of one repo, diverging, with
nothing to say which one anybody is editing, is a worse state than the mismatch.
Where a repo lives is a decision; the script names it and leaves it to Dane.

### Config

- **The Claude memory folder.** Its *name* is derived from the checkout's
  absolute path, so it is different on every machine and **cannot be copied
  across**. This is the step the old document got wrong: copying `.claude`
  between Macs put the memory under the other machine's folder name, where
  nothing would ever read it — and an empty memory folder looks exactly like a
  working one, so nothing errored.
- **Doppler scoping**, which is per folder. Logging in is Dane's; *scoping* is
  not (it selects a project, it does not reveal a value), so the script does it.
- **GitHub access**, tested by outcome: can `git` reach GitHub without stopping
  to ask for anything? Any credential helper satisfies that. An earlier version
  asked whether `gh auth setup-git` had been run and reported the MacBook as
  broken — it authenticates through macOS's keychain and pushes perfectly.
  Testing one blessed route to a result instead of the result is how a working
  machine gets told to fix itself.

  The probe runs with `GIT_TERMINAL_PROMPT=0`. Without it, a machine with no
  credentials makes `git` sit and wait for a password — which is also exactly
  how a scheduled job experiences this fault: not as a failure, as a job that
  never finishes.

### Schedules

Which machine owns which job is `lib/nodeRoles.js`, and this does not repeat it —
it only asks how to install a job once you know it belongs here.

- `bus-relay` → `scripts/install_bus_relay.sh`
- `db-refresh` → **no schedule, on purpose.** It spends production disk IO and
  wants a person nearby; six unattended runs in one day took every client site
  down on 2026-08-17.
- `loop-build` / `loop-review` / `pulse-pipelines` → **CANNOT DO YET** (below).

It also checks the mirror image, which nobody thinks to look for: a schedule
still installed on a machine that no longer owns the job. Harmless — every job
re-checks ownership at run time and exits — but a leftover schedule is how a
cutover ends up half-done in both directions.

---

## What it cannot do yet, and why that is printed every single run

**Installing the pulse scheduled jobs needs pulse's `bin/install-launchd.sh`,
which is NODES Slice B (ticket `86bbh9kh2`) and has not been written.**

That row reports **CANNOT DO YET** on every run and is never counted as a pass.

This is not an oversight left in for later. Installing the scheduled jobs is not
a trimmable corner of "provision a node" — it is the step that makes a new
machine actually *run* anything. A provisioning script that reported success
across the board while quietly installing no jobs would be a green check on a
machine that does nothing, which is the precise failure the whole NODES plan was
written against.

The loops (`loop-build`, `loop-review`) are the same shape for a different
reason: they run inside a long-lived agent session rather than a launchd job, so
there is nothing in this repo to install. When that gets a scripted form, it
becomes a row with an installer.

---

## The secrets boundary

Four steps need a real credential typed by Dane:

- `doppler login`
- `gh auth login && gh auth setup-git`
- the Claude Code sign-in
- (`doppler setup`, which the script *does* run — it selects a project, it does
  not handle a value)

No agent session and no script here ever holds a credential value
(`DOCTRINE.md` §4.1, vault `OPERATIONS.md` SOP 6). Each of these is printed as:

```
::: PROMPT FOR DANE :::
  Log this machine in to Doppler
  Why: Every secret the repo reads comes through Doppler. Until this is done,
       every ops command fails.

  doppler login
:::::::::::::::::::::::
```

Both commands render that block from the same function, so it looks identical
whichever one you ran — one shape to learn, not two.

A step the script declines is reported as **WAITING**, out loud. "The script did
not do it" must never read as "the script forgot".

---

## When a step fails

The failing line prints the command that fixes it. Beyond that:

| Symptom | What it usually is |
|---|---|
| Everything Homebrew-installed reports missing, over SSH | The probe, not the machine. Re-run inside `zsh -lc`. |
| `docker info` does not answer | The runtime is installed and stopped. `colima start`, or open Docker Desktop. |
| A repo "is not checked out" but you can see it | It is not where `taskRepo.js` looks. The script names both paths. |
| Node is the wrong version | `nvm install` inside the checkout — it reads `.nvmrc`. Not automatic: it would take the loops down mid-pass. |
| A schedule is installed that this machine does not own | Left over from a cutover. `--uninstall` it. |
| `Cannot read the inventory` | The script refused to continue rather than treat a crash as an empty list. Usually a checkout missing `lib/nodeProvision.js`. |

## Run it twice

The second run is a different program. `provision:node:apply` is check-then-fix
throughout, so running it again reports PASS on everything the first run FIXED
and says plainly that it changed nothing. If a second run keeps "fixing" the same
item, that item's check is wrong — not its fix.

## Related

- `lib/nodeRoles.js` — which machine owns which job
- `lib/nodeProvision.js` — the inventory both commands read
- `docs/LOCAL_DEVELOPMENT.md` — is this *folder* able to run (`npm run doctor`)
- vault `doctrine/NODES.md` — the plan this is Slice D of
