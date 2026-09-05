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
| 2026-09-04 | `docs/SQL/messaging_tags_source.sql` | **Pending — not yet applied.** One tag table instead of two, task 86bbu4gdu. Adds `messaging_tags.source` (text, not null, default `''`) plus `idx_messaging_tags_project_source`, and carries over the per-project case-insensitive unique index `asset_tags` had and `messaging_tags` did not (`idx_messaging_tags_project_tag`). Additive only: one new column with a default and two indexes — no existing row is rewritten, and existing rows are **deliberately not backfilled** (`''` means "origin not recorded", which is the truth for every row that predates the column; same decision as `assets_source_column.sql`). The unique index is preceded by a `do $$` block that refuses with a readable message naming the clashing project and tag, rather than letting the index build fail with a raw constraint dump — the table already holds live rows, unlike `asset_tags`, which held none. Measured against a same-day mirror of production on 2026-09-04: 149 rows across two projects, 0 exact duplicates, 0 case-insensitive duplicates, 0 rows missing a tenant column — so the index applies cleanly. Idempotent — `add column if not exists` / `create index if not exists`, verified by running the whole file twice against the local database, and the duplicate guard verified by inserting a clashing row on purpose and watching it refuse. **`asset_tags` is NOT dropped here** — that is a separate file, run only once this is live and the 0-row count has been re-confirmed at that moment. **After applying, re-run `npm run schema:snapshot`**: the snapshot committed with PR #611 was taken before this file was applied, so it records `messaging_tags` without the column. |
| 2026-09-01 | `docs/SQL/asset_tags_setup.sql` | **Applied.** Creates `asset_tags` — the list of tags a project uses on its media, which the Media Manager module offers an admin to choose from. Per-asset tags already lived on `assets.tags`; what did not exist was a way to answer "which tags does this project use?" without scanning every row. One new table and nothing else: no existing table, row or code path is touched. Carries BOTH tenant columns (`project_id` + `owner_user_id`) per CLAUDE.md landmine 12, uniqueness per project and case-insensitive, and RLS on with no policies matching the 2026-08-17 lockdown. Idempotent — every statement is `if not exists`, verified by running it twice against the local database. Confirmed present in production on 2026-09-02 by a read-only catalog query (table, both tenant columns, both indexes, `relrowsecurity = t`) before PR #510 was merged. |
| 2026-09-01 | `docs/SQL/assets_source_column.sql` | **Applied.** Adds `assets.source` (text, not null, default `''`) plus `idx_assets_project_source`, so media uploaded through the Admin Media Manager can be found on its own inside the general gallery. Additive only: one new column with a default and one index — no existing row, column or code path is touched, and existing rows are **deliberately not backfilled** (`''` means "origin not recorded", which is the truth). Idempotent — `add column if not exists` / `create index if not exists`. Confirmed present in production on 2026-09-01 by a read-only `pg_dump --schema-only` of `public.assets`, which showed both the column and the index, before PR #502 was merged. |
| 2026-09-01 | `docs/SQL/events_setup.sql` | **Applied.** Creates `events` — one row per calendar event, for the Event Calendar modules (`event-manager`, `event-calendar`, `event-detail`). One new table and nothing else: no existing table, row or code path is touched. Carries BOTH tenant columns (`project_id` + `owner_user_id`) per CLAUDE.md landmine 12, and RLS on with no policies, matching the 2026-08-17 lockdown. Idempotent — every statement is `if not exists`, verified by running it twice. Confirmed present in production by `npm run schema:check` on 2026-09-01. |
| 2026-08-29 | `docs/SQL/project_connections_setup.sql` | **Pending — not yet applied.** Creates `project_connections` (a tenant's own OAuth grants, tokens encrypted at rest) and `project_connection_handoffs` (short-lived, for when one grant covers several postable accounts). Connections 1/7, task 86bbpz1d0. Two new tables and nothing else: no existing table, row or code path is touched, and nothing reads or writes either one until slice 2. RLS on with no policies, matching the 2026-08-17 lockdown. Idempotent — every statement is `if not exists`. |
| 2026-08-18 | `docs/SQL/starcaster_readonly_role.sql` (re-run) | **Pending.** PR #334 enabled row security on 65 more tables; the file must be re-run or those 65 copy across empty on the next `db:refresh`. Idempotent — adds the missing policies, changes nothing else. |
| 2026-08-16 | `docs/SQL/starcaster_readonly_role.sql` | Created the `starcaster_readonly` login and gave it read-only access, so `npm run db:refresh` can copy production down without being able to change it. Adds a login and read policies; touches no existing data. |

## Data repairs

**Not schema.** Rows changed on production by a script, rather than structure
changed by SQL. Kept here because this is where somebody looks when they ask
"why is production not what I expected?", and separate from the table above
because mixing the two would blur what that table means — nothing below alters
a column, an index or a policy.

The same discipline applies: a repair script is dry-run by default, is run in
both modes, and reads the rows back afterwards rather than trusting the write.

| Date | Script | What it changed |
|---|---|---|
| 2026-09-03 | `scripts/blog_backfill_slugs.cjs --project proj_1786047238296_opepjk --apply` | **Applied.** Gave an address to 5 of Delray's `blog_posts` rows that had a blank `slug`, deriving each from its title. All five were **published** posts written by hand between 2026-08-30 and 2026-09-01, and all five were unreachable the whole time: the public blog addresses a post by its slug, so the row existed, the manager listed it, and every link went nowhere (`docs/DOCTRINE.md` §5.25, ticket 86bbu23n7, PR #549). No other row was touched — the other 50 already matched the rule. Dry-run first, then `--apply`; verified by re-reading all 55 rows (0 blank, 0 non-conforming, 0 duplicate addresses) and by fetching three of the five back through the live public API. Idempotent: a second run finds nothing to do. The store now derives a slug on every write (`lib/slugify.js`), so this cannot recur. |

## Before this file existed

185 files in `docs/SQL/` predate this record, applied across several months
with no log. `docs/schema/production.sql` supersedes all of them as the
statement of what production *is* — it was taken from the live database, so it
reflects whatever was actually applied, including anything that was run and
never written down.

Do not try to reconstruct the history from those files. They are kept because
they document intent and because §6.5's handoff flow points at them, not
because replaying them would reproduce production.
