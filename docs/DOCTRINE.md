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

### 2.4 One button, two possible meanings — ask, never pick

The 💾 on a Builder section could only do one thing: file a **new** saved
section. Its prompt asked for a name and nothing else. So the operator, who had
unlocked a shared section, edited it, and wanted the original updated, typed the
original's name — and got a second saved section carrying the same name while
the original sat untouched (2026-08-16). Both then appeared in the dropdown.

Nothing failed. No error was possible, because the code never knew there was a
second reading. That is the shape of it: the ambiguity is invisible from inside
the implementation, and obvious to the person holding the mouse.

**Do this:** when an action has two defensible readings, name both and make the
operator choose. Not a `window.confirm` with the second reading hidden behind
Cancel — both spelled out, with what each one touches. Where one branch reaches
beyond what is on screen, say how far **before** the click, not in the receipt
afterwards (`describeCanonicalOverwrite`, and the page list in
`BuilderSectionSaveModal`).

And when you find one of these, look for the destructive twin: the same dialog
that stops a duplicate is what stops an accidental overwrite of a section 40
pages depend on.

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

### 3.11 A survey that skips what it cannot read has not surveyed anything

Asked whether deleting a project would harm a sibling, a sweep of all 95
project-scoped tables reported "nothing anywhere is owned by the old
project" — and the delete then failed outright. The sweep was written as
`if (error) continue`, so nineteen tables were never actually checked, and
one of them was `dev_sessions`, whose `project_id` is the wrong TYPE. That
table was both the answer to the question and the reason the operation
broke, and it had been silently discarded.

The re-probe was nearly as misleading: a `HEAD`-style count request returns
no response body, so every one of those errors came back with an empty
message. "Error, but blank" reads as noise rather than a finding.

**Do this:** a sweep reports three numbers — checked, empty, and **could not
check** — and the third is never folded into the second (§3.2). When a
probe errors, print the code and the message before deciding it is
uninteresting, and re-issue it in a form that actually returns an error body.
An advisory given from a partial sweep should say which parts were partial.

### 3.9 The second run is a different program — run it before you believe the first

Reconciling the delraytennis import shipped three defects in one afternoon,
all invisible on the first run and all obvious on the second:

- The decisions file was rebuilt from the "still outstanding" list. A
  decision that WORKED moved its page off that list, so the file silently
  erased every call that succeeded — three operator decisions became zero
  between two identical commands.
- `createAsset` always inserts, and the blob copy it follows overwrites in
  place. Applying twice registered all 73 images a second time; nothing
  looked wrong anywhere except a library that had quietly doubled.
- The image step asked "is this photo already on the page?" while counting
  its own output, so a re-run would place nothing at all — freezing the page
  on whatever shape the first run happened to write.

**Do this:** anything that looks idempotent gets run twice and diffed
before it is believed. A record rebuilt from what is *outstanding* loses
what *succeeded* — rebuild from what is known and only ever add. An
"already present" test must exclude the thing you are about to write.

### 3.10 A write that normalizes to nothing looks exactly like a success

The reconcile runner passed the section list in the shape the database
COLUMN uses rather than the shape the serializer takes. The serializer does
not reject it: it reads no sections and writes an empty page. Fourteen
pages were emptied in one run, each one reporting "wrote 1 section", and
the only reason it was caught is that the database was checked instead of
the script's own output.

**Do this:** read the record back immediately after writing it and compare
it against what you sent — count and identity, not just "no error". Stop on
the first mismatch, before the next record is touched, and print the
restore command. A tool's own log is not evidence about the database.

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

- **The folder's own layout can leak into the hash.** esbuild stamps each
  bundled module's path into the output as a comment and resolves symlinks to
  their real location first, so a worktree whose `node_modules` was a symlink
  to the main checkout emitted `// ../../../node_modules/...` and pinned a hash
  no clean build could reproduce. On 2026-08-10 (PR #149) that failed CI on
  `richtext-vendor.js` and `bundle.js` — two artifacts the change never
  touched. **It was misdiagnosed as dependency drift first, and the wrong fix
  "worked" for the wrong reason** (`npm ci` happened to replace the symlink
  with a real folder). The tell is `ls -ld node_modules`, not `npm ls`; the
  installed tree was correct all along, and the ~97 packages that look missing
  in `node_modules/.package-lock.json` are optional other-platform binaries npm
  skips on macOS.

  **Do this:** every esbuild call shares `scripts/esbuild-common.mjs`
  (`--preserve-symlinks`), and each artifact has exactly one script owning its
  args — the same command spelled out in `package.json`, `dev.mjs` and
  `build_pinned_assets.mjs` is how a flag lands in one copy and not the others.
  `scripts/check_build_paths.cjs` enforces the **outcome** (no built artifact
  may reference a path outside the repo), so a new build script that forgets
  the shared settings is caught even though nothing checks for the flag itself.

On a merge conflict in `src/layout.html`, take the incoming file and rebuild.
Never resolve pins by hand.

**When CI rejects pins on files your change never touched, suspect the folder
before the change.** Run `npm run check:build-paths`.

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

### 5.10 The stores take arguments in an order that silently crosses tenants

Three separate ways to read the wrong thing, all of which return data
rather than erroring:

- `listPages(limit, scope)` takes the LIMIT first. `listPages(scope)` reads
  the scope as a limit and returns **every project's pages** — a survey of
  one tenant reported 185 pages for a project that has none.
- The stores return `{ ok, status, data }` envelopes, never the row. Reading
  `job.status` off the envelope yields `200`, so a complete job reads as
  status "200". Use a `must(res, what)` helper, as the other runners do.
- The page-document input is NOT the column's shape. `layoutSections` must
  be the ARRAY of sections; `{ sections: [...] }` is accepted and produces
  an empty page (§3.10). Spread the whole page — passing `layoutSections`
  alone silently resets `pageBackground` and `theme` to defaults.

**Do this:** check the signature before calling a store, unwrap through
`must()`, and for any multi-tenant read assert that what came back belongs
to the project you asked for.

### 5.11 A retired module name still works, which is why writing one is a bug

`slideshow` and `slider` merged into `carousel`; the old names stay in
`RETIRED_MODULE_TYPES` permanently so old documents keep loading. So a tool
that emits `slideshow` is accepted, renders correctly, and leaves the
document in a shape no current code writes — migrated on every single load
until someone happens to save the page. Nothing reports anything.

Worse, the folder's generated `lib/builder/template.js` predated the rename,
so the test passed locally and failed only in CI, which builds fresh.

**Do this:** assert that the type you emit survives the real serializer
UNCHANGED, rather than asserting a hardcoded name — that way the next rename
fails loudly instead of falling through the compatibility shim. And when a
test disagrees between here and CI, rebuild the generated artifacts first
(CLAUDE.md landmine 1); CI is the one with the honest copy.

### 5.12 A list endpoint with a hard cap and no offset cannot report the truth

`listAssets` capped at 2,000 rows with no way to page. The delraytennis job
recorded 2,067, so a caller reading the first page could not distinguish a
complete list from a truncated one — and would have quietly planned against
67 missing assets.

**Do this:** a capped list takes `{ limit, offset }` and callers page to
exhaustion. If a cap must stay, return enough for the caller to detect it.

### 5.13 Project ids are TEXT — a table that picks its own type breaks far more than itself

`dev_sessions_setup.sql` declared `project_id BIGINT` while every project id
on this platform is text (`proj_1780601126203_f3v0m1`). Postgres does not
return zero rows for that, it refuses the query — so the column broke two
unrelated things and neither pointed at it. Deleting **any** project failed,
because the purge walks every project-scoped table and returns the first
error; and scoping Ask Roger sessions to a project had never worked at all,
which nobody noticed because every row had a NULL project. The operator's
error message named a type, not a table.

**Do this:** new project-scoped tables use `project_id TEXT`, matching
`app_projects.id`. A routine that sweeps every table must survive one bad
table and say which one — dying on the weakest member makes the whole
operation impossible and names the wrong culprit. Report the defect rather
than skipping it silently, or the schema stays broken forever (§3.2).

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

### 6.5 SQL for the operator goes in the SQL handoff block, as a GitHub URL

**Enforcement: `scripts/hooks/require_sql_handoff.cjs` (Stop hook, blocking).**
If the branch adds a `docs/SQL/*.sql` and the reply does not carry the block
with that file's branch-qualified URL, the turn is refused and the ready-made
block is handed back. `npm run sql:handoff` prints it on demand. Tested in
`scripts/hooks/require_sql_handoff.test.js`, gated in CI by `npm run test:hooks`.

*Why this rule has a hook when most do not.* It was written down, binding, and
sitting in the file CLAUDE.md tells every agent to read first — and on
2026-08-14 an agent that had read it still handed over a repo-relative path,
the exact trap documented below. The rule did not fail because it was unclear;
it failed because nothing checked. This is the same lesson §2 records about the
UI standards that sat under "enforced in review" for months with no review step,
and the same one the 2026-07-22 template-swap fix taught the hard way: a rule
written in a document changed nothing, and the code shipped the bug again three
weeks later. **A doctrine entry that an agent must remember to apply is a hope,
not a control.** When a rule is mechanical, give it a checker.

**Standing instruction from the operator, 2026-08-12, given verbatim as a
template.** When he has SQL to run, do not print the statements. Emit exactly
this block and nothing else in its place — spaced exactly as shown here:


#################### RUN SQL IN SUPABASE ####################

[github url]

##########################################################


**Two blank lines above and below each SQL handoff block** (operator, 2026-08-12: "add
two paragraph breaks above and below each SQL set so they stand out clearly").
A single break lets the SQL handoff block sit flush against the sentence introducing it,
and in a long reply the block stops reading as a block — which is the one
thing it exists to do. Two breaks on each side, every time, including between
two consecutive SQL handoff blocks.

**Emit it as plain text, not inside a code fence** (operator, 2026-08-12:
"can you make that link clickable?"). A fenced block renders the URL as dead
text and he cannot click it — which defeats a handoff whose entire job is to
get him to that file. Outside a fence the terminal linkifies it, and a markdown
link works too.

The SQL handoff block itself survives being unfenced: an ATX heading takes at most six
`#`, so a run of twenty renders as the literal text it looks like. Do not
shorten the rules to six or fewer or they will turn into a heading.

The URL is the file on **its branch**, not on `main`:
`https://github.com/mentor24-maker/starcaster/blob/<branch>/docs/SQL/<file>.sql`

**Why a URL and not the SQL itself.** Applying SQL by hand is the one schema
step no agent can do here — the Supabase CLI on this machine has no access
token and the environment carries no Postgres connection string — so this block
is the entire handoff, and it has to be unmissable. A wall of pasted SQL buries
the ask inside the reply; the SQL handoff block is scannable in a long message and says
what to do with it in its own first line. He opens the URL and copies from
GitHub.

**The trap this replaced.** The first attempt handed over a repo-relative link
(`docs/SQL/assets_renditions.sql`). New files live on a branch inside
`.claude/worktrees/<topic>/`, and his editor is open on `main`, where the file
does not exist — the link resolved to nothing and cost a round trip. **Any link
to a file this session created is broken for him until the branch merges**,
which is exactly why the URL in the SQL handoff block must be branch-qualified. Check that
the branch is pushed before emitting the block.

**Also:**

- Still write the file to `docs/SQL/` — that is the schema source of truth (§7)
  — and to `supabase/migrations/` when it belongs there.
- Say in one line, outside the SQL handoff block, what it changes and whether anything
  existing is touched. "It only adds two new fields; it changes nothing that
  exists" is what tells him it is safe to run.
- One SQL handoff block per file. Two migrations means two SQL handoff blocks, in run order.

**The general rule behind it:** he has told us the shape he wants a handoff in.
When he gives a template verbatim, reproduce it exactly rather than improving
it — the point is that it looks the same every time, so he can find it without
reading.

### 6.6 Never spend an operator decision on something already decided

**Enforcement: `scripts/hooks/explain_denied_commands.cjs` (PreToolUse on Bash,
blocking).** A command forbidden by a standing `deny` rule is blocked with the
rule quoted and its settings file named, before the permission system produces
its own ambiguous refusal. Tested in
`scripts/hooks/explain_denied_commands.test.js`, gated by `npm run test:hooks`.

**The incident.** 2026-08-14: a rebase needed `git push --force-with-lease` and
the call was refused. The refusal reads *"Permission to use Bash with command X
has been denied"* — which is word-for-word what you get whether he clicked "no"
once or forbade it permanently. The agent guessed "one-off", asked him to
choose, and he approved it. **The approval could not take effect**:
`Bash(git push --force*)` sits on the deny list in `~/.claude/settings.json`.
An operator decision was spent on a question already answered, and the answer
was unactionable. The alternative — merge `main` in instead of rebasing — needed
nothing from him and had been available the whole time.

**The rule.** Before asking him to approve anything, establish whether it is
already decided. A standing rule outranks an in-the-moment yes, so a question
that a rule has pre-empted is pure cost: it spends the one resource he says is
scarcest, and it cannot change the outcome.

**And do not reword around a deny rule.** Reaching the same effect through a
spelling the pattern misses is not cleverness, it is overriding a decision he
made deliberately. If there is genuinely no other route, say the rule exists,
name it, and let him change the *rule* — a config change he makes on purpose,
not a per-occasion bypass.

*Why this is doctrine and not judgement:* §6.4 already says his bottleneck is
attention, not willingness. Asking about a settled question is the same waste as
surfacing a chore for approval, minus even the possibility of a useful answer.

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
