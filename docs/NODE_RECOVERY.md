# If a machine dies

This is the plan for getting a dead Mac back, and the first thing it should say
is the reassuring part, because it is true and it is easy to forget at the wrong
moment:

**No client site depends on any Mac in this system.** The tenant sites are served
by Vercel, the database is Supabase, the code is on GitHub, and the secrets are
in Doppler. All four are somebody else's data centre. If the Mac Mini is
unplugged, dropped or stolen tonight, every client's website carries on serving
visitors exactly as it did this morning and nobody outside this company notices
anything at all.

What stops is **the work getting done**: the bus relay, both loop lanes, the
pipeline pulse, the weekly report, the YouTube media worker and the two Pulse
pipelines. The queue stops draining. That is a real cost, and it is a cost
measured in days rather than in clients.

So this is not an emergency procedure. It is a rebuild procedure, and it is
written to be followed by somebody who is not at home.

---

## The short version

```
1. Buy a Mac. Any Mac that runs the current macOS.
2. Sign in to it, install Homebrew, install the Claude CLI.
3. gh auth login                       ← the only thing needed to reach the backup
4. git clone the starcaster repo
5. npm run restore:node -- --node mac-mini            ← says what it would do
6. npm run restore:node -- --node mac-mini --apply    ← does it
7. npm run provision:node:apply        ← rebuilds everything the backup did NOT hold
8. Type the four logins it prompts for.
9. npm run doctor:node                 ← compare against the machine report
10. launchctl load the jobs, one at a time.
```

Step 5 is deliberately before step 7. The restore puts back the things that
exist nowhere else; the provisioner rebuilds everything that is derivable. Doing
it the other way round works too — they do not overlap — but this order means
the irreplaceable half is safe first.

---

## Why there is so little to restore

Almost nothing on one of these machines needs backing up, because almost
everything on one is **derived from somewhere else**:

| What | Where it really lives | How it comes back |
|---|---|---|
| The code | GitHub | `git clone` |
| The secrets | Doppler | `doppler login` |
| The data | Supabase | it never left |
| The toolchain | `lib/nodeProvision.js` | `npm run provision:node:apply` |
| Node modules | npm | `npm ci` |

The backup is the short list of things that fit in none of those rows — the
things that exist on one disk and nowhere else. It is short on purpose. A backup
you cannot read the manifest of is a backup you are trusting rather than
checking, and the manifest for one of these fits on a phone screen.

The full list, with the reason each item is on it, is `lib/nodeBackup.js`. It is
meant to be read.

---

## The four things that are deliberately NOT in the backup

Every credential. The ssh keys, the Doppler token, the GitHub token, the Claude
sign-in, and the `.env.local` files in each checkout.

This is a decision, not a gap (`docs/DOCTRINE.md` §4.1). Putting credentials in
the archive would mean the archive itself needed a credential to open — and
needing a credential to open your disaster recovery, on the day of the disaster,
is a plan with a loop in it. Instead the archive is ordinary, private, and
reachable with one login, and the four credentials are typed fresh on the new
machine.

`npm run provision:node` prints all four as prompts and `npm run restore:node`
lists them at the end of every run, so there is no way to reach the end of a
rebuild without being told.

**The ssh key is replaced, not restored.** A new key is thirty seconds of work
and the old one should be revoked anyway once a machine is out of your hands.

---

## Where the backup is

A **private** GitHub repo: `mentor24-maker/alphire-node-backup`.

One folder per machine — `nodes/mac-mini/`, `nodes/macbook-pro/` — each holding a
`MANIFEST.md` and a `files/` folder. The manifest says what was captured, what
was **not** captured and why, and which branches had commits that existed only on
that disk.

Because it is a git repo rather than a folder of tarballs, every night's copy is
kept and you can look at any of them. "What changed on that machine the week it
broke" is a question a single overwritten backup cannot answer.

### It is checked, not assumed

Two things watch it:

```
npm run doctor:node      the BACKUP section — when was this machine last copied?
```

A machine that has never been backed up reports **FAIL**, not a quiet absence. A
backup older than three days reports FAIL. A stamp that was written by a
different machine — which is what a copied folder looks like — reports **CANNOT
TELL**, never a pass.

Three days rather than one, because the backup runs nightly and one missed run is
ordinary. Three consecutive misses is not.

The gap `doctor:node` cannot close is the obvious one: a machine that is switched
off cannot report that its own backup stopped. The cross-machine answer is the
commit history of the backup repo, which anybody can open from anywhere.

---

## The rebuild, in full

### 1. The hardware

Any Mac running current macOS. A Mac Mini is what the roles table expects, but
nothing in the system depends on the model — `lib/nodeRoles.js` cares about the
**name** in `~/.alphire-node`, not the hardware.

While it is being shipped, nothing is lost. The queue simply does not drain.

### 2. Before anything else: name it

```
echo mac-mini > ~/.alphire-node
```

One line, and it is the most load-bearing line on the disk. Every ownership
guard in the system reads it, and it deliberately does **not** fall back to
guessing from the hostname — a machine with no name runs no jobs and says so out
loud, which is correct and is also a machine sitting there doing nothing.

**Do not give the new machine the name of a machine that still works.** Two Macs
both believing they are `mac-mini` would both claim tickets, which is exactly the
race the whole roles table exists to prevent. `restore:node` refuses to write an
identity over a different existing one for this reason.

### 3. Homebrew and the Claude CLI

Both install by piping a URL into a shell. That is a decision with a person's
name on it, so no script here does it:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
curl -fsSL https://claude.ai/install.sh | bash
```

### 4. GitHub, which is the key to everything else

```
brew install gh git
gh auth login && gh auth setup-git
```

This is the one credential that has to exist before the restore can start,
because it is what fetches the backup.

### 5. The starcaster checkout

```
mkdir -p ~/WebApps && cd ~/WebApps
gh repo clone mentor24-maker/starcaster
cd starcaster && npm ci
```

### 6. The restore

```
npm run restore:node -- --node mac-mini
```

That is a **dry run**. It writes nothing and prints what it would do. Read it,
then:

```
npm run restore:node -- --node mac-mini --apply
```

It never overwrites. Anything already on the new machine that differs from the
backup is left exactly as it is, and the backup's copy is written beside it with
a `.from-backup` suffix and named in the output. Add `--verbose` to list every
file rather than counting them.

Two things it will tell you about rather than doing:

- **The scheduled jobs are copied, not started.** A plist on disk does nothing
  until it is loaded, and a half-built machine that starts relaying and claiming
  tickets is worse than one doing nothing. The `launchctl load` lines are printed
  for when the rest is verified.
- **Commits that existed only on the dead disk** are fetched into the matching
  checkout as branches, and nothing is merged. What to do with someone's
  unfinished work is a decision.

### 7. Everything else

```
npm run provision:node          # what it would change — read this first
npm run provision:node:apply    # do it
```

It installs the toolchain, clones the other three repos, sets up the Claude
memory folders, scopes Doppler, and prints the credentialed steps it is not
allowed to perform. Run it twice: the second run should report PASS on everything
the first one fixed and say plainly that it changed nothing.

### 8. The four logins

`provision:node` prints them. They are:

```
doppler login    then    doppler setup --project starcaster --config dev
gh auth login && gh auth setup-git      (already done in step 4)
claude                                  then sign in when prompted
ssh-keygen -t ed25519                   then add the public key to GitHub
```

And in every checkout and worktree:

```
npm run env:local
```

### 9. Prove it

```
npm run doctor:node
```

Then compare it against what the old machine said on its last good day. That
file is in the backup:

```
nodes/mac-mini/files/machine-report/machine-report.md
```

It holds the old machine's macOS version, Node version, hand-installed Homebrew
packages, which schedules launchd actually had loaded, where each checkout was,
and the complete `doctor:node` output. Anything that differs is something the
rebuild has not finished doing.

This is the step that turns "rebuild the Mini" from an act of memory into a
comparison, and it is the reason the machine report is in the backup at all.

### 10. Start the jobs, one at a time

```
launchctl load -w ~/Library/LaunchAgents/com.starcaster.bus-relay.plist
```

Start the relay first and watch a couple of its wake-ups before loading the rest.
It is the job that carries every other job's alarms, so a relay that works means
the next failure will announce itself rather than being found by accident.

Then confirm the roles actually came back after a restart:

```
npm run node:verify
npm run doctor:node
```

---

## What this plan does not cover, said plainly

- **It is not a disk image.** Photos, documents, downloads, application settings
  and anything else in the home folder are not in it. This covers the machine as
  a *node*, not as somebody's computer. If the Mini ever holds something personal,
  that needs a Time Machine drive, which needs a drive physically plugged into it.
- **It cannot rebuild a machine that has not been replaced.** Nothing here works
  remotely on a dead Mac. It works on a *new* Mac, from anywhere.
- **It does not restore the local Supabase database.** That is by design —
  `npm run db:refresh` rebuilds it from production, and production is the real
  copy. (Mind the disk-IO budget: weekly is the rhythm, and six runs in one day
  took every client site down on 2026-08-17.)
- **It does not hold the Tailscale identity.** The YouTube media worker is
  reachable over a Tailscale Funnel, and a new machine is a new Tailscale node.
  Sign in and re-enable the funnel; the URL changes, so anything pointing at it
  needs updating.

---

## Taking a backup by hand

It runs nightly on its own, hung on the bus relay's ten-minute wake and throttled
to once a day. To take one now:

```
npm run backup:node -- --dry-run     # what it would capture, writes nothing
npm run backup:node                  # take it and push it
npm run backup:node -- --local-only  # stage it and stop, without pushing
```

The dry run is worth reading occasionally even when nothing is wrong. It is the
answer to "what would I actually get back?", and that is not a question to first
ask on the morning you need it.

---

## Related

- `lib/nodeBackup.js` — the inventory, with the reason each item is on it
- `lib/nodeProvision.js` — what a node consists of
- `lib/nodeRoles.js` — which machine owns which job
- `docs/NODE_PROVISIONING.md` — standing a machine up
- `docs/DOCTRINE.md` §4.1 — the secrets boundary
