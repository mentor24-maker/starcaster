# Turning on the two optional credential checks

Both features below ship **inert**. The code is live, but each stays switched
off until one manual step is done, and until then the app simply omits the
annotation rather than guessing. Neither can break credential verification: if
the setup is missing, the check it decorates still runs and still reports
normally.

Phase 3 of [CREDENTIALING_HARDENING_PLAN.md](CREDENTIALING_HARDENING_PLAN.md).

---

## 1. "Is this variable actually live?" — needs a Vercel API token

### What it does

When a credential fails and its value comes from an environment variable, the
check will name any variable that was **edited in Vercel after the running
deployment was built**:

> `X_ACCESS_TOKEN` was edited in Vercel AFTER this deployment was built, so the
> current value is not live yet. Redeploy to pick it up.

This is the exact failure that cost an hour on 2026-07-29. Vercel bakes
environment variables into a deployment at build time, so a dashboard edit does
not reach the deployment already serving traffic — "the value is wrong" and "the
value is right but not deployed" look identical from the outside.

Without the token you still get the fallback, which names the build:

> This value comes from an environment variable. If you changed it recently,
> redeploy. This deployment was built 2026-07-29T21:14:02Z (3 days ago),
> commit 0a83d71.

### Setup

1. Create a token at **https://vercel.com/account/tokens**. Read scope is
   sufficient — this only ever reads variable *names and timestamps*, never
   values.
2. Add it to Vercel → Project → Settings → Environment Variables:
   - `VERCEL_API_TOKEN` = the token
3. Add the same line to `.env.local` for local development.
4. **Redeploy.** (Yes — the feature that warns about this has the same
   requirement.)

Two optional variables, only needed if step 4 does not work:

| Variable | When you need it |
|---|---|
| `VERCEL_PROJECT_ID` | If the API answers 404. Vercel does not inject the project id at runtime, so the code falls back to the project *name* `starcaster`. Set this if the project was renamed. |
| `VERCEL_TEAM_ID` | If the API answers 403. Needed when the project lives under a team and the token is not already team-scoped. |

The reason for a failed lookup is reported in the check result, so you will see
`Vercel API returned 403: ...` rather than silence.

---

## 2. "Whose account is this?" — needs one SQL migration

### What it does

Every check already reports the account it authenticated as. This remembers it
between checks, so a silent change gets flagged:

> Heads up: these credentials previously authenticated as @dachristensen and now
> authenticate as @someone_else. If that was not deliberate, posts will go to
> the wrong account.

On a multi-tenant platform where each project posts as a different identity,
publishing to the wrong account is a real failure, not a cosmetic one — and
without memory, a token that quietly starts pointing elsewhere still reads as a
clean pass.

### Setup

Apply [docs/SQL/credential_identities.sql](SQL/credential_identities.sql) on
Supabase (SQL Editor → paste → Run). It creates one small table,
`app_credential_identities`, plus a unique index.

The table stores **no secret material** — only the account label and id the
provider itself hands back, e.g. `@dachristensen` / `18223886`.

Until it exists, `lib/credentialIdentityStore.js` treats every call as a no-op
and the response omits `identityDrift` entirely. It never reports
`changed: false` from a check that was not actually tracked, because that would
be a claim the data cannot support.

### Comparison rule

Drift compares the account **id** when both sides have one, falling back to the
label. A renamed Facebook Page therefore does not register as drift — same
account, new display name — while a genuinely different account does.
