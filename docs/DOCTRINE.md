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

### 1.5 A whole site failing uniformly is capacity, not code

**Incident (2026-08-16).** Both client sites started answering 404. Nothing had
deployed. The shape of the failure was the diagnosis: **every** request failed,
**identically**, after **the same ~10 seconds** — which is `lib/supabase.js`'s
own timeout expiring, not a route being wrong. A code defect produces variety;
a capacity limit produces uniformity.

Two separate throttles were involved, and they are easy to confuse:

1. **Organization quota + spend cap.** The org had exceeded its included quota
   on one meter (Storage Image Transformations, 131 of 100). With a spend cap
   enabled, Supabase does not bill the overage — it makes projects
   **unresponsive**. Removing the cap starts a restore.
2. **Project Disk IO budget.** Small compute sizes get a daily burst budget over
   a low baseline. Spend it and the instance throttles to baseline, which reads
   as unresponsive too. Supabase emails about this one; the email arrived at
   8pm, two hours after the outage began, and was the first thing that named
   the real cause.

Removing the spend cap did not fix it, because the second limit was also hit.
The project needed a restart, and the restore took far longer than the
dashboard's "up to 5 minutes".

**Do this:** when everything fails the same way at the same latency, check the
platform's own meters and email before reading any code. The distinguishing
observation is the *timing*: identical failures at exactly your client
timeout mean the dependency never answered.

**Careful:** `000` (nothing answered) and `522` (edge answered, origin did not)
are different states, and the change from one to the other is evidence that
something you did is taking effect. Do not read them as the same outage.

### 1.6 Rank queries by disk reads before optimizing anything for IO

**Incident (2026-08-16).** Chasing the disk IO above, code reading produced a
confident and wrong answer. Every public page view really does read *all* of a
project's pages with their full layout JSON and discard all but one — measured
at 2.83 MB across 95 pages on Delray. It looked like the leak. It was named as
the leak, with a recommendation to change how publishing works on two live
client sites.

`pg_stat_statements` disproved it in one query. That statement sat 14th, with a
**99.9% cache-hit rate and 2 MB** read from disk across 626 calls: it lives in
RAM and barely touches the disk. The actual top consumers were
`COPY "public"."<table>" TO stdout` — `pg_dump` — from six runs of
`npm run db:refresh` against production while that command was being debugged.
Roughly 85% of the window's disk reads, and the `assets` copy alone held IO for
50 seconds a call.

**Do this:** before optimizing for IO, rank by `shared_blks_read` in
`pg_stat_statements` and read the cache-hit column beside it. A query with a
99.9% hit rate is not your disk problem, however wasteful it looks on paper —
and the real answer may not be product traffic at all. See
`docs/runbook-supabase-capacity.md` for the query.

**Corollary:** a payload measurement is not an IO measurement. Bytes on the
wire and blocks off the disk are different numbers with different causes, and
2.83 MB of JSON crossing the network says nothing about whether it came from
cache.

### 1.7 A quota that blocks writes but not reads looks exactly like an outage

**Incident (2026-08-17).** Five ClickUp writes failed in a row with "Rate limit
exceeded. Please wait 1171 minutes" — nearly twenty hours. It read as the whole
integration being down account-wide, and the work (a task and a wrap-up post)
was parked in a file on the Desktop to wait it out.

Two things made it look worse than it was. Plain reads (`search`,
`get_workspace_hierarchy`) kept answering normally throughout, so the failures
looked arbitrary rather than budgeted. And the chat endpoints reported **"wait
NaN minutes"** — a JavaScript not-a-number leaking into operator-facing text,
which reads as a broken connector rather than a spent allowance.

The countdown itself was honest: four readings taken across three hours (1171,
1023, 998, 992 minutes) all resolved to a single fixed reset, matching the raw
`retryAfter` to within eleven seconds. It was a real rolling ~24h window.

**The part that mattered: there were two limits, not one.** The *connector*
(claude.ai's ClickUp bridge) budgets writes over ~24 hours. ClickUp's own API
limits by the MINUTE — about 100 requests, reset in 60 seconds — and was
nowhere near its ceiling. A personal API token talking straight to
`api.clickup.com` was never blocked at all. Nothing had to wait.

**Do this:** when a hosted integration reports a limit measured in *hours*, it
is the integration's quota, not the upstream provider's — provider limits are
almost always per-minute. Check whether a direct path exists before waiting.
`scripts/clickup_direct.mjs` is that path here — run as `npm run clickup --
<command>`, it covers the full loop surface (queue/get/comments/status/
comment/task/chat/lists; bare `npm run clickup` prints the list). It prints
the provider's true `x-ratelimit-*` headers so the two buckets can be told
apart, and verifies every write by reading the result back.

**Corollary:** a retry-after rendered as `NaN`, `undefined` or `Infinity` is not
evidence about the wait. It means the value was missing — go and find the real
one before planning around the number on the screen.

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

### 2.5 A person is a human being — an agent is not, and a hand-off must say which

`person` and `human` mean a human being. In practice, Dane. An agent session is
an **agent session** — never a person, a human, somebody, or anyone. Ratified in
vault `doctrine/TERMINOLOGY.md` (2026-08-29), under the same rule that retired
"banner" and "harness": doctrine states rules in words with exactly one referent.

This is not house style. It is the answer to the only question that matters at a
hand-off — *whose hands does this need, and are they Dane's?*

Ticket 86bbmfc15 (PR #434) sat blocked for four days. The merge step hit a real
conflict and behaved correctly, but its messages did not. It told Dane *"your
approval is still standing — you do not have to say merge again"* and *"it will
merge on a later run, once the branch is caught up."* Its log and help text
called the actor it needed **a human**. An agent read that log and told Dane the
system had "stopped and asked for a person," so he concluded he was the blocker
and had missed a prompt. He was not the blocker, no prompt existed, and the
actor actually requested — an agent session, asked for on the bus — was not
listening, because nothing consumes those messages. The wrong word hid a missing
actor for four days, and the conflict itself was three lines.

**Do this:** at any hand-off, name which of the two it needs. A hand-off that
cannot name a specific waiting actor does not get to imply one. Passive voice is
the tell — *"once the branch is caught up"* reads as a process underway until you
ask who is doing the catching up. If nothing is going to pick the work up, the
message says so plainly.

**And do not over-correct.** Most existing uses are right and must stay: *"a
human eye is the only gate that exists"*, *"only a HUMAN exports a token by
hand"*, *"an Urgent flag is a human override"*. The test is not the word, it is
the referent — replace it only where the actor is genuinely an agent session.

### 2.6 The actor has one source, or two code paths will name two

§2.5 made every hand-off name the actor it waits on. That is necessary and it is
not sufficient. On 2026-08-30 the merge step named its actor correctly, and a
second code path in the same pass named a different one.

PR #444 was approved and its branch needed catching up with `main`. The catch-up
merged cleanly and the **push** lost a race — another session had pushed to the
same branch seconds earlier, so git rejected it with `fetch first`.
`branchCatchUp` reported `PUSH_FAILED`; `clickup_direct.mjs` mapped it to
`kind: 'unknown'`; `mergeOnComment.conflictHandOffNotice` read that, chose the
actor `later-pass`, and wrote the true sentence — *"It will be merged on the next
run."* Nothing needed to act.

Then the filing path ran. It files on `gate.action === 'conflict'` alone and
never reads the local verdict, so it opened a ticket titled *"Resolve the merge
conflict on PR #444"* — for conflict markers that did not exist; `git merge-tree
--write-tree` on the two branches exits 0 with a clean tree — and posted a second
comment naming the build loop as the actor. The two comments landed 200
milliseconds apart saying different things. The ticket then sat two hours in
Ready to launch, because a reader believes whichever one they read last, and
neither named actor was going to move it.

**Do this:** derive the actor once and let every consumer read that one value —
the notice, the filing decision, the log line. Where two readers exist, a test
asserts they cannot disagree on the same fixtures, the way the verdict parser
already guards its own pair. An actor computed twice is two actors.

The tell is a condition that stops short of the value it is deciding about:
`if (!filed && !dryRun)` asks whether a ticket already exists and whether this is
a real run, and never asks the one question it is answering — *is there anything
to resolve?* Closing it is task 86bbq80j5.

### 2.7 Every time quoted to the operator is Mountain time — never UTC

Dane works in **Mountain time (`America/Denver` — MDT in summer, MST in
winter)**. So does everything he reads: the Mac Mini's clock, the loop logs
under `~/loop-logs/`, the launchd logs, and every ClickUp Loop note. GitHub and
the ClickUp API do not — they hand back UTC, with a trailing `Z`.

On 2026-09-01 a report to him quoted `mergedAt=2026-09-01T17:21:59Z` in the
same breath as a Mini-log line reading `10:37`, and he had to ask which clock
was which. He had asked before. His words that morning: *"You are back to
using UTC as a basis. It is now 11:12 AM my time. Please make note of this in
doctrine so we don't have to keep discussing time zones."* A standing
instruction given verbatim is a keeper.

**Do this:** convert every API timestamp to Mountain time before it reaches a
reply, a ticket note, a bus post or an operator card — `mergedAt`, `date`,
`createdAt`, `date_updated`, all of them. Mini-log and Loop-note times are
already local; leave them alone. If a raw value must be quoted (a log excerpt,
a `gh` line pasted as evidence), label it once with the zone so the reader is
never left converting. The `@@MEASURED 8:04pm` line on an operator card is the
same rule from the other side: it is the clock that dates the card, and it is
his clock.

```
TZ=America/Denver date -r 1756747319                       # shell, from an epoch
new Date(x).toLocaleString('en-US', { timeZone: 'America/Denver' })   # node
```

Two clocks in one report is one question he has to ask every time, and this
section exists so that he never has to ask it again.

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

### 3.12 A guard placed after the refusal it exists to pre-empt is unreachable

The merge step was taught to notice a `review-gate` check that had answered an
older question and **re-run** it rather than merge on it (task 86bbmk7pv, PR
#443). The decision logic was pure, tested from nine angles, and correct. It was
also, in the one mode it was written for, dead code.

The step's first rule is *never merge past a red check*. In enforcing mode a
stale gate **exits 1** — so it IS a red check, `githubGate` answered `refuse`,
and the function returned three lines above the staleness question. Ticking the
branch-protection box would have produced exactly the deadlock the ticket was
written to prevent.

Two things hid it. The feature ships **advisory first** (exit 0), and in advisory
mode the stale check reads green, the refusal never fires, and the block is
reached — so every trial and every test exercised the reachable half. And the
wiring test asserted only that the staleness call appeared *before the merge
command*, which stayed true with the code unreachable: it pinned a boundary that
could not move, so it could not fail.

**Do this:** when a check exists to handle a specific failure state, prove it is
**reached while the system is in that state** — not merely that it is called
somewhere before the action. Two questions catch it:

- *What else answers first?* List the branches that return before yours. A guard
  that interprets a red signal must sit above the rule that refuses on red
  signals; a stale red means "run it again", and only the re-run's answer is a
  real refusal.
- *Which mode did I test?* A feature with an advisory phase and an enforcing
  phase is two programs. Green in the harmless one is not evidence about the
  other, and the enforcing path is the one with the consequences.

An ordering test must pin the boundary that can actually move — here,
*staleness before the red-check refusal*, not *staleness before the merge*.
Break it on purpose and watch it fail; an assertion that survives the bug it
names is decoration.

### 3.13 A watchdog that runs only where its subject runs cannot see the case it exists for

Slice E of the NODES plan (task 86bbhbadj, PR #469) had to make *silence*
detectable: a job that fails writes a log line, but a job that never fires
writes nothing anywhere, and nothing is indistinguishable from a quiet week.

The obvious build is a check on the machine that owns the job — it has the
data, it is already awake when the job runs, and it needs no coordination. It is
also useless, and useless in the exact scenario the feature was written for.
**The machine being switched off takes the watchdog out with the job.** A
schedule evicted by an OS update, a Mini unplugged, a launchd job that never
reloaded after a restart: in every one of those the watcher and the watched die
together, and the silence goes unreported by the one thing built to report it.

So the beats go on a surface **both** machines read (a ClickUp ticket), and the
check runs from whichever machine is awake — including, and especially, the one
that does **not** own the job. `scripts/run_bus_relay.sh` performs it *before*
the ownership test, which reads oddly until you see why: the non-owning machine
was already waking every ten minutes to say "not my job" and exit, and that idle
wake is the only vantage point in the system that survives the owning machine
being dead.

**Do this:** for any check whose subject is a machine, a process or a schedule,
ask *what takes both of us out at once?* If the answer is "the thing I am
watching for", the check is in the wrong place. Put the evidence somewhere
neither party owns, and read it from somewhere the failure cannot reach.

The corollary is a resolution question, and it is the cheap half: the shared
record only needs to be as fine-grained as the absence you must notice. Slice E
pushes one row per machine per day, because the requirement is "a day-long
absence is visible", not "a ten-minute one is". A finer clock would have been
more writes, more noise and no more detection.

### 3.14 An unpopulated field is not an empty answer

The same slice reads its roll call out of a ClickUp task description. Driven
against the live API, ClickUp answered a `GET` with `markdown_description: ""`
for a task whose description it was holding **perfectly well** — the text
arriving under `description` instead. The reader preferred the markdown field,
so it handed the parser an empty string for a record that was entirely intact.

The parser then did the reasonable thing and read an empty string as *an empty
roll call*: no beats recorded yet. Which would have announced **every scheduled
job in the system as having gone quiet, all at once**, off a field that was
simply not filled in. For a monitoring feature that is the worst available
failure: an alarm that cries wolf is an alarm nobody reads, so a false-alarm
storm does not merely add noise, it disables the real alerts behind it.

It was caught only because the thing was run against the live service instead of
reasoned about — the code is correct against the API as documented.

**Do this:** when a provider can return a field empty, decide explicitly which
of two things "empty" means — *a confirmed absence* or *nothing was read* — and
make the two render differently (§3.2, §3.11). Where the record you write always
carries something (a preamble, a header, a marker), a wholly empty read is
**unreadable**, never zero results. And consult every field that could carry the
value rather than one by preference; a provider populating a different field
than the one you wrote is a real behaviour, not a corruption.

### 3.15 A declared behaviour is not a running one — watch it, do not read one frame

Three render contracts were written for the video-background crossfade
(2026-08-31, #478). Two of them assert the pair of `<video>` elements exists
and that the trailing copy carries an `opacity` transition. Both are true
statements about the DOM and both are worthless.

The handoff was then disabled on purpose — the opaque copy never swaps, the
loop hard-cuts, the feature is completely dead — and `check:render` reported
**19/19 green**. Nothing had to go wrong for that; the elements were still
there, and a `transition` property is a declaration about what *would* happen
if something changed, not evidence that anything does.

This is the same species as the two already recorded in §5.14: an
`animation-name` naming keyframes that do not exist, and a `--sc-effect-*`
variable compared against itself. A property that describes motion is not
motion. Here the tell is sharper, because the property was correct and the
thing that never ran was ours.

What proves a dissolve is **two copies both partly visible at the same
instant**, which does not exist in any single frame. So `sample()` in
`scripts/ui/check_render.mjs` grew a `series` option — named selectors, a list
of properties, a count and an interval — and hands the whole run to `expect`.
The contract now fails with the opacity pairs it actually saw:

```
✗ video-background-crossfade-actually-dissolves: the two copies were never
  both partly visible across 45 frames — the loop is still a hard cut with a
  transition property on it. Opacity pairs seen: 1/0.
```

**Do this:** if the behaviour is a CHANGE — a fade, a hand-off, a debounce, a
retry, a thing that settles — the check has to watch it happen. Reading one
frame can only ever confirm the setup. And before believing any new contract,
break the behaviour it guards and watch it fail; every check in this repo that
skipped that step went on to report clean over something broken.

### 3.16 An absence has to be a stated expectation, never a silent not-found

The same feature needed the opposite assertion: under reduced motion, and at
phone width, the layer must render **no `<video>` element at all** — the poster
underneath is the answer (`docs/VIDEO_BACKGROUNDS.md`).

`check:render` could not express that. Its first rule is that nothing measured
is a failure, never a pass — which is right, and which made "this must not be
here" unwritable. Left as-is, the fallbacks would have had no coverage at all,
and their failure mode is invisible to whoever is not affected: the page looks
perfectly fine to anyone who has not asked for reduced motion and is not on a
phone.

So `absent: true` inverts that one rule explicitly, and says so in the failure
message. Explicit is the whole point — a check that treats "I found nothing" as
a pass by default is how §3.11 and §3.2 keep being relearned. Paired with it,
`emulate` (reduced motion, viewport) puts the browser into the condition the
behaviour exists for, because the only prior evidence those paths worked was
somebody remembering to toggle a system setting by hand.

**Do this:** when correct behaviour is that something does not appear, assert
the absence deliberately, and make the assertion distinguishable from the check
having failed to look. Then verify the pair from both sides — the presence
contract is what stops the absence contract passing because the feature never
rendered at all.

---

## 4. Secrets

### 4.1 The rule is about EXPOSURE, not custody

Standing rule, and the test is one question: **would this render the value
somewhere a person or a log could read it?**

- **No — the agent runs it.** A command that moves a secret between two stores
  without displaying it: `doppler secrets get X --plain | gh secret set X`.
  Nothing reaches the screen, the clipboard, the transcript, or a field where it
  could be mislabelled.
- **Yes — the operator runs it.** Anything that makes a value *visible* or
  *new*: reading one out, generating one (`openssl rand`), pasting into a
  browser form, a billing screen, a login. `scripts/diagnose_x_auth.js` is the
  model for tooling that must not cross the line — it prints lengths and
  first/last four characters, never a value.

**The pipe has a direction, and only one end is safe** (2026-09-01). The example
above works because `doppler secrets get --plain` writes to stdout, where a pipe
swallows it, and `gh secret set` echoes nothing. Reverse it and the rule inverts:
**`doppler secrets set` prints the value it just wrote**, and `doppler secrets
delete` prints the remaining secrets table — full values, all of them. `--silent`
suppresses info messages, not those tables. An agent moving a credential INTO
Doppler that way exposed a live ClickUp token and a Google API key in one
session, while believing it was following this section.

So: Doppler belongs on the `get` side of a pipe, never the `set` side. A value
that has to be *entered* into Doppler goes in through the dashboard, by Dane —
that is the "makes a value new" case, and it always was. And before piping a
secret anywhere, check what the receiving command prints on success; "it moves
between two stores" is not the test, "does anything render it" is.

Deleting a GitHub secret is refused outright by the session's safety classifier
(three attempts, 2026-08-31). That is correct behaviour, not a bug to route
around: hand the click over and say in one line why.

**Why it is stated this way** (2026-08-31). The rule used to read "the operator
runs the command that touches the real value", and it was applied as though it
were about **custody** — who holds the secret. It was written after the
2026-07-13 incident where `.env.local` was visible on a TV in a photo, so it was
always about **visibility**.

Read as custody, it did the opposite of its job. Setting up the review gate's
CI token, the operator was handed the GitHub secrets browser form — and pasted
a ClickUp token into the **Name** box twice, with two different tokens. GitHub
encrypts and masks secret *values*; it does not protect *names*. Both tokens sat
in the settings UI as plain labels and are in the repository's audit history
permanently, which no deletion reaches. The agent had a pipe available that
would have shown nothing and had no Name box to get wrong, and declined to run
it on the strength of this rule.

**Do this:** prefer the pipe over the form precisely *because* the form has a
field the value can land in wrongly. A rule written to prevent exposure must
never be applied in a way that creates it — when the two readings disagree, the
one that keeps the value off every screen is the correct one.

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

**`src/layout.html` stopped carrying pins on 2026-08-24** (task 86bbkh1nn), so
it can no longer conflict on one. It is committed source AND the template
`build_html.js` composes into `public/app-shell.html` — which is gitignored and
pinned as one of `public/*.html`. Pinning the source re-derived exactly the same
hashes onto a file humans edit and git merges: removing it from the targets left
the generated shell **byte-identical**, and two branches that each touched a
bundled asset then merged with zero conflicts, where before they collided there.

That one file was the largest single source of the `?v=` trouble — the merge
conflicts, the stale pins a catch-up merge restored, and GitHub's phantom
`CONFLICTING` (it cannot run our merge driver). On 2026-08-24 that chain left
eight already-approved tickets parked for a day.

**And on 2026-08-24 the class was closed for good** (task 86bbkh288): the four
remaining pin-carrying files — `public/about.html`, `site.html`,
`builder-preview.html`, `explore.html` — moved to `src/static-pages/` as bare
sources, their `public/` outputs generated and gitignored like the app shell.
No committed file carries a `?v=` hash, so a pin can no longer conflict, go
stale in a merge, or make GitHub report a phantom `CONFLICTING`. The
`asset-pins` merge driver was deleted with the case it existed for, and CI's
"pins match a clean build" check became the stronger general rule: **a clean
build must not modify any tracked file.**

If a pin conflict ever appears again, someone has re-committed a generated
file; fix that, never the pin.

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

### 5.14 A green suite still says nothing about appearance — but CSS is no longer untested

Two defects reached the operator on 2026-08-16, hours apart, both in the same
carousel work, both pure CSS, and every gate was green for both:

- the card picture was pinned at a hard `height: 180px`, so `object-fit:
  cover` cropped every poster and the Height control looked dead;
- the card row still carried its scrollbar.

Four tests were written alongside the first fix. **Three of them passed
against the broken build**, because they read rendered markup and the fault
was a declaration in a stylesheet. That is not a gap in those tests; it is
the shape of every test in this repo. `check:ui` parses the CSS corpus but
only for doctrine rules (breakpoint-only layout, tokens), and `check:panels`
measures panel geometry, not module rendering.

**Do this:** when a change is visual, the verification is a browser
measurement or the operator's eye — say which one you did, and never let
"947 tests passed" stand in for either. That has not changed and is the
part of this rule that never expires.

#### What now exists (2026-08-17), and exactly what it does not cover

Three defects in the image-effects work were invisible to every gate — an
effect offered for months with no stylesheet rule behind it, a `max-width`
the browser silently threw away, and an iteration count that would have
stopped the spin with the crossing. All three were caught by hand, driving a
browser and reading computed styles, which is a harness rather than a habit.
So it was built (#315, #318, #320, #322):

| Check | Asks | Runs |
|---|---|---|
| `npm run check:css` | Which declarations did the browser actually KEEP? Plus: an `animation-name` with no keyframes, a `var(--x)` defined nowhere and given no fallback, a class the code emits that no stylesheet defines. | **CI, every PR**, ~1s |
| `npm run check:render` | Does the rendered module animate, cap its size, and count its animations separately? Contracts in `scripts/ui/render-contracts.mjs`. | by hand, ~30s |
| the differential (inside `check:render`) | Does changing a setting change ANYTHING a person could see? Every effect the panels offer must produce a live animation. | with the above |

**What they do NOT cover, and this is the important half:**

- **Nothing here can tell you a page looks good.** The differential proves
  something changed, never that it changed *correctly* — it cannot tell a
  bounce from a wobble. It is a dead-control detector, not a design reviewer.
- `check:render` sees only what its contracts and registry name. A module
  with no contract has no coverage.
- Horizontal-overflow on a rendered page is **not** asserted anywhere: the
  Builder preview shell clips it, so the assertion was written, tried, and
  deleted when it could not be made to fail.
- Only the `image` module family has real contracts today. *(2026-08-31: the
  video background has six as well — `docs/VIDEO_BACKGROUNDS.md`.)*

#### What `check:render` grew on 2026-08-31, and what each was built against

Three capabilities, each added because a contract could not otherwise be
written — or worse, could be written and could not fail:

| Capability | Lets a contract say | Built against |
|---|---|---|
| `emulate` | put the browser in a condition first — `reducedMotion`, `viewport` | the reduced-motion and phone fallbacks, whose only prior evidence was somebody remembering to toggle a system setting by hand |
| `absent: true` | **this must NOT be here** — inverts "nothing measured is a failure", explicitly (§3.16) | the same two fallbacks, whose correct behaviour is rendering no element at all |
| `series` | watch named selectors over N frames and judge the run (§3.15) | a crossfade that reported 19/19 green with its handoff disabled and the loop hard-cutting |

They are general. Any contract can use them, and `series` is the answer for
anything whose truth is a change rather than a state — a fade, a hand-off, a
debounce, something that settles.

So the first paragraph stands: **the verification for a visual change is
still a browser measurement or the operator's eye.** These checks widen what
a machine can notice; they do not replace looking.

Three things learned building them, each of which turned a check that looked
like it worked into one that did:

1. `getComputedStyle().animationName` **reports animations the engine cannot
   run** — with `animation: real 5s, ghost 5s` and no `ghost` keyframes it
   returns `"real, ghost"`. Motion assertions use `getAnimations()`, which
   lists only what is really running.
2. `getComputedStyle` **enumerates custom properties**. Every effect setting
   reaches the page as a `--sc-effect-*` variable, so a diff of computed
   styles was comparing the SETTING to itself and passing on a control that
   had been frozen dead. A variable nobody reads is the same species as a
   class nobody styles.
3. Reading a validity test off a shorthand is wrong: `border: none` sets
   seventeen longhands and still reads back as an empty string. Count what
   the declaration set, do not read the value back.

For a specific declaration worth guarding, reading the stylesheet in a test
still works and is still cheap (`builder-carousel-loop.test.ts` for the
hidden scrollbar, `builder-template-preview-carousel.test.tsx` for the
unpinned picture height). Treat each as a scar, not as coverage.

### 5.15 Browser-only behaviour is only real in a browser

The carousel's loop clones the card set, parks on the middle copy, and
recentres once scrolling settles. Under SSR the container measures zero, so
`overflows` is false, no clones render, and a markup test sees a plain row —
it cannot fail. Driving a real browser found two defects nothing else would
have: presses read off a half-finished scroll position were thrown away
(eight clicks moved one card), and assigning `scrollLeft` at the seam
cancelled the smooth scroll in flight, losing a step.

**Do this:** drive the app for anything whose truth is a scroll position, a
measured size, or a computed style (§5.9). Then pull the arithmetic out into
pure functions and unit-test *those* — `builder-carousel-loop.ts` exists
because the seam shift and the shorter-way-round step were the parts that
were wrong twice, and the only parts that could be tested at all.

### 5.16 A public page view still reads the whole project — measured, and cleared

`getPublishedPageForProject` answers one page by calling
`listPublishedPagesForProject`, which selects every public page of the project
with its full `layout_sections`, resolves each canonical section against its
master, enriches all of them with theme data, and then returns one. Its own
comment says so on purpose: *"the payload win is in what crosses the WIRE, not
in the query."*

That is only reached when a project has never published — and as of 2026-08-17
`builder_published_pages` is empty for every project, so it is the path every
public page view takes. Publishing materialises each page and
`lib/publishedPageRead.js` then answers with a single row.

**This was investigated as the cause of the 2026-08-16 IO outage and ruled out**
(§1.6): 626 calls, 99.9% cache-hit, 2 MB off disk. It is a latency and CPU cost
— about 121 ms a call, growing with the page count — not a disk one.

**Do this:** if you arrive here hunting IO, stop; it has been measured. If you
arrive hunting latency, it is real, and there are two fixes: publish (free, no
code, but it changes the operator's workflow from "edits are live" to "edits go
live on Publish", which is a decision, not a cleanup), or select one row in SQL
and accept that the publish/private filters and the frame resolution then exist
twice.

### 5.17 A zero-value filter is not "no filter" — it captures `position: fixed` and disables `background-attachment: fixed`

`position: fixed` means "fixed to the browser window" only while **no ancestor
has a `transform`, `filter`, `perspective`, `backdrop-filter`, `will-change`
naming one of those, or a paint/layout `contain`**. Any of them makes that
ancestor the containing block instead, and every percentage, `vw`/`vh` and
`inset` on the fixed element silently starts measuring from it.

The trap is that **the value can be a no-op and the capture still happens**.
`blur(0px)`, `scale(1)` and `translate(0)` change nothing you can see, and
change everything about where a fixed child lands.

Every themed builder column carried:

```css
backdrop-filter: blur(var(--lp-blur, 0));
```

and Container Blur defaults to 0. So every column on every themed page ran
`backdrop-filter: blur(0px)` — invisible, and a containing block for anything
fixed inside it. The proximity-effect module asked for the centre of the
browser window and landed at the centre of whichever **cell** it had been
dropped in; measured on the live site at 1600×900 it sat 232px right and 16px
down of where it asked to be, and the offset was exactly the column's origin.
Moving the module to a different cell moved the effect, which is the opposite
of what `fixed` promises. Fixed 2026-08-18 (#327): `getBuilderThemeStyleVars`
emits `--lp-backdrop` as the whole filter — the keyword `none` at zero — and
`_builder-theme.css` reads that.

**It was never about that module.** Any modal, dropdown, toast or overlay
rendered with `position: fixed` inside a builder column had the same fate for
as long as the rule existed. Nothing looked wrong in the stylesheet, and a
zero-radius blur does not stand out in devtools unless you already suspect it.

**No check covers this and none easily could.** `check:css` asks which
declarations the browser KEPT — and it kept this one; the declaration is
valid, applied, and doing exactly what it says. The fault is a side effect of
a valid value, which is a different question from the one that harness asks.

**The same capture has a second symptom, and it looks nothing like the
first.** Those six properties also turn `background-attachment: fixed` into
plain `scroll`. Nothing is mispositioned and there is no offset to measure —
the background simply stops being fixed and scrolls with the page. So the
"walk the ancestors" advice below is right, but the tell that leads you to it
is absent: you are not looking at something in the wrong place, you are
looking at an effect that is not happening.

Worse, it is conditional. Whether a themed column carries a filter decides
whether a fixed background works, so the same page can be correct under one
theme and dead under another, with no diff between them.

This is why parallax is a scroll-driven layer here and not the one-line CSS
version (2026-08-31, 86bbqazxv / PR #481). `docs/VIDEO_BACKGROUNDS.md`,
under "`background-attachment: fixed` was considered and rejected", carries
the worked example — and the iOS Safari half of the reason.

**Do this:**

- Never emit a filter, transform or backdrop-filter for a zero setting. Emit
  the keyword `none`. Build the whole property in the variable
  (`--lp-backdrop: none`), never a bare number the stylesheet wraps in a
  function it cannot opt out of.
- When a fixed element lands somewhere unexplainable, walk its ancestors for
  those six properties before doubting your own arithmetic. If the offset
  equals some ancestor's origin, that ancestor is the containing block.
- When a fixed BACKGROUND is not fixed — it scrolls like an ordinary one —
  walk the same six properties. There is no offset to compare here, so check
  the ancestors first rather than last; it is the likeliest cause and the
  cheapest to rule out.
- Positioning bugs are measured, not eyeballed: read
  `getBoundingClientRect()` against the window centre and compare numbers.
  Both halves of this one were found that way and neither was obvious on
  screen.

### 5.18 A vitest test that requires a generated lib passes locally and always fails CI

2026-08-22, PR #343 (Sync 5/7). Every local gate was green — typecheck,
`test:builder` 490/490, `test:builder-ui` 1102/1102, conventions — and CI's
`verify` job was RED. The new `lib/builder-client/section-drift.test.ts` did
`require("../builder/document.js")`, whose own line 3 requires `./template`,
and `lib/builder/template.js` is a **gitignored generated artifact**.

CI's step order is the whole story:

```
npm ci → check:syntax → check:css → typecheck → npx vitest run → npm run build → … → npm run test:builder
```

`npx vitest run` happens **before** `npm run build`, so at vitest time the
generated libs under `lib/builder/` do not exist. On any developer machine they
already do — which is why this shape of test passes locally forever and fails
CI forever. **A green local `npm run test:builder-ui` is not evidence the same
test passes in CI.**

**The rule.** vitest (`components/**`, `lib/builder-client/**`) tests
TypeScript sources only. Anything that must require a generated server lib
(anything under `lib/builder/`) belongs in the **node** suite
(`scripts/builder/*.test.js`, run by `npm run test:builder`), which CI runs
**after** the build — which is why every existing node test may require them
freely.

**Prove a fix:** `mv lib/builder/template.js /tmp/ && npx vitest run` must stay
clean, then restore. Reproduced deliberately that way at the time: it produced
the identical `Cannot find module './template'` CI error.

**Enforced, not just remembered** (`scripts/check_vitest_generated_lib.cjs`, in
`check_conventions.cjs`). It walks each vitest test file's relative-import graph
and fails the moment the chain reaches `lib/builder/` — the direct require *and*
the indirect one through a committed source like `document.js`. A grep could not
see the indirect case. To prove the guard bites: add a vitest test that requires
`lib/builder/…`, run conventions, watch it fail; remove it, watch it pass.

---

### 5.19 A cache must not remember a failed question as an answer

2026-08-30, found in review of PR #448 (Connections 1/7). `lib/projectScope.js`
asks each table once whether it has both tenant columns, and remembers the
answer for the life of the process:

```js
const probe = await sbQuery({ table, query: 'select=project_id,owner_user_id&limit=1' });
const supported = probe.ok;          // ← the bug, in one line
SUPPORT_CACHE.set(tableName, supported);
```

`probe.ok` is false for two situations that are **not the same fact**:

| What happened | What it means | Cacheable? |
|---|---|---|
| 400 naming the column, 404 on the relation | Postgres answered: the columns are not there | Yes — it is a property of the table |
| 502, cold start, dropped connection | The question never arrived | **No** — it is a property of the moment |

Both were stored as "this table has no tenant columns", permanently. And
`scopedListQuery`/`scopedIdQuery` respond to that by returning the caller's
query **with no project filter appended at all** — which is a reasonable
behaviour for a table that genuinely is not tenant-scoped, and a catastrophic
one for a table that is. Every scoped read in that process then returned every
project's rows. On `project_connections` that is one client reading another
client's decrypted OAuth tokens; review reproduced it with a single simulated
502.

Note what makes this invisible. There is no error, no empty result, no slow
query — the unscoped read is *faster* and returns *more* data, and every store
above it reports `ok: true`. It also cannot be reproduced by running the
software normally, because the cache is only wrong after a failure that is by
definition rare and transient. It is a bug that exists exclusively in
production, exclusively after a hiccup, and exclusively in the direction of
handing out too much.

**The rule.** A negative cache entry must be justified by an answer, never by
the absence of one. If a probe can fail for reasons unrelated to the thing
being probed — and any probe crossing a network can — then a failure must be
classified before it is stored, and an unclassifiable failure is not stored at
all. Answering "unknown, ask again next time" costs one extra round trip on the
next call; answering "no" costs the whole process.

**Fixed at both ends, deliberately** (PR #448), because they fail differently:

1. `supportsProjectColumns` caches only a definitive answer. A transient
   failure returns false for that one call and re-probes on the next, so the
   process heals itself.
2. `lib/projectConnectionsStore.js` refuses to *execute* a query that did not
   come back scoped — `requireScopedQuery` checks for `project_id.eq.` and
   returns a 503 rather than run it. The insert path already did this;
   the read, list and delete paths did not.

The second is the one that matters, and it generalises: **the guard belongs
where the damage happens, not only where the mistake originates.** Fixing only
the cache leaves every future caller of `scopedIdQuery` trusting that a
returned query is a scoped query, which is exactly the assumption that failed
here. A store handling secrets should verify the filter is present rather than
assume the helper added it — cheap, local, and it does not depend on anyone
remembering this incident.

**Prove a fix.** Simulate the transient failure specifically; a missing column
does not exercise this path, because that failure is correctly cached.
`scripts/builder/projectConnectionsStore.test.js` does it with a fault switch
that fails the NEXT probe with a 502 and nothing else — then asserts three
things: the read is refused, the token appears nowhere in the refusal, and the
very next call recovers to a correctly scoped 404. Break either end and that
test fails; both were reverted and watched to fail before the fix was believed.

**Where else this shape lives.** Anything that probes once and remembers.
`git grep -n "CACHE.set" lib/` is the starting point — the question to ask of
each is "can this probe fail without telling me anything about the thing I am
probing?", and if it can, "what does the cached wrong answer authorise?"

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

The converse costs more, because nothing announces it: a merge with **no**
conflict is not evidence the two sides agree. §6.11 is that case — two branches
contradicting each other's rules without sharing a line.

And before any of that: **confirm the conflict is real.** A forge can report
one that git cannot reproduce, and the word alone is enough to start somebody
editing files that never conflicted — §6.13.

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

**The second incident — a rule can be evaded without anyone trying to evade
it.** 2026-08-23: three unattended `loop-build` runs on the Mac Mini
force-pushed, despite four deny rules forbidding it. Recovered from the session
transcripts rather than the agents' own accounts, every instance was the same
command:

```
git -c credential.helper='<the gh helper>' push --force-with-lease
```

Deny rules are command-**prefix** globs. `Bash(git push --force*)` matches a
command that *starts* `git push`; this one starts `git -c`. And that prefix is
not an evasion anyone invented — it is this repo's own documented way to push,
because osxkeychain is unreachable from an agent session. **The house idiom
walked straight through the house rule**, and nobody would have known if the
agents had not each volunteered it.

Two lessons, and the second is the durable one:

1. Every instance had the same cause: write the work-log entry, open the PR,
   then amend the commit to stamp the number in. **Remove the reason and you
   remove the pressure** — `loop-build/SKILL.md` now says to add the entry as a
   second commit, and never to amend after pushing.
2. **A guard made of patterns protects only the spellings someone thought of.**
   `git -C <dir> push --force`, a newline instead of `&&`, `git push origin
   +main` with no flag at all — each needs its own pattern, and none of them
   gets written until after the incident that needed it.
   `scripts/lib/force_push_guard.cjs` therefore *parses* the command — strips
   env assignments and git's global options, then asks whether the subcommand
   is `push` and whether anything forces — and the hook refuses on that, ahead
   of `SKIP_DENY_EXPLAIN` so no environment variable is a way around it.
   `scripts/hooks/force_push_guard.test.js` holds all seventeen forms.

*The damage was nil — every push was to the loop's own unmerged branch, seconds
old. That is not the point. An unattended agent crossed a line the operator drew
and the crossing was invisible; on a machine nobody is watching, "the guard has
a hole" is the whole finding.*

### 6.7 On a send-back, merge `main` in before you rework — the fix may already be there

**The incident (2026-08-30, ticket 86bbmg2fb, PR #441).** Review sent the
branch back asking, among other things, for `next-interval` to survive an
unreadable list without exiting non-zero. `fetchAllTasks` ended in `die()`, so
the rework added a `soft` option that throws instead. Meanwhile — while the
branch sat in review — a different ticket (86bbm4zwd) had added the same escape
hatch to the same function on `main`, named `fatal: false`, returning
`{ tasks: null, failed }`. `ship` stopped on the conflict. The resolution was
to delete the rework and call `main`'s version: the correct code had existed
before the rework started, and the only work the rework produced was the
conflict.

**Do this:** the first command on a sent-back branch is `git merge
origin/main`, before reading the review notes against the code. A branch that
has been in review for days is editing a file `main` has since changed; §6.2
says the conflict is information, and this is the cheap time to receive it.
Then look for the asked-for fix on `main` by *behaviour* — search for the
function, not for the name you were about to give it.

**Addendum (same day, same merge): after resolving a conflict by keeping both
sides, PARSE the file before you commit it.** The same `git merge origin/main`
on ticket 86bbmg2tq hit a content conflict in `scripts/clickup_direct.mjs`
where both branches had added lines in the same place. "Keep both sides" fused
two separate `const { ... } = X;` statements onto one line — a resolution git
considers complete and node considers a SyntaxError. It was caught only
because an agent happened to run `node --check` by hand.

Nothing in the toolchain would have caught it. `check:syntax` parsed only
`public/js/`. `test:builder` reads `clickup_direct.mjs` as *text* — two
source-level assertions — and never executes it. `check_conventions` skips its
added-line checks during a merge, precisely because a merge adds lines it did
not write. So a file every loop pass runs could have reached `main` green, and
the next loop pass would have died on line 1: every ticket stuck in whatever
status it was in, with no verdict written anywhere, and no error anyone would
see until somebody wondered why the queue had stopped moving.

That gap is now closed — `npm run check:syntax` parses every hand-written
`.js`/`.mjs`/`.cjs` under `scripts/` and `lib/` as well as `public/js/`, in
pre-commit and in CI (ticket 86bbq5hwg). Two things follow. First, the fused
statement is caught for you; you no longer have to remember `node --check`.
Second, and more general: **a clean merge is a claim about text, not about
meaning.** Git's job ends at "no overlapping edits"; whether the result is
still a program is a separate question, and every file class needs something
that asks it. The first sweep under the new gate found an unrelated file that
had been unparseable on `main` since it was committed
(`scripts/import_messaging_tweets_csv.js`, a missing closing paren) — which is
the same lesson from the other end: nothing had ever parsed it either.

The same claim fails one level higher too, where the merged result parses
perfectly and two files simply assert opposite rules: §6.11. And one level
lower, where the conflict being reworked around was never there at all: §6.13.

### 6.8 A fixture must be a shape the real source can produce, and the assertion must name the value

**The incident (same ticket).** The test that pinned "a ticket waiting on a
FINISHED blocker is claimable" put the finished blocker *in* the task list
beside its dependant. ClickUp's list endpoint never returns closed tasks
(`include_closed` defaults to false), so the fixture was a shape production
cannot produce; the code path it exercised was real, and the path production
took — blocker absent, treated as still open, ticket excluded forever — had no
test and no failure, because it fails toward sleeping longer. Review found it
only by probing the live endpoint (49 tasks without `include_closed`, 104
with).

Same ticket, second shape: `clampToFloor` was "deliberately total" and had a
break-test — `assert.ok(result >= FLOOR)`. `Number(null)`, `Number('')`,
`Number([])` and `Number(false)` are all `0`, finite, and raised to the floor:
the SHORT end, which switched hysteresis off for a hand-edited state file. The
assertion was true of the wrong answer.

**Do this:** before writing a fixture for an external source, read one real
response and build from *its* shape — what it omits matters as much as what it
carries. And a break-test asserts the **value** the rule requires, not a bound
the wrong answer also satisfies: `assert.equal(clampToFloor(null), 3600)`, not
`>= 900`. A guard that only checks `isFinite` has not checked "is this a
number" — `Number()` manufactures finite zeros from garbage.

### 6.9 CC runs the operational commands — handing one over is a claim it cannot

**Standing instruction from the operator, 2026-08-07, verbatim:**

> *"when you say 'you' can veto etc., you mean you, cc-starcaster, right? I
> won't remember all those commands."*

He raised it again on 2026-08-23 and 2026-08-30. It kept recurring because the
rule lived only in agent memory and in the vault, and neither of those is
loaded into a repo session the way `CLAUDE.md` is. Neither is a guard, either —
so nothing ever caught an agent doing it.

**The incident.** 2026-08-30, the Delray header. One safety-gate refusal early
in the session was treated as a verdict on the whole session rather than a
refusal of that one call, and every production step after it came back to him
as a command to paste. One of them was a script with a dry run and an
`--apply`. He ran the dry run; it printed what it *would* change; nothing in
the output or the hand-off said the change had not happened yet, so he had no
way to know a second command was still waiting on him. Most of an evening went
on a fix that had already been written.

**The rule.**

- CC runs the operational commands — scripts, `doppler run`, SSH to the Mini,
  publishing. He says what he wants in plain language; CC picks the script and
  the flags, runs it, and reports the outcome rather than the log.
- **Four exceptions, and only four:** a real secret VALUE (§4.1), a billing
  screen, a browser login, and a decision that is genuinely his — money,
  clients, what ships. A hand-off **names which one applies**. An unnamed
  hand-off is itself the defect, the same shape as §2.5's unnamed actor.
- **A refusal is scoped to the call it refused.** Retry when the step actually
  comes; if it is refused again, say so in one line and carry on. An early
  "no" is not a session-wide policy, and converting it into one silently
  widens a single gate into a work stoppage.
- **Never leave a production fix as a two-step.** A dry run and its `--apply`
  are one job. Run both, then say what changed. A dry run reported as though
  it were the fix is a §3.10 failure wearing an operator's clothes: it looks
  exactly like success and changed nothing.

*Why this is doctrine and not a courtesy:* flags exist so the agent has a
precise instrument, not so the operator has a syntax to memorize — §6.4 already
establishes that his bottleneck is attention. But the sharper cost is that a
hand-off **misreports the state of the work**. He reads a pasted command as
"this needs your hands", so a job that was finished reads as blocked on him,
and one that is genuinely blocked is indistinguishable from it. That is §2.5
arriving from the other direction: there, an automation said it had asked a
human when it had not; here, an agent implies a human is needed when none is.

Canon home for this rule is the vault `doctrine/OPERATIONS.md`; this section is
the repo-side copy, which is the one actually loaded into every session.

### 6.10 A behaviour proven in an uncommitted file does not move when its job moves

On 2026-08-20 the `bus-relay` failure alert was built, break-tested and watched
to work: a forced failure posted to the bus, a second one was suppressed, a
success cleared the stamp. It was written into
`~/Library/Application Support/starcaster/bus-relay-cron.sh` — a hand-installed
file on the MacBook Pro, correct at the time, in git nowhere.

Then two ordinary, well-run changes landed. Slice B brought the schedule into
the repo (`scripts/run_bus_relay.sh` + `scripts/install_bus_relay.sh`), and
`lib/nodeRoles.js` moved `bus-relay` to the Mac Mini. Both were reviewed. Both
were right. **Neither carried the alert**, because the alert was not in the
thing being moved — so from that cutover until 2026-08-30, a relay failure on
the machine that actually ran it reached nobody at all.

Nothing could have caught it. No test covered the file, no review saw it, no
check compared old behaviour against new, and the regression's only symptom is
the absence of a message nobody was expecting on a particular day. It was found
only because the *next* ticket in the same plan went looking at the runner.

**Do this:** when a slice says a thing "now lives in the repo", diff what the
old artifact did against what the new one does before believing the migration
is complete — the committed version is a rewrite, not a move, and rewrites drop
things. Treat "we proved this works" as scoped to the file it was proved in.
And when a hand-installed file is superseded, say explicitly what happened to
every behaviour it carried; "it is replaced" is a claim about the file, not
about the behaviour.

The general shape, which is why this sits next to §6.6: work that lives outside
version control has no changelog, no review, no test and no blast radius anyone
can compute. That is acceptable for a one-off, and it is a debt that comes due
the first time anything around it moves.

### 6.11 A clean merge is not agreement — and a review verdict has a shelf life

**The incident (2026-08-30, ticket 86bbmmv7t, PR #444, fixed in commit
`80b5502b`).** The PR was reviewed green on 08-26 and sat in `Ready to launch`
for four days waiting on Dane's merge word. When he gave it, the merge step
refused: CI was red. Nothing on the branch had changed since the review.

The branch had tightened what counts as a PR naming its ticket — a bare id
(`ClickUp: 86bbm4zwd`) stopped counting, only a full `app.clickup.com/t/<id>`
URL does (`scripts/builder/clickupTicketLink.js`). Meanwhile the WIP-cap work
landed on `main` carrying `scripts/builder/wipCap.test.js`, whose drift test
asserted the **old** rule: it fed a bare id to `prBodyCarriesTicket` and
expected `true`.

The two changes share no line and no file. `git merge` reported no conflict and
`git merge-tree --write-tree` exited 0 with a clean tree. Both branches were
green on their own. The contradiction was in the **rule**, not in the text, and
it surfaced only when the catch-up merge put both in one tree: one failure out
of 1,665, four days after a review had approved the branch.

**This is the case with no conflict, which is why §6.2 and §6.7 do not reach
it.** §6.2 says a conflict is information; §6.7 says merge `main` in before you
rework so you receive that information early. Both assume git has something to
report. Here it had nothing, so nothing prompted anyone to look. §6.7's closing
line — *a clean merge is a claim about text, not about meaning* — was about
whether the result still parses; this is the same claim failing one level up,
where the result parses fine and two files now assert opposite rules.

**Do this:**

- **Treat a review verdict as certifying the code at that commit, not the
  branch.** "Verified" has a shelf life. A branch approved days ago is
  re-tested by its catch-up merge, not by the review that already happened —
  and a branch waiting on a merge word is exactly the branch most likely to
  have had the ground move under it.
- **When a change tightens or loosens a rule other code asserts, go looking
  for the tests of that behaviour before shipping.** `git grep` the function
  name and a fixture string — not only the file you are editing. The test that
  broke here was in a file the branch never touched, in a subsystem it had
  nothing to do with.
- **When a test disagrees with a new rule, do not simply flip the
  expectation.** Assert the property the test was written to guard, then pin
  the rule's current answer explicitly beside it, so the next drift fails
  loudly instead of leaving the test vacuously passing. That is what
  `80b5502b` did: the one-directional property (the cap may count more than
  the gate lets through, never less) plus three pinned assertions naming the
  ticket that set the rule.

### 6.12 Match what he typed, not what the tool stored — and prove a filter against real input

**The incident (2026-09-01, ticket 86bbt038u, PR #515, merged as `3d821bd7`).**
Dane came back from a break and asked whether the loops were stuck. They were
not: both lanes were building and reviewing normally. What was stuck was the
auto-merge lane, which had latched itself off on 08-30 at 8:31pm and stayed off
for two days without telling anybody.

He tried to release it the sanctioned way — posting `resume auto-merging` on
the party line — three times. All three were ignored. `switchCommand` matches
`resume` as the WHOLE message, deliberately, because a resume that fires when
he was only *talking* about resuming costs an unwanted merge. But ClickUp's
message box turns a **pasted** phrase into a fenced code block and guesses a
language, so what the switch actually received was:

````
```cpp
resume auto-merging
```
````

Three defects, and only the first was visible from the code:

1. `normalizeCommand` never stripped the editor's formatting, so the backticks
   were being read as part of what he said. The same hole sat on the merge
   path — his `merge` worked only because he happened to type it by hand.
2. `readBusSwitchSignals` carried the comment *"Only HIS words. An agent post
   quoting the phrase is a machine talking to itself"* and did not enforce it:
   it accepted any message whose `user_id` was Dane's, which every agent's
   posts are, because they all post under his token. The ticket path next door
   had been enforcing exactly that rule with the machine marker all along.
3. **The filter added for (2) matched nothing at all.** ClickUp's chat api
   escapes the brackets — `\[CC-starcaster bus-relay\] ...` — and every entry
   in `LEGACY_MACHINE_PREFIXES` begins with `[`. Run over the live channel
   before the fix, six of six recent messages classified as Dane's own words,
   three of them posted by the relay itself.

The third is the one that nearly shipped. Every unit test passed, because every
fixture had been hand-written in the shape its author expected rather than
captured from the surface the code actually reads.

**Do this:**

- **An input box you do not control is part of the wire format.** When a
  command must match exactly, normalise away what the *editor* added before
  comparing — fences, language tags, smart quotes, escaping. Strictness is
  only honest when it is strict about things the operator can control;
  otherwise "whole message" quietly means "whole message plus whatever the
  client decided to wrap it in". Note the fix here did **not** loosen the
  matcher: the deliberate `stop`/`resume` asymmetry survived untouched, because
  the bug was never the strictness.
- **Prove a filter against real captured input before believing it.** A filter
  that matches nothing is silent in precisely the same way as a filter with
  nothing to catch — this is §3.11's failure wearing a different hat. Fixtures
  written by the same author as the filter share its blind spot by
  construction. Fetch a page of the real messages, run the predicate over them,
  and look at the classifications one by one.
- **A stated intent is not a guard.** If a comment says what must not happen,
  either the code enforces it or the comment is a false statement with a shelf
  life — and the next reader will trust it, because it is written in the
  imperative and sits directly above the code. When you find one, the fix is
  the enforcement, not a better comment.
- **Two doors into the same decision must be guarded the same way.** The ticket
  path and the bus path both answered "is this Dane's word?", and only one of
  them checked. The weaker door was the one nobody watched. Where a rule has
  more than one entrance, read them together, or derive them from one shared
  predicate so they cannot drift apart (§6.2's ancestor, and the same argument
  as the single-reading rule for shared questions).
- **A latch must keep saying it is latched.** The self-disable recorded
  `"1 thing(s)"` — the count, not the sentences it was holding — and announced
  nothing on the passes that followed. That is why two days passed. A brake
  that cannot say why it engaged is one nobody can safely release; a brake that
  says so once and then goes quiet is indistinguishable from a quiet week.

### 6.13 A reported conflict is a claim to verify, not an instruction to start editing

**The incident (2026-09-02, ticket 86bbt4dkr).** Dane asked for the conflicts
on PRs #513 and #494 to be cleared. Both read `CONFLICTING / DIRTY` on GitHub.
**Neither had a conflict.** Checked afterwards with `git merge-tree` in every
combination that mattered — each branch tip against the `main` it was opened
on, and against the `main` that existed by then — all four merge clean, zero
conflict markers. `git merge origin/main` in each worktree confirmed it live:
"Merge made by the 'ort' strategy", nothing to resolve.

The cost this time was one wasted round trip. The failure mode it exposes is
larger, because the natural response to the word "conflict" is to open the
files and start reconciling them by hand — and here there was nothing to
reconcile. Hand-editing files that never conflicted is one of the quieter ways
a branch loses lines (§6.10 and the #467 doc revert are the same wound from a
different angle), and it is unreviewable afterwards: the diff looks like work.

There was a second half, and it is the part that actually misleads. After
merging `main` in and pushing, GitHub **still** said `CONFLICTING` — because
`main` had moved underneath the session (#516 merged at 05:26Z, mid-task). A
second `CONFLICTING` after you have just resolved reads exactly like *your
resolution failed*, which invites a second, more aggressive round of hand-
editing. It was not a resolution failure at all. The question that answered it
was ancestry:

```
git fetch origin
git merge-base --is-ancestor origin/main <branch> && echo contains || echo behind
```

`behind`. The local merge had succeeded against a `main` that was already
stale by the time it finished.

**Do this:**

- **Verify the conflict before resolving it.** `git merge-tree <base> <head>`
  answers it in a second, writes nothing, and touches no working tree:

  ```
  git merge-tree origin/main <branch> | grep -c '^CONFLICT'
  ```

  Zero means the host is wrong, or stale, or answering about a base that has
  since moved — and the fix is to merge and push, never to edit a file. A
  forge's mergeability flag is a cached derived value about two moving
  targets; git's own three-way merge is the authority, and it is local and
  free. This is §1's rule about instruments: when the reading and the
  mechanism disagree, doubt the reading first.

- **Re-fetch immediately before you merge, and confirm by ancestry.** `main`
  moves during long tasks — five PRs landed on it during this one. A merge
  that succeeded is evidence about the base you had, not about the base that
  exists now, so `git merge origin/main` printing success proves nothing
  about whether the branch is current. `--is-ancestor` is the check that
  cannot be fooled by a clean merge of the wrong thing. Same shape as
  verifying a pull by comparing HEAD ids rather than reading git's chatter.

- **A second identical failure after a fix is a prompt to re-diagnose, not to
  push harder on the first theory.** The strongest signal available was that
  the symptom did not move at all. An unchanged symptom usually means the
  thing you changed was not the cause — and escalating the same remedy is how
  a wrong theory gets expensive.

- **"Clear the conflicts" does not authorise merging.** Clearing a conflict
  and merging a pull request are two decisions, and only the first was asked
  for; the merge came as a separate word from Dane afterwards. §6.6 says not
  to spend an operator decision twice — the converse holds too: do not spend
  one he has not made yet.

---

## 7. Operator-facing gotchas

Worth knowing before they cost an hour.

| Symptom | Cause | Fix |
|---|---|---|
| Credential right in Vercel, still failing live | Env vars bake in at build time | Redeploy |
| Google API key: `Requests from referer <empty> are blocked` | HTTP-referrer restriction on a key used **server-side** — a server sends no `Referer` | Application restrictions → None; restrict by **API** instead. Allow ~5 min to propagate; no redeploy needed |
| `supabase start` prints no keys | Postgres was SIGKILLed (unclean Docker shutdown) | `docker start supabase_db_starcaster`, let it recover, then `supabase stop` && `supabase start`. Run `supabase stop` before shutting down the Mac |
| X: "API key expired" / 401 after months of working | X invalidates tokens on password change, permission edits without regenerating, or key regeneration | Regenerate the Access Token **and** Secret; permissions must be Read and Write *before* generating |
| Every tenant site 404s at once, each after ~10s, nothing deployed | Supabase unreachable — a quota or Disk IO limit, not code (§1.5) | `docs/runbook-supabase-capacity.md` |
| Supabase project "unresponsive" while usage shows one meter over quota | **Spend cap on**: Supabase withholds service instead of billing the overage | Billing → Change spend cap → disable. Operator's decision; it costs money. **Standing decision (2026-08-17): the cap stays OFF** — if you find it on, it flipped back; see the standing-decision block in `docs/runbook-supabase-capacity.md` |
| Restore stuck "Unhealthy" well past the promised 5 minutes | Disk IO budget also exhausted, so the restore itself is throttled | Restart the project (Settings → General → Restart) |

**Local database:** `supabase/migrations/` is **not** the schema source of truth
— it holds three files. `docs/SQL/*.sql`, applied by hand, is. Never run
`supabase db push` or `supabase db reset --linked` here; both write to the cloud
database.
