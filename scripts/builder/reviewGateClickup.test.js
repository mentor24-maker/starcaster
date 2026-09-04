'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * NO TEST IN THIS FILE MAY REACH THE REAL CLICKUP. One of them deliberately
 * uses the shared door's own transport to prove the requests are counted, and
 * the door reads its base URL once at load — so the base is pointed at an
 * unresolvable host HERE, before the require below, rather than being left to
 * whoever happens to run the suite. A test that quietly spends a request
 * against the company's one token is a test that rate-limits the thing it is
 * checking.
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
 */
test('the default transport is the shared door, so these requests are counted', async () => {
  const { getBudget } = require('../lib/clickup.cjs');
  const before = getBudget().requests;
  // No fetchImpl passed: it must reach for the real door. An unresolvable host
  // is the cheapest real transport failure.
  const out = await migrated.readTicketComments('t', {
    token: 'tok',
    // eslint-disable-next-line no-undefined
    fetchImpl: undefined,
  });
  assert.equal(out.comments, null, 'an unreachable ClickUp reads as could-not-look');
  assert.equal(getBudget().requests, before + 1, 'the shared budget saw the attempt');
});
