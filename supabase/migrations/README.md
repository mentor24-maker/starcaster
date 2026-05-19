# Supabase migrations (optional CLI path)

**Authoritative SQL today:** `docs/*.sql` in the repo root.  
**Operator tracker:** [`docs/MIGRATIONS_APPLIED.md`](../docs/MIGRATIONS_APPLIED.md)

StarCaster does not yet run `supabase db push` in CI. Apply scripts in the Supabase SQL editor and log them in `MIGRATIONS_APPLIED.md`.

If you adopt Supabase CLI later:

1. Copy finalized `docs/NNN_*.sql` files here with timestamp prefixes.
2. Keep `docs/MIGRATIONS_APPLIED.md` in sync with what ran in each environment.
3. Never treat `ai-daemon/sandbox/isit-app/docs/` as a source of truth.
