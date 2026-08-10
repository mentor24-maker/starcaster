# Doctrine

Rules that earned their place. Every one below traces to a specific incident in
this repo, and each is written with the evidence attached — because a rule
without its story gets deleted by the next person who finds it inconvenient.

This is not a style guide. It is the set of things that cost hours, and what to
do instead.

Companion documents: `CREDENTIALING_HARDENING_PLAN.md` (what was built),
`CREDENTIAL_CHECKS_SETUP.md` (turning the optional checks on),
`runbook-credential-rotation.md` (rotating a leaked secret).

---

## 1. Diagnosis

### 1.1 "Nothing changed" is a real answer — check the environment first

**Incident (2026-07-29).** A tweet failed with `X auth failed (OAuth 1.0a):
Unauthorized`. An hour went into the tokens. The tokens were fine. Production
was running a deployment built *before* the good `X_*` values were in place.

Vercel bakes environment variables into a deployment **at build time**. Editing
one in the dashboard does not touch the deployment already serving traffic. So
"the value in Vercel is wrong" and "the value in Vercel is right but not
deployed" look identical from outside.

**Do this:** when a credential works in one place and fails in another, compare
*when the deployment was built* against *when the variable was last edited*
before suspecting the code or the token. `lib/buildInfo.js` reports the former;
`lib/vercelEnvAudit.js` the latter.

**Corollary:** after any Vercel environment-variable change, redeploy. The
change is invisible until you do.

### 1.2 Verify against the live system; do not reason from the code

Every genuine defect in the credentialing work surfaced by *running* code, not
reading it. Three of them were introduced during that same work:

| Defect | Would reading have caught it? |
|---|---|
| Rate-limit guard inverted, endpoint returned nothing at all | No — the line read correctly |
| `400 → MISSING` mislabelled an expired YouTube key as "not configured" | No — the mapping looked sensible |
| Facebook verified against global env values, though its credentials are per-project | No — required knowing the data |

The same pass found an **expired YouTube API key** nobody was looking for.

**Do this:** exercise the real path — call the endpoint, drive the route
handler, hit the provider. "It should work" is not evidence.

### 1.3 Query the specific resource before declaring a platform broken

**Incident.** GitHub's `/actions/runs` listing showed no run for a branch, so it
looked like CI was not firing; a PR was closed, reopened, and given an empty
commit to force it. The runs had existed the whole time — the *general* listing
was stale, while the workflow's own endpoint (`/actions/workflows/ci.yml/runs`)
showed both completed successfully.

**Do this:** when an API result seems impossible, check a second, narrower
source before acting on the first.

### 1.4 Distinguish "never configured" from "rejected"

A `401` proved production *had* four X values and the provider refused them,
which ruled out "someone forgot to set them" in one step. That distinction is
what localised the bug.

Every client must separate its own pre-flight guard (nothing entered) from a
provider's rejection (entered, refused). They send the operator to completely
different places.

**Careful:** the translation is direction-specific. Our clients return HTTP 400
from their own guard, so 400 means MISSING *for our results*. External providers
also return 400 for a value they refuse — YouTube answers an invalid API key
that way. Translating centrally sent the operator hunting for a value that was
already set. See the comment in `codeFromHttpStatus()`.

---

## 2. Error messages

### 2.1 A confident wrong message is worse than a bare error code

The old X client appended the same advice to **every** failure:

> StarCaster uses OAuth 1.0a user context (four fields from the same X app)…
> Do not put an app-only Bearer token in Access Token.

For the 2026-07-29 failure, every sentence was wrong. It read as authoritative
and sent an hour in the wrong direction. A bare `401 Unauthorized` would have
been more useful, because it would have prompted a look rather than a wild goose
chase.

**Do this:** classify first, advise second. If the cause cannot be determined,
say what happened and stop. `lib/credentialErrors.js` holds the vocabulary;
clients supply the cause-specific fix only when they know it.

Two tests exist purely to keep this honest — they assert the code does **not**
volunteer bearer-token advice or portal steps when it cannot classify a failure.

### 2.2 Say what to do, in terms of the thing the operator touches

Compare:

- ✗ *"Cron credentials differ from session — deploy cursor/promote-social-cron-publish-fix"*
- ✓ *"scheduled posts would fail… Check the `X_*` environment variables on Vercel Production, then redeploy — env var edits do not reach the running deployment until you do."*

Branch names, internal flags, and function names mean nothing to the person
holding the problem.

### 2.3 Name the specific thing, not the category

*"If you changed it recently, redeploy"* invites a guess. *"This deployment was
built 2026-07-29T21:14:02Z (3 days ago), commit 0a83d71"* can be checked against
what you actually did.

---

## 3. Designing checks

### 3.1 A registry, never a chain of branches

`runConnectionOpsTest` picked between providers with an eight-arm `if/else`
whose `else` threw *"No test handler for this platform yet"*. Buffer and YouTube
were both configured and live; neither had an arm, so neither could be tested at
all. **30 providers were configurable, 8 testable.**

The structural fix — a provider → verifier registry (`lib/credentialVerify.js`)
— took that to **17 of 30**, and adding a provider is now a row rather than a
new code path.

**Do this:** when a feature must cover a set that grows, make membership data.
A chain of branches silently omits whatever nobody remembered to add.

### 3.2 "Cannot check" is a third outcome — never a pass, never a failure

Telegram's old test only confirmed the fields were *filled in* and never
contacted Telegram, so it passed with a bogus token. That is worse than no test,
because it manufactures confidence.

`NOT_VERIFIABLE` is therefore its own result, rendered distinctly in the UI, and
the message says *"presence of the values was checked, not validity."*

**Do this:** if you did not verify something, do not let the output look like
you did.

### 3.3 Degrade to silence, never to a false negative

Identity drift and env staleness both shipped *before* their prerequisites (a
SQL migration, an API token) existed. The rule that made that safe:

- A missing prerequisite yields **no annotation at all**.
- `changed: false` is never reported from a check that was not tracked — "we did
  not look" and "nothing changed" must not be the same output.
- A missing token reports **why**, with hints for the 403 and 404 cases, so it is
  diagnosable rather than mysteriously quiet.

### 3.4 Bookkeeping must never break the thing it decorates

Both annotators swallow their own failures. A credential test that errored
because a drift-tracking table was missing would be a worse bug than the one
drift tracking prevents.

**Do this:** decoration is subordinate. If the extra fails, the primary result
still stands.

### 3.5 Report identity — "as whom", not just "it worked"

On a multi-tenant platform where each project posts as a different account,
"authenticated successfully" is half an answer, and publishing as the wrong
identity is a real failure rather than a cosmetic one.

Every verifier returns `identity` where the provider will name it. For plain API
keys it stays `null` rather than inventing a label — a fabricated identity is
worse than admitting there is none.

This also pays off where accounts have drifted before: the Google Drive check
names the Google account the token acts as, which is exactly where the
token-holding account and the folder-owning account have differed.

### 3.6 Errors block; heuristics never do

`lib/credentialShape.js` splits its rules deliberately:

- **error** — unambiguous. A line break inside a secret, `.env` quotes, a `...`
  truncated preview, a masked placeholder, an app-only Bearer token in the X
  access-token field. These block the save.
- **warning** — a guess about format. *"Anthropic keys usually start with
  `sk-ant-`."* These never block.

Providers change their key formats. Refusing to save a valid key because our
pattern went stale would be a worse failure than the one being prevented.

### 3.7 Strict rules only where they are unambiguous

The "secrets never contain spaces" rule is correct — and applying it to every
field would flag Reddit's `user_agent`, Google Drive folder names, and account
display names, all of which legitimately contain spaces. The rules key off the
schema's `secret` flag.

**Do this:** before enforcing a rule, find the legitimate input that breaks it.

### 3.8 Report one defect once

A newline is whitespace, so a naive pass reported both "contains a line break"
and "contains a space" for one problem. A quoted key also fails the prefix check
*because* of the quotes. Both send the operator after a second, non-existent
problem — so errors suppress warnings for the same value, and the space rule
matches spaces and tabs only.

---

## 4. Secrets

### 4.1 Agents never handle live secret values

Standing rule. Agents write rotation and diagnostic tooling; the operator runs
the command that touches the real value. `scripts/diagnose_x_auth.js` follows
this: it prints lengths and first/last four characters, never a value.

### 4.2 Reveal one field, on demand, and log it

The Settings form used to prefill every secret, so opening it pulled live
credentials into the browser — including ones existing only as production
environment variables.

Now: values are masked; `GET /api/settings/apis/:provider/reveal/:field` returns
**one** field per call (revealing an API key should not also hand over the secret
beside it), rate limited, and written to the activity log.

### 4.3 Masking and blank-means-keep are only correct as a pair

Once the form stopped round-tripping secrets, a blank field had to mean "keep
what is stored" rather than "clear it". Without that pairing, saving one changed
field would silently wipe every other secret. Clearing is a deliberate DELETE.

**Do this:** when you stop sending data to a form, immediately ask what the
form's *absence* of data now means on submit.

### 4.4 Rate-limit anything that calls outward on a click

Verification is 20/minute, reveal 10/minute. A human clicking needs a handful;
anything enumerating needs many. Hammering a provider's API can also trip
*their* limits and make a working integration look broken.

---

## 5. This codebase

### 5.1 `checkEndpointLimit` returns `true` when it has ALREADY blocked

```js
if (checkEndpointLimit(req, res, 'key')) return true;   // correct
if (!checkEndpointLimit(req, res, 'key')) return true;  // endpoint is now dead
```

The inverted form bailed out of every normal request and wrote nothing at all —
HTTP status 0, empty body. Caught only by driving the endpoint.

### 5.2 A bare `setInterval` in a required module hangs every test

`lib/rateLimiter.js` held one, which kept the Node event loop alive forever. Any
test that required a route — directly or transitively — never exited. Now
`.unref()`'d: cleanup still runs under a server, where the HTTP listener holds
the loop open.

**Do this:** `.unref()` module-level timers in anything a script may import.

### 5.3 `$?` after a pipe is the pipe's exit code

`npm run typecheck | tail -5; echo $?` reports `tail`'s status, not `tsc`'s. Redirect
to a file and check the real code, or the gate is theatre.

### 5.4 Asset pins: rebuild to resolve, never hand-edit

`?v=` hashes come from built files. Two specific traps:

- **`npm ci`'s postinstall can leave a bundle in a transient state**, so the
  first `build:assets` afterwards pins a hash a clean build does not reproduce.
  Run it twice; if the value changes, the first was noise.
- **A locally-built bundle hash must not be committed** — it ships a
  cache-buster nobody can reproduce (landmine 8).

On a merge conflict in `src/layout.html`, take the incoming file and rebuild.
Never resolve pins by hand.

### 5.5 Tests must not depend on ambient state

Two tests broke on ambient conditions, not on defects:

- One asserted a missing-token reason, but ran in a checkout with no build
  stamp, so a different guard fired first. The fix was to reorder the code —
  report the missing **token** first, because that is the part the operator must
  supply, while the stamp is written by every deploy.
- One assumed a provider was unconfigured; a later slice made it verifiable.

**Do this:** make such tests skip explicitly, or remove the dependence.

### 5.6 A budgeted crawl must spend its budget on what the site links to

Site Import captured 42 of delraytennis.com's pages and still missed every
page in the client's own menu. The sitemap was seeded first and a WordPress
sitemap index lists all 110 blog posts ahead of the 20 real pages, so a
15-minute browser budget went entirely to posts. The site looked imported;
every menu item led to "Coming soon" (2026-08-09).

**Do this:** when a budget decides how much of a job gets done, order the
work by importance before the budget starts spending. A site's own
navigation is its statement of what matters — capture that first, sitemap
backlog second.

### 5.7 Only the post-redirect URL can dedupe a page

`/Fees`, `/course/fees/`, and `http://…/contact-us/directions` are three
distinct URLs a queue cannot merge; the server merges them by redirecting.
Capturing each one separately imported the same page three times, the
copies slug-suffixed `-imported`.

**Do this:** dedupe captures on the URL the browser actually landed on
(`finalUrl`), not the one requested — and check it before doing any work
that the duplicate would waste.

### 5.8 "First match wins" silently picks the wrong one once there are two

`--nav` wrote the imported menu to "the first saved section with a
navigation module". Saved sections list newest-updated first, so a
half-built spare header created that morning outranked the header all 42
pages actually carried. The write succeeds, the site does not change, and
nothing reports a problem.

**Do this:** when several records could match, rank by what the system
actually references (page reference counts), not by list order or name.
Log the choice and the runners-up, and give the operator an explicit
override flag.

### 5.9 "Invisible" is a computed style, not a zero-size box

Every imported Delray page opened with "Skip to primary navigation Skip to
main content". Screen-reader-only text is hidden by *clipping* it, which
leaves the layout box intact — so the capture's width/height test called it
visible, and once the import dropped the source CSS it became ordinary body
copy.

The fix has a sharp edge worth keeping: it drops **only** the clip
techniques (`clip: rect(1px…)`, `clip-path: inset(50%)`). `display:none`
and off-screen positioning look equally "invisible" and are how themes park
dropdown submenus until hover — dropping those would delete the imported
site's menu. The smoke test asserts both halves: sr-only text goes, a
`display:none` submenu stays.

**Do this:** when filtering out what a visitor "cannot see", enumerate why
each thing is hidden. Hidden-forever and hidden-until-interaction are
opposite cases wearing the same costume.

---

## 6. Working in this repo

### 6.1 One worktree per thread, and trust nothing about the working directory

The shell's working directory can silently reset between commands. A relative
path therefore ran against the wrong folder mid-task.

**Do this:** use absolute paths, or re-assert the directory in the same command.
Verify with `git status` in **both** folders before concluding where an edit
landed.

### 6.2 Catch up `main` before merging, and read what the conflict tells you

A conflict is information, not an obstacle. When `main` had replaced the eight-arm
chain that a branch was editing, the right resolution was not to re-home the
branch's addition but to **delete it** — the newer phases covered the same ground
better, and its warning could not even fire in production. Resolving a conflict
mechanically would have preserved dead weight.

### 6.3 State results, not intentions

`CLAUDE.md`'s definition of done is the standard: run the gates and report what
they printed. "It should work" is not done. Passing commands are done.

### 6.4 Housekeeping is the agent's job — do it quietly

**Standing instruction from the operator, 2026-08-08, verbatim:**

> *"Count me as 100% on board with any and all housekeeping tasks along the
> way. I'm a big fan of cleaning up after ourselves as we go. I just don't
> have the brain power to manage it myself, so again, I'm asking you to just
> deal with all those chores as quietly and efficiently as possible without
> bringing me into it unless I am doing something wrong to actively cause a
> problem, in which case, make me aware of it as soon as possible and explain
> to me clearly and completely what I did wrong and how it is causing a
> problem."*

This is blanket authorization, and it is also a constraint on what gets said
out loud. Both halves bind.

**Do, without asking and without narrating:**

- Remove worktrees whose PR is merged; prune stale branches.
- Resolve the recurring `?v=` asset-stamp conflicts (they are generated
  stamps, not real overlap — catch up `main`, rebuild, move on).
- Rebuild generated artifacts a fresh worktree is missing.
- Delete scratch files, temp scripts, and one-off fixtures the work created.
- Catch a branch up to `main` before merging.
- Keep docs in step with the code in the same commit (§ CLAUDE.md).

Report these in a clause, not a section. "Cleaned up the three merged
worktrees" is the right size. A paragraph explaining *how* worktrees work is
not — he has been told, and repetition reads as condescension.

**The one thing that earns an interruption:** the operator is actively doing
something that is causing a problem. Then tell him **immediately**, and in
full — what he did, what it is breaking, and how to undo it. Do not soften it
into a hint, and do not save it for the end of a long report.

Everything else is a chore. Chores are silent.

**Corollary — do not ask him to adjudicate your own uncertainty.** Bringing
him a decision he has no basis to make is a chore in disguise. If two
approaches differ only in taste, pick one and say which. Reserve questions for
choices that are genuinely his: money, clients, what ships, what the product
should do.

*Why this is doctrine and not a preference:* he directs this project but is
not a career programmer, and his stated bottleneck is attention, not
willingness. Every chore surfaced for approval spends the scarcest resource he
has on something he has already said yes to.

---

## 7. Operator-facing gotchas

Worth knowing before they cost an hour.

| Symptom | Cause | Fix |
|---|---|---|
| Credential right in Vercel, still failing live | Env vars bake in at build time | Redeploy |
| Google API key: `Requests from referer <empty> are blocked` | HTTP-referrer restriction on a key used **server-side** — a server sends no `Referer` | Application restrictions → None; restrict by **API** instead. Allow ~5 min to propagate; no redeploy needed |
| `supabase start` prints no keys | Postgres was SIGKILLed (unclean Docker shutdown) | `docker start supabase_db_starcaster`, let it recover, then `supabase stop` && `supabase start`. Run `supabase stop` before shutting down the Mac |
| X: "API key expired" / 401 after months of working | X invalidates tokens on password change, permission edits without regenerating, or key regeneration | Regenerate the Access Token **and** Secret; permissions must be Read and Write *before* generating |

**Local database:** `supabase/migrations/` is **not** the schema source of truth
— it holds three files. `docs/SQL/*.sql`, applied by hand, is. Never run
`supabase db push` or `supabase db reset --linked` here; both write to the cloud
database.
