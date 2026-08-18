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
