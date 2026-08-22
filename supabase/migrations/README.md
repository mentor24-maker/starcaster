# supabase/migrations — not the source of truth

**The schema source of truth is `docs/SQL/*.sql`, applied by hand**
(`docs/DOCTRINE.md` §7). This folder holds five files that were written in the
Supabase CLI's format and never applied anywhere. They are kept as history.

**Never run `supabase db push` or `supabase db reset --linked` here.** Both
write to the *cloud* database.

What to use instead:

| Question | Answer |
|---|---|
| What does production's structure actually look like? | `docs/schema/production.sql` |
| Has production moved away from that? | `npm run schema:check` |
| What has been applied, and when? | [`docs/MIGRATIONS_APPLIED.md`](../../docs/MIGRATIONS_APPLIED.md) |
| How do I get a local copy of production? | `npm run db:refresh` — see [`docs/LOCAL_DEVELOPMENT.md`](../../docs/LOCAL_DEVELOPMENT.md) |

This README used to point at `docs/MIGRATIONS_APPLIED.md`, which did not exist
for three months. It does now.
