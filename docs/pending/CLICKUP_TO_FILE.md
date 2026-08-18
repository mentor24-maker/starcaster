# Waiting to be filed in ClickUp

These tasks exist only here until someone files them.

**Why they are parked, corrected.** The first attempt read the claude.ai
connector's `Rate limit exceeded. Please wait 919 minutes` as ClickUp being
unavailable. PR #328 established that is the *connector's* rolling 24-hour
write budget, not ClickUp's — ClickUp's own API allows ~100 requests per
minute and was never blocked. `npm run clickup` goes straight at it and needs
only a personal API token in the terminal window
(`export CLICKUP_API_TOKEN=pk_...`), which is the operator's keystroke.

So these are waiting on a token, not on a clock.

**They are not a plan. They are the outstanding work**, written as tasks so
they can be pasted straight into the Starcaster **Loop Queue** list
(`901418546619`) with no rewriting.

Delete each block once it is filed.

---

## 0. URGENT — 65 tables would copy across EMPTY

**List:** Loop Queue · **Status:** Queued · **Priority:** Urgent

PR #334 enabled row-level security on 65 more tables. `starcaster_readonly`
has a read policy on the original 71 and none on the new 65, so
`npm run db:refresh` would copy those 65 across **empty**.

Step 7 of `db:refresh` compares every table against production and would
report it loudly rather than handing over a hollow database — that is the
design working — but the refresh is broken until the policies exist.

**The fix is already written and needs no code change.** Re-run
`docs/SQL/starcaster_readonly_role.sql`; it loops over every table with row
security on and is idempotent, so it adds the missing 65 and leaves the rest
alone.

This is the standing consequence of #334 rather than a one-off: **every future
change that enables row security on a table needs that file re-run**, or the
next refresh quietly loses those rows. Worth adding to whatever checklist
covers enabling RLS.

### Acceptance criteria

- `docs/SQL/starcaster_readonly_role.sql` re-run against production.
- The check at the bottom of it shows policies_created equal to
  tables_with_row_security.
- A `npm run db:refresh` completes with "Every table matches production
  exactly."

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

## 4. Doctrine: the empty-table trap

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
