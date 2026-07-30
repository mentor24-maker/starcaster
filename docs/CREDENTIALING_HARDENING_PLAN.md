# Credentialing hardening plan

**Branch:** `credentialing-hardening` · **Written:** 2026-07-29 · **Status:** proposed, nothing implemented

## Where this came from

On 2026-07-29 a tweet to @dachristensen failed in Promote with:

```
X auth failed (OAuth 1.0a): Unauthorized  StarCaster uses OAuth 1.0a user
context (four fields from the same X app). In developer.x.com open your app
→ User authentication settings → generate Access Token and Access Token
Secret (Read and Write). Do not put an app-only Bearer token in Access Token.
```

Every sentence after "Unauthorized" was wrong for this failure. The tokens were
correctly shaped, from the same app, and not Bearer tokens. Diagnosis took about
an hour and needed a purpose-written script (`scripts/diagnose_x_auth.js`) to
establish four things the product should have said itself:

1. the code hadn't changed,
2. the stored credentials hadn't changed,
3. the credentials were valid and belonged to the intended account, and
4. therefore the failure was environmental, not a bad token.

The actual cause: production was running a deployment built before the good
`X_*` values were in place. Editing an environment variable in the Vercel
dashboard does **not** affect the deployment already serving the site — it
takes a redeploy. Filling in an unrelated field (`X_ACCOUNT_NAME`, which is
display-only and not part of the OAuth signature) triggered that redeploy, so
the fix appeared to be about the account name. It wasn't.

**None of the underlying weaknesses are X-specific.** This document lists them
and proposes an order for fixing them.

## What the codebase actually looks like today

Measured on `origin/main` at commit `667a05b`, not estimated:

| | Count | Notes |
|---|---|---|
| Providers defined in `API_SCHEMAS` (`lib/apiSettings.js`) | 30 | the full credential surface |
| Providers with credentials actually set | 15 | `supabase, anthropic, brave, openai, gemini, meta, instagram, bluesky, threads, openclaw, youtube, buffer, x, google_drive, resend` |
| Providers with **no** credentials set | 15 | `exa, linkedin, discord, substack, medium, reddit, tiktok, mastodon, pinterest, telegram, slack, whatsapp_business, google_business_profile, google_custom_search, transcriptapi` |
| Platforms with a "Run Test" button (`PLATFORM_SPECS` in `lib/connectionOpsStore.js`) | 8 | `x, facebook, facebook_personal, instagram, threads, telegram, reddit, bluesky` |
| `auth-test` HTTP endpoints in `routes/engage.js` | 6 | x, bluesky, facebook, facebook-personal, threads, instagram |

Cross-referencing the two middle rows is the headline finding:

> **10 of the 15 live integrations have no way to check whether their
> credentials work.** `supabase, anthropic, brave, openai, gemini, openclaw,
> youtube, buffer, google_drive, resend` can only be verified by triggering the
> feature and interpreting whatever raw error comes back.

Three of the eight testable platforms (`telegram`, `reddit`) aren't even
configured, so the test coverage is aimed partly at integrations nobody uses.

## Findings to generalize

### 1. Environment-variable edits silently don't apply

Vercel bakes env vars into a deployment at build time. Changing one in the
dashboard leaves the running deployment untouched. Nothing in StarCaster's UI
says this, and it applies to **all 30 providers** — every secret in the system
has this trap in front of it. This single fact cost the hour.

### 2. Two credential sources, silent precedence

`getProviderValues()` (`lib/apiSettings.js:367`) merges a file store
(`data/api_settings.json`, gitignored) over environment variables — Settings
wins, env is fallback. Locally both exist; in production the file is
unwritable so it's always empty and env always wins. The operator has no
indication which source is in effect at any moment. The per-field source data
already exists (`getProviderCredentialDiagnostics`, returns `env | file |
missing` per field) but is only surfaced for X.

### 3. Error messages hard-code a single cause

`lib/xClient.js:343` appends the same "don't paste a Bearer token" advice to
*every* failure, including revoked tokens and clock skew. A message that
confidently describes the wrong cause is worse than a bare error code: it sends
the reader somewhere useless with full confidence. Worth auditing the other
clients for the same pattern before assuming X is unique.

### 4. "Not configured" vs "rejected" is inconsistent

`xClient` distinguishes them (400 with a "credentials are missing" message vs
401 from the API). `blueskyClient` and `redditClient` do the same. `telegramClient`
has no missing-credential guard at all. That distinction is what localized this
bug — a 401 proved production *had* four values and X refused them, which ruled
out "someone forgot to set them." Every client needs it.

### 5. Nothing validates credential shape

No provider checks for the failure modes that actually happen when a human
pastes a secret: surrounding whitespace, wrapping quotes, a truncated copy, a
newline in the middle, or the right-looking value in the wrong field (an
app-only Bearer token in `access_token` is the classic). `diagnose_x_auth.js`
checks all of these; nothing in the product does.

### 6. Authentication success doesn't confirm *which account*

`X_ACCOUNT_NAME` was empty and nothing noticed or cared. The access token
embedded account id `18223886`, and only a live API call revealed that was
@dachristensen. On a multi-tenant platform where each project posts as a
different identity, "authenticated successfully" without "as whom" is half an
answer — and publishing to the wrong tenant's account is a serious failure, not
a cosmetic one.

### 7. The cron/session credential split is X-only, and a no-op in production

`routes/engage.js:1163` sets `credOpts = req?.cronPublish ? { envOnly: true } : {}`
and passes it **only** to `xClient`. Every other platform ignores the
distinction. And because the file store is always empty in production, merged
and env-only resolve identically there — so this special-casing changes nothing
in prod and only alters local behaviour. It looks like a fix for a problem
whose real cause was elsewhere (compare the deployment-staleness issue above).
Either make it uniform across clients or remove it; leaving it is a false
signal for the next reader.

### 8. Raw secrets are sent to the browser

`getApiConfig()` (`lib/apiSettings.js:708`) returns `values` — the actual
secrets, unmasked — and `public/js/settings.js:1520` prefills the edit form
with them. This is presumably deliberate, so the form shows current values, but
it conflicts with the repo's own rule (`CLAUDE.md` landmine 7) and means
production secrets held only in env vars are readable through the admin API.
Needs a decision, not necessarily a change.

### 9. A test route that cannot work

`GET /api/settings/apis/:provider/test` (`routes/settings.js:252`) calls
`testApiProviderConfig`, which is imported at line 15 but **exported by
nothing** — `typeof` is `undefined` at runtime, so the route throws a 500.
Nothing in the UI calls it. Its existence is why "there's already a test in API
Settings" is believed; the working test is the separate Connection Ops one.

### 10. Diagnostics existed but were unreachable

The infrastructure is better than the experience. `getProviderCredentialDiagnostics`
is already **provider-agnostic** and returns exactly what an operator needs —
per-field source, masked preview, env var names, and whether Vercel is the
runtime. It's just never exposed for anything but X. Most of Phase 2 below is
wiring, not building.

### 11. Removing the Promote buttons left Buffer with no UI check

Branch `promote-test-buttons` (separate work, same day) removed the
fixed-provider "Test Connection" and "Buffer Diagnostics" buttons from Promote:
Social, because they tested X and Buffer regardless of which of the eight
destinations was selected. The X capability survived — its session-vs-cron check
moved into the Settings X test. Buffer's did not: `/api/promote/social/buffer/status`
and `bufferClient.checkAuth` still exist, but nothing in the UI calls them.
Buffer is configured and live, so this is a real gap that Phase 2 closes.

## Plan

Ordered by (value to the operator) ÷ (risk of breaking something live). Each
phase is independently shippable; stop after any of them and things are better
than before.

### Phase 1 — Stop lying in error messages (small, self-contained)

1. **Make the X hint conditional on the actual cause.** Use the numeric code
   from the v1.1 endpoint (32 = signature/mismatched app, 89 = token
   invalidated, 64 = app suspended, 326 = account locked) as
   `scripts/diagnose_x_auth.js` already does, and say the matching sentence.
2. **Add the redeploy warning wherever an env-sourced credential fails.** One
   sentence: "This value comes from an environment variable. If you changed it
   recently, redeploy — dashboard edits don't reach the running deployment."
   This is the highest-value sentence in the whole plan.
3. **Delete the dead `/test` route** (finding 9). Deleting beats implementing:
   Connection Ops already does the job.
4. **Create `lib/credentialErrors.js`** — one shared vocabulary of failure
   kinds: `missing`, `malformed`, `rejected`, `insufficient_scope`,
   `rate_limited`, `suspended`, `stale_deployment`. Each maps to an
   operator-facing sentence *and* the fix. Clients return a code; the UI renders
   the sentence. No more per-client prose.

*Risk: low. No behaviour change to publishing, only to message text.*

### Phase 2 — One verification path for every provider — **DONE**

Delivered in three slices on branch `credential-verify`. Verifiable providers
went from 8 to 17; the ten live integrations that could not be checked at all
now can. Identity reporting arrived here rather than in Phase 3, because a
verifier that already has the account name in its response should not throw it
away. What actually shipped, and what it cost:

- `lib/credentialVerify.js` — provider → verifier registry, one result shape.
- `GET /api/settings/apis/:provider/diagnostics` (all 30 providers) and
  `GET /api/settings/apis/:provider/verify` (rate limited, 20/min).
- A working Test Connection button on the Settings > APIs form, reaching every
  provider in the dropdown.
- Telegram's check now contacts Telegram. It previously only confirmed the
  fields were filled in, so it passed with a bogus token.
- `NOT_VERIFIABLE` is a third outcome, never shown as a pass or a rejection.

Three bugs found by running the registry against live providers rather than
reading the code — worth remembering as a method, not just as fixes:

1. `400 → MISSING` was right for our clients' pre-flight guard and wrong for a
   provider's response. YouTube answers an invalid key with 400, so an expired
   key read as "not configured".
2. Facebook was verified against global env values though its credentials are
   per-project, so a working Page reported as broken.
3. The rate-limit guard was inverted, which left the new endpoint dead on
   arrival, answering nothing at all.

Also fixed on the way: `lib/rateLimiter.js` held a bare `setInterval` that kept
the Node event loop alive forever, so any test touching a route hung. Now
`.unref()`'d.

**Live finding for the operator: the YouTube API key is expired** — "API key
expired. Please renew the API key." It reports as configured and fails on use.

Remaining gap: `exa, linkedin, meta, discord, substack, medium, tiktok,
mastodon, pinterest, slack, whatsapp_business, google_business_profile,
google_custom_search, transcriptapi` still have no verifier. None currently has
credentials set, so nothing is silently broken; they report honestly as
not-checkable until someone configures them.

#### Original plan for this phase

5. **Expose the generic diagnostics** at `GET /api/settings/apis/:provider/diagnostics`
   for all 30 providers, backed by the existing `getProviderCredentialDiagnostics`.
   Masked previews, per-field source, env var names, runtime. This is wiring.
6. **Give every client a uniform `verify()`** returning
   `{ ok, code, identity: { label, id } | null, checkedAt, detail }`. Start with
   the clients that already have `checkAuth` (x, bluesky, reddit, buffer,
   telegram, meta family) by adapting their return shape, then add the 10
   unverifiable ones (finding: `supabase, anthropic, brave, openai, gemini,
   openclaw, youtube, buffer, google_drive, resend`). Most are a single cheap
   authenticated GET.
7. **Replace the if/else chain** in `runConnectionOpsTest`
   (`public/js/settings.js:1904`, eight hand-written branches) with a registry
   lookup. Adding a provider then means adding a row, not another branch —
   which is why Buffer and YouTube never got one.

*Risk: medium — touches every client. Do it client-by-client, each with its own
commit, so a regression is one revert.*

### Phase 3 — Make the invisible visible — **DONE**

Delivered on branch `credential-staleness` in two slices. Item 8 had already
landed in Phase 2 (every verifier reports the connected identity), so the work
here was *remembering* it plus the deployment-staleness half.

**Slice 1 — the running build is now named.** Vercel exposes the commit at
runtime but no build timestamp, so `scripts/write_build_stamp.mjs` records one as
the first step of `npm run build` (the command Vercel runs) into a gitignored
`lib/build-stamp.json`. The redeploy warning went from "if you changed it
recently" — which invites a guess — to naming the deployment: *"This deployment
was built 2026-07-29T21:14:02Z (3 days ago), commit 0a83d71."* Also on
`/diagnostics` as `deployment`, so build age is visible without a failure.

**Slice 2 — two annotations, both inert until switched on.** Setup:
`docs/CREDENTIAL_CHECKS_SETUP.md`.

- *Identity drift* (`lib/credentialIdentityStore.js`, needs
  `docs/SQL/credential_identities.sql` applied) remembers the last verified
  account per project+provider and flags a change. Compares on account id where
  available so a renamed Page is not mistaken for a different account. Stores no
  secret material.
- *Env staleness* (`lib/vercelEnvAudit.js`, needs `VERCEL_API_TOKEN`) asks the
  Vercel API when each variable was last edited and names any edited after the
  build. That is the difference between "the value is wrong" and "the value is
  right but not deployed" — indistinguishable from outside, and the actual cause
  of the incident that started this plan. Reads names and timestamps only.

The design constraint that mattered most: **degrade honestly.** Both ship before
their prerequisites exist, so a missing table or token yields no annotation
rather than a false negative — `changed: false` is never reported from a check
that was not tracked. Both annotators swallow their own failures, because a
credential test that broke over a missing bookkeeping table would be worse than
the bug it prevents. And a missing token reports *why*, with hints for the 403
and 404 cases, so it is diagnosable rather than silent.

#### Original plan for this phase

8. **Report the connected identity everywhere.** Every `verify()` returns "as
   whom." Store the last verified identity per project per provider; when it
   changes, say so plainly: "This token now posts as @other, not @dachristensen."
9. **Surface deployment staleness.** Show the running deployment's build time
   next to env-sourced fields. When an env var's last-modified date is newer
   than the running build, warn: "changed after this deployment was built —
   redeploy to apply." This turns the hour-long bug into a visible banner.
   `vercel env ls` exposes names and modification dates without values.

*Risk: low-medium. Additive. Needs a Vercel API token with read scope — the
operator provisions it; agents don't handle live secrets.*

### Phase 4 — Catch bad values at save time — **DONE**

`lib/credentialShape.js` inspects a value for the paste mistakes that actually
happen. Two severities, and the split is the point: **errors** are unambiguous
(a line break in a secret, a value wrapped in .env quotes, a `...` preview, a
masked placeholder, an app-only Bearer token in the X access-token field) and
block the save; **warnings** are heuristics ("Anthropic keys usually start with
`sk-ant-`") and never block, because a provider changing its format must not
lock the operator out of saving a valid key.

The Bearer-token rule is the one the old X error message asserted on *every*
failure regardless of cause. It is now checked at the one place it can be true.

Strict whitespace rules apply to **secret fields only** — Reddit's `user_agent`
legitimately contains spaces, as do Drive folder names and display names.

Also applied to *resolved* values in `getProviderCredentialDiagnostics` as
`shapeProblems`, which is the half that reaches production: an env var set in
the Vercel dashboard never passes through the save path.

#### Original plan for this phase

10. **Validate shape on save**: trim, reject embedded whitespace and wrapping
    quotes, flag wrong-token-type patterns (`AAAA…` in an OAuth 1.0a token
    field), sanity-check length per provider, and warn when a field looks
    truncated. Cheap, and kills a whole category of support.
11. **Generalize the diagnostic script** — `scripts/diagnose_x_auth.js` →
    `scripts/diagnose_credentials.js <provider>`, driven by the same registry.
    The operator runs it; it prints no secret values, only shapes and verdicts.

### Phase 5 — Secret exposure — **DONE** (decision: reveal on demand)

Operator chose reveal-on-demand over both alternatives (leave as-is / never
send secrets), keeping the ability to read a value back while getting secrets
out of the page by default.

`getApiConfig` now masks secrets and reports `hasValue` per field. The real
value comes from `GET /api/settings/apis/:provider/reveal/:field` — one field
per call, rate limited to 10/minute, and written to the activity log as
`settings.api_secret_revealed`. It is the only endpoint that returns a
plaintext secret.

This forced a change to save semantics: a blank secret field now means "keep
what is stored" rather than "clear it", since the form no longer round-trips
values. Without that, saving one changed field would wipe every other secret.
Use DELETE on the provider to clear credentials deliberately.

#### Original plan for this phase

12. Stop returning raw secrets from `getApiConfig` (finding 8). Prefill the form
    with masked placeholders and treat a submitted placeholder as "unchanged."
    This is a small code change with a real UX cost — you can no longer read
    back a value you forgot. **Dane decides**, and the answer may reasonably be
    "leave it."

## Suggested first move

Phase 1 alone, as one pull request. It is a few hours, carries almost no risk,
and item 2 (the redeploy sentence) directly prevents a repeat of the incident
that started this. Phase 2 is the structurally important one, but it touches
every integration and deserves its own thread and its own careful review.

## Deliberately not in scope

- **Rotating any live secret.** Standing rule: agents write rotation tooling;
  the operator runs the command that touches the real value.
- **`CHANNELS_ENCRYPTION_KEY`.** Blanked after the 2026-07-13 exposure and never
  finished rotating; `rotate_channels_encryption_key.js` exists and has not been
  run. Related but a separate job, and it blocks the Channels page independently.
- **Migrating credential storage to Supabase.** Defensible (it would end the
  file-vs-env split outright) but a much larger change than this plan, and it
  belongs with the `FABLE_OVERHAUL_PLAN.md` phases.
