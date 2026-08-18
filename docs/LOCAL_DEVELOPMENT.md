# Working locally

Build and check things on your own machine, then push. Production stops being
where you find out whether something works.

## The two commands

```
npm run doctor      # what is up, what is stale, which database am I on
npm run db:refresh  # make my copy match production (about two minutes)
npm run db:use      # which database am I on? (add `local` or `cloud` to switch)
```

`doctor` and a bare `db:use` are read-only and always safe to run. `db:refresh`
replaces your local database and refuses to run against anything that is not
localhost.

## Switching databases

```
npm run db:use          # just tells you which one you are on
npm run db:use local    # your own machine
npm run db:use cloud    # the live database - asks first
```

It rewrites only the three settings that choose the database, leaving the other
seventy-odd lines of `.env.local` exactly as they were, and it reads the file
back afterwards to confirm the switch actually took.

**The values are fetched, never stored.** Local settings come from
`supabase status`, cloud settings from Doppler `prd`, both asked at the moment
of the switch. Nothing can go stale, and no production credential is written
into a file this repo maintains. The old `.env.local.cloud-backup` and
`.env.local.localdb-backup` files are what this replaces - hand-maintained
copies that drifted silently and told you nothing about which was active.

**`cloud` makes you type the word `production`,** not press `y`. The whole
point of this setup is moving work off production; a switch that costs nothing
to flick is one that gets flicked absent-mindedly.

**`npm run dev` refuses to start against the live database.** Nothing used to
ask - a checkout left pointing at the cloud started up looking exactly like a
local one, and the first clue was a change appearing on a client's site. If you
genuinely need it, `ALLOW_CLOUD_DEV=1 npm run dev`. Having to type that is the
control.

The strip across the top of the admin app tells you the same thing at a glance,
and all three - banner, switcher and guard - decide "is this local?" with the
same shared function (`lib/environmentBanner.js`), so they cannot drift apart
about the one question the whole setup rests on.

A normal session:

```
npm run thread my-topic   # new folder + branch, already carrying your settings
npm run doctor            # anything to fix before starting?
npm run dev               # http://localhost:3001
npm run ship              # checks, pull request, merge, cleanup
```

Log in locally as your own address with the password `localdev123`.
`db:refresh` sets that every time; it applies only to your copy.

## What `db:refresh` does

1. Copies production's structure and content down, over a **read-only** login
2. Wipes the local `public` schema and rebuilds it from that copy
3. Replaces every real person's contact details with generated ones
4. Restores your login
5. Compares **all 136 tables** against production and reports any that differ

There is deliberately no command going the other way. Local is a scratch copy.

### What is deliberately NOT copied

Six tables come across empty — structure only. They held 260 MB of the
415 MB dump, and the connection died partway through `training_corpus` on the
first real run. Excluding them took the copy from fifteen minutes and failing
to about two and succeeding.

| Table | What it holds |
|---|---|
| `training_corpus` | AI training material |
| `builder_page_snapshots` | page history |
| `builder_page_revisions` | page history |
| `observe_usage_logs` | analytics |
| `acquire_youtube_comments` | harvested comments |
| `observe_page_views` | analytics |

`observe_page_views` was added on 2026-08-17, after the production database
spent an evening unresponsive from an exhausted Disk IO budget. It is a pure
log with no local value, and `pg_stat_statements` showed its `COPY` running on
every one of that day's six refresh runs. **Every table left on this list costs
production disk IO each time anyone refreshes** — that is the reason to keep the
list short, over and above the copy being faster (see `docs/DOCTRINE.md` §1.5).

Nothing needed to build a page. The tables still exist, so code that queries
them works — it just finds them empty. Working on one of those features?
Take it off `STRUCTURE_ONLY` in `scripts/db_refresh.mjs` and expect a slower,
more fragile copy.

### What is scrubbed

Row counts, project links and field settings stay real, so the screens look
right and tenant separation still gets exercised. Only the values identifying
an actual person are replaced.

`contacts` · `people` · `crm_contacts` · `leads` · `app_invitations` ·
`contact_project_invitations` · `app_project_admin_users` ·
`app_project_support_requests` — names, emails, phones, social handles,
submitted form data.

Platform logins (`app_auth_users`): your account keeps working with
`localdev123`. Every other account gets a generated address and a password
hash that matches nothing, so no one else's credentials — even hashed — sit
on a laptop.

**A failed scrub is reported as a failure, never skipped.** A half-scrubbed
table is the worst outcome, because it looks done.

## Knowing what production's structure is

```
npm run schema:check      # has production moved away from the recorded structure?
npm run schema:snapshot   # bring the record up to date after applying SQL
```

`docs/schema/production.sql` is a committed record of what production's
structure actually is. It is a **record, not something to run**.

It exists because on 2026-08-16 nobody could state what production's schema
was: 185 hand-run files in `docs/SQL`, five in `supabase/migrations` never
applied anywhere, and a README pointing at a tracker that did not exist. The
local copy was thirteen days adrift and no tool could say by how much.

**How schema changes ship has not changed** — `docs/DOCTRINE.md` §6.5 and §7:
the SQL goes in `docs/SQL/`, reaches you as a GitHub URL, you apply it in the
Supabase editor. What is new is the record and the check, so *"did something
reach production without being written down?"* became a question with an
answer. Log what you apply in [`MIGRATIONS_APPLIED.md`](MIGRATIONS_APPLIED.md)
and re-snapshot afterwards.

`schema:check` is read-only and cheap — structure only, no contents — so unlike
`db:refresh` it costs production almost no disk IO.

## The production credential

`db:refresh` reads production through `starcaster_readonly`, a login that
holds `SELECT` and nothing else. It cannot write even if the script tried, and
the script asks Postgres whether it can write before doing anything —
rather than attempting a write to find out, which would put a junk table in
production on exactly the run where the credential turned out to be wrong.

Its permissions live in [`SQL/starcaster_readonly_role.sql`](SQL/starcaster_readonly_role.sql).
That file is idempotent: **re-run it after adding tables**, or the new ones
arrive empty (see below).

The connection string lives in Doppler as `PROD_DB_READONLY_URL` in the `dev`
config, and `npm run db:refresh` fetches it from there.

**The password never goes in a file, a chat window, or a command argument.**
To set or rotate it:

```
openssl rand -hex 24 | pbcopy
```

In the Supabase SQL editor, type `alter role starcaster_readonly with password ''`,
click between the quotes, paste, Run. Then:

```
printf 'postgresql://starcaster_readonly.<project-ref>:%s@<pooler-host>:5432/postgres' "$(pbpaste)" \
  | doppler secrets set PROD_DB_READONLY_URL --project starcaster --config dev --no-check-version
printf '' | pbcopy
```

Three passwords were burned on 2026-08-16 learning this: two through a
scratch file an editor was sharing, one through a connection string passed on
a command line where `ps` printed it. The script now passes credentials as
environment variables for that reason.

## Row-level security, and the empty-table trap

71 tables have row-level security switched on. Under it, granting a login
permission to read a table is **not enough** — without a policy naming that
role, it sees an empty table rather than an error.

That is worse than a failure, because it looks like success: a copy of
production that silently contains nothing. `pg_dump` refuses to dump an
RLS-protected table at all unless told to proceed, which is the only reason
this surfaced rather than shipping a hollow database.

So `db:refresh` passes `--enable-row-security`, which is correct **only**
while every RLS table carries a read policy for `starcaster_readonly`. Step 7
compares every table's row count against production and calls out any that
arrived empty. The guarantee is not "this cannot happen" — it is **"this
cannot happen quietly."**

If a table reports as empty, re-run the SQL file above; it adds a policy for
any table that lacks one.

**Every time row security is switched on for a table, that file must be
re-run.** PR #334 enabled it on 65 more tables on 2026-08-18; until the file
is re-run, all 65 copy across empty. `db:refresh` reports it rather than
handing over a hollow database, but the refresh stays broken until the
policies exist. Treat "enabled RLS on a table" and "re-ran
`starcaster_readonly_role.sql`" as one step, not two.

## What local still will not tell you

- **Custom domains.** Localhost skips host binding, so tenant sites on their
  own domains can only really be checked live.
- **Scheduled jobs.** The timed social publish runs on Vercel. Locally you can
  trigger it by hand; the schedule does not exist.
- **Posting to X, Instagram, Bluesky.** There is no fake version of those.
  Anything that publishes, publishes for real, from your laptop.
- **Email is the exception, and a win.** The local stack runs a mail catcher
  at <http://127.0.0.1:54424>. Password resets and invitations land there
  instead of in real inboxes, so you can test the whole flow without sending
  anything.

## When something is wrong

Run `npm run doctor` first. It reports each thing separately and hands back
the command that fixes it — and a check it could not run reports "cannot
tell" rather than a pass, because with Docker down the schema is not fine,
it is unknown.

**The database container stays dead after Docker is force-quit.**
`supabase start` reports "already running" and stops. Start the database on
its own first, then cycle:

```
docker start supabase_db_starcaster
supabase stop && supabase start
```

**Two worktrees cannot both use port 3001.** The first one started wins and
the others fail silently, so a browser check can be driven against another
thread's code. Give each folder its own port:

```
PORT=3057 node server.js
UI_HARNESS_BASE_URL=http://localhost:3057 npm run check:panels
```
