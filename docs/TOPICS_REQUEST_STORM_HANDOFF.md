# Handoff: 694 duplicate `/api/messaging/topics` requests per screen load

**Found:** 2026-08-10, by `npm run check:screens` — not by a bug report. The
UI harness kept producing measurements that disagreed with each other on
Acquire: YouTube, and the reason turned out to be that the screen exhausts
the app's own rate limit every time it loads.

**Status:** diagnosed, not fixed. Nothing in this document has been changed
in code. The root cause below was traced by reading the call chain after
measuring the request volume in a browser; **verify it yourself before
trusting it** (see §6).

**Severity:** production performance, not cosmetic. Every operator who opens
this screen fires ~694 HTTP round trips. On production latency that is slow
before anything renders, and it consumes the shared per-IP rate budget, so
*unrelated* requests from the same user start getting 429s.

---

## 1. The measurement

One navigation to Acquire: YouTube, signed in, with a project active:

```
API requests — login+activate: 93, +navigate: 735, +reveal & settle: 0
top endpoints:
   694  /api/messaging/topics
    10  /api/contacts
     8  /api/campaigns
     5  /api/segments
     4  /api/assets
     4  /api/projects/current
```

Reproduced identically on two freshly restarted dev servers. The global rate
limit is **500 requests / minute** (`lib/rateLimiter.js`, `LIMITS.global`),
so a single screen load blows through it by ~40%.

**Downstream symptom:** once throttling starts, screens render partial data.
During this investigation the same table reported 82 rows on one run and 1
row on the next, and layout measurements moved between runs. Any work on
this screen is guesswork until this is fixed.

## 2. Root cause — three defects stacked

### (a) One dropdown built per table row

`public/js/youtube.js` ~line 4531, inside `runs.forEach(function (run) { … })`:

```js
var topicSelect = document.createElement('select');
if (App.ui && App.ui.populateTopicsDropdown) {
   App.ui.populateTopicsDropdown(topicSelect, 'Topic', '', currentTopic);
}
```

Every row gets its own `<select>`, populated by its own call. 82 rows in the
local fixture → 82 calls, before any other table on the page.

### (b) The cache refuses to store an empty result

`public/js/core.js` ~line 1013, `App.ui.ensureMessagingTopicsLoaded()`:

```js
if (flatTopics.length > 0) {
  App.state.cachedTopics = flatTopics;
}
```

A project with **no topics** never populates the cache, so every caller
refetches forever. This is why the harness fixture — a clean project with no
messaging topics — is the worst case. A project *with* topics will be less
bad but not fixed, because of (c).

### (c) No in-flight deduplication

The cache is only consulted on entry:

```js
if (Array.isArray(App.state.cachedTopics) && App.state.cachedTopics.length) {
  return App.state.cachedTopics;
}
```

The 82 row-level calls are fired without `await` (see the `forEach` above),
so **all of them start before the first response arrives**. Even with (b)
fixed, the first render still fires 82 concurrent identical requests. A
shared promise is what is missing, not a bigger cache.

## 3. Why 694 and not 82

82 rows is the runs table alone. The screen also calls
`populateTopicsDropdown` from `renderTopicControls()` (5 selects),
`syncYoutubeMinerContentFilters()`, and the comment miner, and several of
these re-run on re-render. Do not treat 694 as a magic number — treat it as
"one request per topic dropdown, per render, forever".

## 4. The fix, in the order I would do it

1. **Deduplicate in flight.** In `ensureMessagingTopicsLoaded`, hold the
   in-flight promise on `App.state` and return it to concurrent callers.
   This alone collapses 694 → 1 and is the smallest change.
2. **Cache empty results too.** Replace the `length > 0` guard with a
   loaded-flag, so "this project has no topics" is a cached answer rather
   than a permanent miss.
   **Watch out:** `App.state.cachedTopics` is assigned in exactly one place
   (`core.js:1027`) and **cleared nowhere** — checked with
   `grep -rn "cachedTopics" public/js/`. Nothing resets it when the session
   project changes, so today a project switch keeps the previous project's
   topic list. That is a latent bug of its own; fixing (2) without adding
   invalidation makes it *stickier*, because empty results will cache too.
   Add the invalidation in the same change — `switchSessionProject` in
   `public/js/projectContext.js` is the hook.
3. **Then reconsider the per-row dropdown.** Even with one request, building
   82 `<select>` elements each holding every topic is wasteful DOM. Options:
   build the `<option>` list once and clone it, or render the topic as text
   and swap in a select on click. This is a UI change and wants the
   operator's sign-off — it is not required to fix the request storm.

**Do 1 and 2 first and re-measure.** They are localized to `core.js` and
should need no change to any caller.

## 5. Landmines

- `public/js/` is **frozen** (root `CLAUDE.md` landmine 3): bug fixes only,
  no new files. This is a bug fix, so it qualifies — but it is also parsed by
  nothing but the browser. Run `npm run check:syntax`, and **open the app and
  watch the console**, because a typo like `App.state.cachedTopicsPromsie`
  parses fine and fails silently at runtime (landmine 9).
- `App.state.cachedTopics` is read in several files. Grep before renaming
  anything: `grep -rn "cachedTopics" public/js/`.
- Do **not** raise `LIMITS.global` in `lib/rateLimiter.js` to make the
  symptom go away. The limit is a real protection; 694 requests for one
  screen is the bug.

## 6. How to verify — the whole point

The harness that found this will confirm the fix. From the repo root:

```bash
npm run dev                                  # in another shell
npm run seed:ui-fixture                      # once; prints a project id
export UI_HARNESS_PROJECT_ID=<that id>
```

Then count requests directly. This is the script that produced §1 — keep it
or inline it; it is ~15 lines:

```js
import { launch, signIn, activateProject, gotoScreen }
  from './scripts/ui/app-driver.mjs';
const { browser, page } = await launch({ width: 1440 });
const counts = new Map();
page.on('request', (r) => {
  const u = new URL(r.url()).pathname;
  if (u.startsWith('/api/')) counts.set(u, (counts.get(u) || 0) + 1);
});
await signIn(page);
await activateProject(page, process.env.UI_HARNESS_PROJECT_ID);
await gotoScreen(page, 'acquireYoutubePage');
[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  .forEach(([u, n]) => console.log(n, u));
await browser.close();
```

**Target: `/api/messaging/topics` appears once, not 694 times.**

Then run `npm run check:screens -- --screen acquireYoutubePage`. It reports
any HTTP 429s and declares the run unreliable when it sees them — if that
warning is gone, the storm is gone. **Restart `npm run dev` before each
measurement run**, because the limiter's window is per-process and a
previous run's throttling will poison the next.

Test the empty case *and* the populated case: the fixture project has no
topics (worst case for defect (b)); a project with topics exercises the
normal path.

## 7. What this unblocks

The YouTube runs table still sits at T7 rung 12 — 88px hidden at 1440 after
PR #139 took it down from 199px. I stopped tuning it because the page would
not hold still long enough to measure. Once the storm is fixed, finishing
that is a short job with `npm run check:screens`.

## 8. Reading

| Doc | Why |
|---|---|
| `CLAUDE.md` (root) | repo invariants; landmines 3 and 9 both apply here |
| `docs/UI_RULES.md` §"Checking these rules" | how to run the harness |
| `scripts/ui/app-driver.mjs` | the driver, and the traps it encodes |
| `lib/rateLimiter.js` | the 500/min ceiling this exceeds |
| PR #139 | where this was found, and the table work it blocks |
