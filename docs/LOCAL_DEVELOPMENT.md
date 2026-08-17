# Working locally

Build and check things on your own machine, then push. Production stops being
where you find out whether something works.

## The two commands

```
npm run doctor      # what is up, what is stale, which database am I on
npm run db:refresh  # make my copy match production (about two minutes)
```

`doctor` is read-only and always safe to run. `db:refresh` replaces your local
database and refuses to run against anything that is not localhost.

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

Five tables come across empty — structure only. They held 260 MB of the
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
