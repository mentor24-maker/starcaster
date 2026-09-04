'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * NO TEST IN THIS FILE MAY REACH THE REAL CLICKUP. A test that quietly spends
 * a request against the company's one token is a test that rate-limits the
 * thing it is checking.
 *
 * This line is the FILE-level backstop, and it has to sit above the require
 * because the door reads its base URL once at load. It covers any test added
 * here later that forgets to think about it. The one test that exercises the
 * default transport does not rely on it — it substitutes the transport
 * outright, and says so where it does it — so this is belt and braces rather
 * than the only guard.
 */
process.env.CLICKUP_API_BASE = 'https://api.clickup.com.invalid-tld-for-this-test';

const migrated = require('./reviewGateClickup.js');

/*
 * THE TOKEN PIN (2026-09-04, task 86bbugcpa).
 *
 * `review_gate` runs in CI, and CI's ClickUp token has expired silently
 * before — the known failure being a gate that keeps answering while its token
 * is dead. So what it does with a MISSING or EXPIRED token is the part of it
 * that must survive a transport migration untouched.
 *
 * This does not assert a list of strings somebody transcribed out of the old
 * file, because a transcription proves only that two things agree with the
 * transcriber. It runs the ORIGINAL implementation — copied verbatim from
 * scripts/review_gate.mjs at commit 6c4651dd, before any of this ticket's
 * changes — as a CONTROL, and asserts the migrated one answers identically
 * across every token scenario.
 *
 * The control is deliberately frozen. If a future change means to alter this
 * behaviour, it has to edit the control too, and that edit is the thing a
 * reviewer will see.
 */

// ── THE CONTROL: the pre-migration originals, verbatim ───────────────────────
// They call `fetchImpl` (bare `fetch` in the original) and catch rejections,
// because that is what the old transport did.

async function originalReadTicketComments(taskId, { token, fetchImpl }) {
  if (!token) {
    return { comments: null, why: 'CLICKUP_API_TOKEN is not set in this job — the CI secret is missing' };
  }
  try {
    const res = await fetchImpl(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}/comment`, {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { comments: null, why: `ClickUp answered HTTP ${res.status}` };
    const json = await res.json();
    if (!Array.isArray(json?.comments)) return { comments: null, why: 'ClickUp returned no comment list' };
    return { comments: json.comments, why: '' };
  } catch (err) {
    return { comments: null, why: `ClickUp is unreachable: ${err?.message || err}` };
  }
}

async function originalAnnounceWaiver(content, { token, workspace, busChannel, fetchImpl }) {
  if (!token) return { ok: false, why: 'no ClickUp token in this job' };
  try {
    const res = await fetchImpl(
      `https://api.clickup.com/api/v3/workspaces/${workspace}/chat/channels/${busChannel}/messages`,
      {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'message', content, content_format: 'text/md' }),
      },
    );
    return { ok: res.ok, why: res.ok ? '' : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, why: String(err?.message || err) };
  }
}

// ── The scenarios, each expressed twice: as a raw fetch, and as a door ───────
/*
 * The two transports have DIFFERENT contracts, which is the whole hazard this
 * pin exists for: bare `fetch` REJECTS on a transport failure, the shared door
 * RETURNS `{ transportError }` and never throws. Each scenario therefore
 * supplies both shapes of the same underlying event, so the comparison is
 * between the two implementations rather than between two mocks.
 */
const SCENARIOS = [
  {
    name: 'a healthy 200 with comments',
    raw: async () => ({ ok: true, status: 200, json: async () => ({ comments: [{ comment_text: 'hi' }] }) }),
    door: async () => ({ res: { ok: true, status: 200 }, json: { comments: [{ comment_text: 'hi' }] }, text: '', transportError: null }),
  },
  {
    name: 'an EXPIRED token — HTTP 401',
    raw: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    door: async () => ({ res: { ok: false, status: 401 }, json: {}, text: '', transportError: null }),
  },
  {
    name: 'a revoked token — HTTP 403',
    raw: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    door: async () => ({ res: { ok: false, status: 403 }, json: {}, text: '', transportError: null }),
  },
  {
    name: 'rate limited — HTTP 429',
    raw: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    door: async () => ({ res: { ok: false, status: 429 }, json: {}, text: '', transportError: null }),
  },
  {
    name: 'a 200 whose body carries no comment list',
    raw: async () => ({ ok: true, status: 200, json: async () => ({ err: 'nope' }) }),
    door: async () => ({ res: { ok: true, status: 200 }, json: { err: 'nope' }, text: '', transportError: null }),
  },
  {
    name: 'ClickUp unreachable — a transport failure',
    raw: async () => { throw new Error('getaddrinfo ENOTFOUND api.clickup.com'); },
    door: async () => ({ res: null, json: null, text: null, transportError: new Error('getaddrinfo ENOTFOUND api.clickup.com') }),
  },
];

test('readTicketComments answers exactly as it did before the migration', async () => {
  for (const s of SCENARIOS) {
    const before = await originalReadTicketComments('86bbugcpa', { token: 'tok', fetchImpl: s.raw });
    const after = await migrated.readTicketComments('86bbugcpa', { token: 'tok', fetchImpl: s.door });
    assert.deepEqual(after, before, `${s.name}: the migrated reader must answer identically`);
  }
});

test('announceWaiver answers exactly as it did before the migration', async () => {
  for (const s of SCENARIOS) {
    const opts = { token: 'tok', workspace: '90141423066', busChannel: '2kydhxeu-474' };
    const before = await originalAnnounceWaiver('x', { ...opts, fetchImpl: s.raw });
    const after = await migrated.announceWaiver('x', { ...opts, fetchImpl: s.door });
    assert.deepEqual(after, before, `${s.name}: the migrated announcer must answer identically`);
  }
});

/*
 * THE ONE CASE THAT REALLY DID CHANGE, PINNED AS A CHANGE (review round 1,
 * 2026-09-04).
 *
 * A 200 whose body is not JSON is the single scenario where the two
 * implementations disagree, and it was the one scenario the pin did not cover
 * while docs/WORK-LOG.md claimed it did. It cannot join SCENARIOS above,
 * because that loop asserts the two answer IDENTICALLY — so it is asserted
 * here, in both directions, with the decision written down.
 *
 * WHY THE OLD MESSAGE IS THE WRONG ONE. The original called `res.json()`
 * inside its try, so a parse failure fell into the same catch as a dead socket
 * and reported `ClickUp is unreachable: ...`. ClickUp was not unreachable: it
 * was reached, it answered, and the answer was 200. That message sends its
 * reader — somebody staring at a red check in Actions — to the network, which
 * is the one place the fault is not. The migrated message says what is true of
 * the response that arrived.
 *
 * NOTHING DOWNSTREAM MOVES. Both answers are `comments: null`, which the gate
 * turns into CANNOT TELL either way; only the reason a human reads is
 * different. That is why this is a decision recorded here rather than a
 * behaviour change needing its own ticket.
 */
test('a 200 whose body will not parse: the reason changed, deliberately', async () => {
  const parseError = new SyntaxError('Unexpected token < in JSON at position 0');
  const before = await originalReadTicketComments('t', {
    token: 'tok',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw parseError; } }),
  });
  const after = await migrated.readTicketComments('t', {
    token: 'tok',
    // What the door hands back for a body it could not parse: the response is
    // there, `json` is null, and the raw `text` is kept.
    fetchImpl: async () => ({ res: { ok: true, status: 200 }, json: null, text: '<html>502</html>', transportError: null }),
  });

  assert.equal(before.comments, null, 'the old code could not read the trail');
  assert.equal(after.comments, null, 'and neither can the new one — the VERDICT is unchanged');

  assert.equal(before.why, `ClickUp is unreachable: ${parseError.message}`,
    'the pre-migration reason, stated so the change is visible and not inferred');
  assert.equal(after.why, 'ClickUp returned no comment list',
    'the reason now describes the response that ARRIVED, rather than blaming the network');

  assert.notEqual(after.why, before.why,
    'this is the deliberate divergence — if these ever match again, this test is stale, not passing');
});

/*
 * THE MISSING-TOKEN CASE GETS ITS OWN TEST, because it is the one CI actually
 * hits and because it must not reach the network at all — a gate that spends a
 * request to discover it has no token is a gate that can be rate-limited into
 * silence. The old code returned before its try block; so must the new one.
 */
test('a MISSING token never touches the network, in either function', async () => {
  let called = 0;
  const spy = async () => { called += 1; throw new Error('the network must not be reached'); };

  const read = await migrated.readTicketComments('86bbugcpa', { token: '', fetchImpl: spy });
  assert.deepEqual(read, {
    comments: null,
    why: 'CLICKUP_API_TOKEN is not set in this job — the CI secret is missing',
  });

  const waive = await migrated.announceWaiver('x', { token: '', workspace: 'w', busChannel: 'b', fetchImpl: spy });
  assert.deepEqual(waive, { ok: false, why: 'no ClickUp token in this job' });

  assert.equal(called, 0, 'no request may be spent discovering that there is no token');
});

/*
 * "I could not look" and "I looked and there is nothing" decide opposite
 * verdicts, so the distinction is asserted on its own rather than left to ride
 * along inside a deepEqual.
 */
test('an empty comment list is NOT the same answer as an unreadable one', async () => {
  const empty = await migrated.readTicketComments('t', {
    token: 'tok',
    fetchImpl: async () => ({ res: { ok: true, status: 200 }, json: { comments: [] }, text: '', transportError: null }),
  });
  assert.deepEqual(empty.comments, [], 'a real, empty trail is an ARRAY');
  assert.equal(empty.why, '');

  const dead = await migrated.readTicketComments('t', {
    token: 'tok',
    fetchImpl: async () => ({ res: { ok: false, status: 401 }, json: {}, text: '', transportError: null }),
  });
  assert.equal(dead.comments, null, 'an unreadable trail is NULL, never an empty array');
  assert.match(dead.why, /401/);
});

/*
 * And the point of the whole ticket: these requests must now be COUNTED. A
 * migration that kept every string identical but still bypassed the shared
 * door would pass every test above and change nothing that mattered.
 *
 * This is the only test that exercises the DEFAULT transport, so it is the
 * only one that could reach the real ClickUp. TWO separate things stop it,
 * and they are not redundant:
 *
 *   - The `CLICKUP_API_BASE` assignment at the top of this file. That is the
 *     FILE-level backstop: it covers any future test here that forgets, and
 *     it is why nothing in this file has ever spent a request against the
 *     company's token. It leans on DNS refusing the name, though, and a
 *     resolver that wildcards unknown names onto a captive portal would turn
 *     that into a request to a stranger.
 *   - The substitution below. That is what THIS test does. `clickupFetch`
 *     resolves its transport from the ambient `fetch` at call time, so
 *     replacing that exercises the real default path with no socket opened at
 *     all — and it asserts strictly more than watching a counter move, because
 *     it proves the shared door was the thing that ran the request rather than
 *     something else that happened to increment.
 *
 * The substitute is restored in a `finally`. A leaked spy would silently mute
 * every test that ran after this one, which is a worse failure than the one it
 * is guarding against.
 */
test('the default transport is the shared door, so these requests are counted', async () => {
  const { getBudget } = require('../lib/clickup.cjs');
  const before = getBudget().requests;

  const realFetch = globalThis.fetch;
  const throughTheDoor = [];
  globalThis.fetch = async (url) => {
    throughTheDoor.push(String(url));
    return { ok: false, status: 401, headers: { get: () => null }, text: async () => '{}' };
  };

  let out;
  try {
    // Still no fetchImpl: the reader has to reach for the real door.
    out = await migrated.readTicketComments('t', {
      token: 'tok',
      // eslint-disable-next-line no-undefined
      fetchImpl: undefined,
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(throughTheDoor.length, 1,
    'the shared door ran this request — a reader that fetched for itself would never come through here');
  assert.equal(throughTheDoor[0], `${migrated.API_BASE}/api/v2/task/t/comment`,
    'and it ran the URL this reader asked for');
  assert.equal(out.comments, null, 'a 401 reads as could-not-look, never as an empty trail');
  assert.equal(getBudget().requests, before + 1, 'the shared budget saw the attempt');

  assert.equal(globalThis.fetch, realFetch,
    'and the substitute is PUT BACK — a leaked spy would silently mute every test after this one, '
    + 'so the restore is asserted rather than left as a comment nobody can fail');
});

/*
 * THE HEADER MUST NAME PARAMETERS THAT EXIST (review round 3, 2026-09-04).
 *
 * This module's header said the transport arrives as `deps.clickupFetch`. Both
 * functions take `fetchImpl`. Nothing failed and nothing could: an unknown key
 * in a destructured options object is accepted in silence, so a test author
 * who followed the header would pass `clickupFetch:`, watch the default run
 * instead of their stub, and be testing the real transport against a real
 * token in CI without a single warning.
 *
 * That is the third comment-versus-code drift this ticket has been sent back
 * for — rounds 1, 2 and 3 were each a sentence beside a check that had stopped
 * being true. Prose is the one thing here nothing else can fail on, so this
 * asserts it: every `deps.<name>` the header mentions must be a name the
 * functions really destructure.
 */
test('every parameter the module header names is one the code accepts', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'reviewGateClickup.js'), 'utf8');

  const header = src.match(/\/\*[\s\S]*?\*\//);
  assert.ok(header, 'the module header is the thing under test — it must exist');

  const named = [...new Set([...header[0].matchAll(/deps\.(\w+)/g)].map((m) => m[1]))];
  assert.ok(named.length > 0,
    'the header describes an injected dependency — if that stops being true, '
    + 'delete this test rather than letting it pass vacuously');

  // The real parameters: whatever the functions destructure out of their
  // options object. Read from the signatures, never transcribed.
  const accepted = new Set();
  for (const sig of src.matchAll(/async function \w+\([^)]*\{([^}]*)\}\s*=\s*\{\}\s*\)/g)) {
    for (const part of sig[1].split(',')) {
      const name = part.split('=')[0].trim();
      if (name) accepted.add(name);
    }
  }
  assert.ok(accepted.has('token'), 'the signature reader found nothing — it has drifted, not the header');

  for (const name of named) {
    assert.ok(accepted.has(name),
      `the header tells the next reader to pass \`${name}\`, and neither function accepts it. `
      + `An unknown key is ignored in silence, so their stub would never run. `
      + `Accepted: ${[...accepted].join(', ')}. `
      + `(Quoting a name the code USED to accept? Write it without the \`deps.\` `
      + `prefix — this check cannot tell a history note from an instruction.)`);
  }
});
