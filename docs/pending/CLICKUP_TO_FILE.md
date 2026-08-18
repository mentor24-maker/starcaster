# Waiting to be filed in ClickUp

ClickUp refused every write on 2026-08-17 and again on 2026-08-18 with
`Rate limit exceeded. Please wait 919 minutes` — roughly 15 hours from the
second attempt. These tasks exist only here until someone files them.

**They are not a plan. They are the outstanding work**, written as tasks so
they can be pasted straight into the Starcaster **Loop Queue** list
(`901418546619`) with no rewriting.

Delete each block once it is filed.

---

## 1. `ship` reports failure on runs that succeeded

**List:** Loop Queue · **Status:** Queued · **Priority:** High

### What is wrong

`npm run ship` said "The checks did not pass, so nothing was merged" on three
consecutive runs (#309, #330, #332). All three had merged. The operator was
told his work had failed while it was live.

Two separate causes, both in `scripts/ship_thread.cjs`:

1. **It polls for CI before GitHub has registered the run.** A fresh push has
   no checks attached for a few seconds; ship reads that as "no checks
   reported" and treats it as failure rather than as "not yet".
2. **It exits non-zero on success.** The last step removes the worktree it is
   standing in, so the shell's final `pwd` fails with
   `getcwd: cannot access parent directories`.

There is also a `fatal: 'main' is already used by worktree` line printed
during the merge step of every successful run.

### Why it matters more than it looks

The operator does not read the whole log; he reads the last line. A tool that
cries wolf on success teaches him to ignore its failures, which is the one
thing it exists to tell him. He has already had to be told twice in one
session to check the PR rather than believe the output.

### Acceptance criteria

- A run whose checks pass exits `0` and says so.
- Checks that have not appeared yet are waited for, not failed. Distinguish
  "no checks yet" from "checks reported failure".
- No `fatal:` line on a successful merge.
- `scripts/builder/shipThread.test.js` covers the not-yet-registered case.

### Test steps

Ship any small branch and confirm the last line reflects reality, then
`echo $?` and confirm `0`.

---

## 2. Two ship runs at once corrupt each other

**List:** Loop Queue · **Status:** Queued · **Priority:** Normal

### What is wrong

Running `npm run ship` while another is still going produced:

```
error: cannot lock ref 'refs/remotes/origin/main': is at a1893cc0 but expected 9de22967
```

Both were fetching at the same time. Nothing was damaged, but the second run
stopped in a way that reads like repository corruption.

Easy to hit, because task 1 makes a successful ship *look* failed, so the
natural response is to run it again.

### Acceptance criteria

- A second `ship` in the same repository detects the first and stops with a
  plain-English message naming what is already running.
- Not a lock file left behind by a crash — check for a live process.

---

## 3. A worktree cannot pick its own port

**List:** Loop Queue · **Status:** Queued · **Priority:** Normal

### What is wrong

Every worktree's `npm run dev` wants port 3001. The first wins; the rest fail
silently, so a browser check can be driven against another thread's code and
reported as yours. `CLAUDE.md` documents this and tells you to pass `PORT=`
by hand, which means remembering.

Hit twice on 2026-08-16 and again on 2026-08-18, the second time while
verifying the environment banner — the check ran against a different
worktree's server and returned `Not found`.

### Acceptance criteria

- `npm run dev` picks a free port when 3001 is taken and prints the URL it
  actually bound.
- It says which folder owns the port when it steps aside.
- `UI_HARNESS_BASE_URL` guidance in `CLAUDE.md` updated to match.

---

## 4. 32 worktrees, several finished

**List:** Loop Queue · **Status:** Queued · **Priority:** Low

`git worktree list` shows 32 folders. Several are merged and idle; several
hold unshipped commits. `npm run tidy` will not touch anything with unmerged
work, so this is safe, but it needs a person to look at what is genuinely
still live.

### Acceptance criteria

- `npm run map` output reviewed with the operator.
- Merged worktrees removed; branches with real work listed with what they hold.

---

## 5. Doctrine: the empty-table trap

**List:** Loop Queue · **Status:** Queued · **Priority:** Normal

### What to add

`docs/DOCTRINE.md` has no entry for the failure that dominated 2026-08-16:

**Row-level security turns a permission failure into an empty result.** A
login granted `SELECT` on a table with row security on, but no policy naming
it, sees an empty table rather than an error. A copy of production that
silently contained nothing would have looked like a successful refresh.

`pg_dump` refused rather than dumping partial data, which is the only reason
it surfaced. The generalisation is worth writing down: **a filter that
excludes everything and a query that finds nothing are indistinguishable from
the outside** — the same shape as `if (error) continue` giving a false
all-clear (§3.11) and as a check that cannot run reporting a pass.

Reference `scripts/db_refresh.mjs` step 7, which compares all 136 tables
against production, and the standing rule that follows: when a query can
return empty for two different reasons, the tool must say which.
