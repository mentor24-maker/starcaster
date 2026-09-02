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

**Standing drift, 2026-09-01: 212 items, and the snapshot was NOT re-taken.**
Applying `events_setup.sql` was the occasion for a `schema:check`, and it found
production 212 items away from the record — of which exactly two are the events
table and its trigger function. Re-snapshotting would have quietly blessed the
other 210, which is the opposite of what this file is for: a snapshot taken to
record one change would have erased the evidence of everything else nobody has
explained. The events migration is recorded above; the snapshot stays stale on
purpose until somebody accounts for the rest.

## Applied

Newest first. One row per file actually run against production.

| Date | File | What it did |
|---|---|---|
| 2026-09-01 | `docs/SQL/assets_source_column.sql` | **Applied.** Adds `assets.source` (text, not null, default `''`) plus `idx_assets_project_source`, so media uploaded through the Admin Media Manager can be found on its own inside the general gallery. Additive only: one new column with a default and one index — no existing row, column or code path is touched, and existing rows are **deliberately not backfilled** (`''` means "origin not recorded", which is the truth). Idempotent — `add column if not exists` / `create index if not exists`. Confirmed present in production on 2026-09-01 by a read-only `pg_dump --schema-only` of `public.assets`, which showed both the column and the index, before PR #502 was merged. |
| 2026-09-01 | `docs/SQL/events_setup.sql` | **Applied.** Creates `events` — one row per calendar event, for the Event Calendar modules (`event-manager`, `event-calendar`, `event-detail`). One new table and nothing else: no existing table, row or code path is touched. Carries BOTH tenant columns (`project_id` + `owner_user_id`) per CLAUDE.md landmine 12, and RLS on with no policies, matching the 2026-08-17 lockdown. Idempotent — every statement is `if not exists`, verified by running it twice. Confirmed present in production by `npm run schema:check` on 2026-09-01. |
| 2026-08-29 | `docs/SQL/project_connections_setup.sql` | **Pending — not yet applied.** Creates `project_connections` (a tenant's own OAuth grants, tokens encrypted at rest) and `project_connection_handoffs` (short-lived, for when one grant covers several postable accounts). Connections 1/7, task 86bbpz1d0. Two new tables and nothing else: no existing table, row or code path is touched, and nothing reads or writes either one until slice 2. RLS on with no policies, matching the 2026-08-17 lockdown. Idempotent — every statement is `if not exists`. |
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
