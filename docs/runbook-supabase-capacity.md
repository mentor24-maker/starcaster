# Runbook: every tenant site is down at once

**Written 2026-08-17, the morning after it happened.**

The symptom this runbook is for: **all** the client sites answering 404 or
hanging, at the same time, when nothing has deployed. On 2026-08-16 that was
`delraytennis.starcaster.pro` and `brandonmarinoff.com` together, for about two
and a half hours.

It is almost never the code. Code breaks one thing in one way. When everything
breaks the same way at the same moment, the database is not answering, and the
reason is usually a limit rather than a fault.

---

## 1. Confirm the shape (30 seconds)

```
curl -s -o /dev/null -w "%{http_code} in %{time_total}s\n" https://delraytennis.starcaster.pro/
curl -s -o /dev/null -w "%{http_code} in %{time_total}s\n" -L https://brandonmarinoff.com/
```

**What you are looking for is the timing, not the status code.** Both failing
after *the same* ~10 seconds means they waited on the database until
`lib/supabase.js` gave up. That is the fingerprint. Varied errors at varied
speeds would mean something else entirely.

Then ask the database directly:

```
doppler run --project starcaster --config prd -- bash -c \
  'curl -s -o /dev/null -w "%{http_code} in %{time_total}s\n" --max-time 25 \
   "$SUPABASE_URL/rest/v1/app_projects?select=id&limit=1" \
   -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"'
```

| Result | Meaning |
|---|---|
| `200` fast | The database is fine. Stop; the problem is elsewhere. |
| `000` after the full timeout | Nothing answered at all. |
| `522` | Cloudflare reached Supabase's edge; the database behind it did not answer. |

`000 → 522` is **progress**, not the same state twice. It means something you
changed is taking effect.

## 2. Read the meters before reading any code

Two independent limits can each produce "unresponsive", and they have different
fixes. Check both.

**Organization quota + spend cap** — `supabase.com/dashboard/org/<org>/usage`.
A red banner reading *"Your organization's usage has exceeded its included
quota"* means a spend cap is on: rather than bill the overage, Supabase
withholds service. Look for which single meter is over 100% — on 2026-08-16 it
was Storage Image Transformations at 131/100 while every other meter had
enormous headroom.

Disabling the spend cap starts a restore. **That is a billing decision and it
belongs to the operator** — an agent must not click it.

> ### Standing decision: the spend cap stays OFF
>
> **Decided by Dane on 2026-08-17.** The cap is disabled, so overages are
> billed and the sites keep serving.
>
> The name is misleading and the setting runs backwards from what it sounds
> like. A spend cap is **not** a spending limit — it is a service kill switch.
> Cap ON means Supabase refuses to bill past the included quota and restricts
> the database instead, which is what took `delraytennis.starcaster.pro` and
> `brandonmarinoff.com` down for two and a half hours on 2026-08-16. Cap OFF
> means the overage lands on the invoice and the sites stay up.
>
> The trade was priced before it was made: base plan $25/month, projected
> $31.08, so the overage the cap was "protecting" against was about **six
> dollars**. Two client sites returning 404s is not worth six dollars.
>
> **It has now flipped back TWICE, both on 2026-08-17.** Disabled during the
> 2026-08-16 incident; found *enabled* again at 4:57pm and disabled a second
> time; found *enabled* again that evening and disabled a third time. Nobody
> re-enabled it on either occasion.
>
> Twice is not a slip, it is a pattern, and the cause is unknown — a Supabase
> default reasserting itself, a plan-level rule, or something in the dashboard
> that re-applies the cap when another billing setting is touched. Until
> somebody finds out which, **treat the cap as a setting that turns itself back
> on.** Check it whenever you are in the billing page anyway, and check it first
> whenever a tenant site is unreachable — the fastest way to spend an hour on
> this is to assume it is still off because someone turned it off yesterday.
>
> **Read the dashboard before stating its state; never quote this file as
> evidence of what is live.** Dashboard → organization → Billing →
> **Cost Control**.
>
> **What this decision does not buy you.** The cap is not a cost control, and
> turning it off removes the only automatic ceiling that existed. There is no
> configurable billing-alert threshold in Supabase to replace it — the usage
> page and Supabase's own automatic quota emails are the whole safety net, and
> that email arrived two hours late during the outage. The bill is watched by a
> person, on purpose. Anyone reversing this decision is choosing client
> downtime over an unplanned charge, which is a call only the operator makes.

**Project Disk IO budget** — the project's own page, plus your email. Small
compute sizes (`t4g.nano`, Micro) run at a low baseline with a daily burst
budget on top. Spend the budget and the instance throttles to baseline, which
also reads as unresponsive. Supabase sends an email titled around *"depleting
its Disk IO Budget"*. On 2026-08-16 that email arrived two hours into the
outage and was the first thing that named the real cause — so check the inbox
early, not late.

## 3. If the restore stalls

The project page shows per-service health. Database, PostgREST, Auth and Storage
stuck on **Unhealthy** while Realtime and Edge Functions are fine means the
compute instance is up but Postgres has not come back. The dashboard says a
restored project can take "up to 5 minutes"; on 2026-08-16 it was still down at
20 and needed a manual restart.

**Settings → General → Restart project.** Then `Logs → Postgres` if it still
will not start.

## 4. Find what actually spent the IO

Once you are back up, in the SQL Editor. Read-only, instant:

```sql
select
  calls,
  round(mean_exec_time::numeric, 1) as avg_ms,
  shared_blks_read as disk_blocks,
  pg_size_pretty(shared_blks_read * 8192::bigint) as read_from_disk,
  round(100.0 * shared_blks_hit
        / nullif(shared_blks_hit + shared_blks_read, 0), 1) as cache_hit_pct,
  left(query, 140) as query
from pg_stat_statements
order by shared_blks_read desc
limit 20;
```

**Read the cache-hit column beside every row.** A query at 99.9% is served from
memory and is not your disk problem however bad it looks in the code. This is
the step that overturned a confident wrong diagnosis on 2026-08-16
(`docs/DOCTRINE.md` §1.6).

And check for bloat, which causes IO and is then made worse by it — an exhausted
budget starves autovacuum:

```sql
select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  n_live_tup as live_rows,
  n_dead_tup as dead_rows,
  case when n_live_tup > 0
       then round(100.0 * n_dead_tup / n_live_tup, 1) end as dead_pct,
  last_autovacuum
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 20;
```

A high `dead_pct` with an old or empty `last_autovacuum` is answered by
`vacuum (analyze) public.<table>;`.

---

## What it turned out to be, in the one case we have

`COPY "public"."<table>" TO stdout` — which is what `pg_dump` does — at the top
of the list, six calls per table. That is `npm run db:refresh` copying
production down to local, run six times in a day while the command was being
debugged. Around 85% of the window's disk reads, with the `assets` copy holding
IO for 50 seconds a call.

**The most IO-expensive thing anyone does to this database is dump it.** Not
visitor traffic — the sites are small. Keep the `STRUCTURE_ONLY` exclusion list
short, and do not iterate on dump tooling against production.

`npm run db:refresh` and `scripts/db_refresh.mjs` arrive with the `db-refresh`
branch, which was still unmerged when this runbook was written — so on `main`
that path does not exist yet. Its exclusion list and the reasoning behind it are
in `docs/LOCAL_DEVELOPMENT.md` on that branch.

## Known, still open

- **`observe_usage_logs` has no retention rule.** `routes/index.js` writes one
  row per API request — 17,631 in a single `pg_stat_statements` window. It grows
  forever and is already large enough to read almost entirely from disk (20%
  cache hit). This is the leak that returns on its own.
- **Compute is the whole variable bill.** Derived from the 2026-08-16 meters:
  about $0.0134 per instance-hour, roughly three instances running around the
  clock, so about $7 a week. Egress was at 27% of 250 GB and everything else was
  free. If the bill matters, the lever is how many projects are running, not
  traffic.
