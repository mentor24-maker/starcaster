# What has actually been applied to production

`supabase/migrations/README.md` has pointed at this file since May. It did not
exist until 2026-08-18, which is a fair summary of the problem: schema changes
were applied by hand, and the only record that one had happened was that it
worked.

**How schema changes ship here** is unchanged, and is described in
`docs/DOCTRINE.md` §6.5 and §7: the SQL goes in `docs/SQL/`, reaches the
operator as a GitHub URL, and he applies it in the Supabase SQL editor. Nothing
in this repo applies SQL to production, and nothing should.

**What this file adds** is the third step that was missing — writing down that
it happened. Add a row when you apply something. It takes ten seconds and it is
the difference between a schema anyone can reason about and one nobody can.

## The record of production's structure

`docs/schema/production.sql` is a snapshot of what production's structure
actually is, taken by `npm run schema:snapshot`. It is a **record, not
something to run** — nothing applies it.

```
npm run schema:check      # has production moved away from the record?
npm run schema:snapshot   # bring the record up to date after applying something
```

`schema:check` is read-only and cheap — structure only, no table contents, so
unlike `db:refresh` it costs production almost no disk IO. Run it when you
suspect drift, and after applying anything.

**If `schema:check` reports a difference nobody expected, that is the point of
it.** It means SQL reached production without being recorded. Find what did it,
add the row below, and re-snapshot.

## Applied

Newest first. One row per file actually run against production.

| Date | File | What it did |
|---|---|---|
| 2026-08-30 | `docs/SQL/project_connections_setup.sql` | **Applied by Dane 2026-08-30, verified read-only the same day:** both tables present, 21/21 and 8/8 columns, zero rows, and — the one that matters — `select=project_id,owner_user_id` passes on both. That is the probe `lib/projectScope.js` runs to decide whether to stamp a tenant; a table failing it gets NEITHER column stamped, silently, and its rows land belonging to nobody (landmine 12). Slice 2 is unblocked. Creates `project_connections` (a tenant's own OAuth grants, tokens encrypted at rest) and `project_connection_handoffs` (short-lived, for when one grant covers several postable accounts). Connections 1/7, task 86bbpz1d0. Two new tables and nothing else: no existing table, row or code path is touched, and nothing reads or writes either one until slice 2. RLS on with no policies, matching the 2026-08-17 lockdown. Idempotent — every statement is `if not exists`. |
| 2026-08-18 | `docs/SQL/starcaster_readonly_role.sql` (re-run) | **Pending.** PR #334 enabled row security on 65 more tables; the file must be re-run or those 65 copy across empty on the next `db:refresh`. Idempotent — adds the missing policies, changes nothing else. |
| 2026-08-16 | `docs/SQL/starcaster_readonly_role.sql` | Created the `starcaster_readonly` login and gave it read-only access, so `npm run db:refresh` can copy production down without being able to change it. Adds a login and read policies; touches no existing data. |

## Before this file existed

185 files in `docs/SQL/` predate this record, applied across several months
with no log. `docs/schema/production.sql` supersedes all of them as the
statement of what production *is* — it was taken from the live database, so it
reflects whatever was actually applied, including anything that was run and
never written down.

Do not try to reconstruct the history from those files. They are kept because
they document intent and because §6.5's handoff flow points at them, not
because replaying them would reproduce production.
