'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/*
 * ONE DOOR TO CLICKUP (2026-09-03, task 86bbugcdb).
 *
 * ClickUp's limit is per TOKEN and there is one token for the whole company.
 * Six files each opened their own connection to api.clickup.com; four counted
 * nothing, and the one that read `x-ratelimit-*` printed the numbers and threw
 * them away. So nothing could answer "how much budget is left?" — and on
 * 2026-09-03 a bus-relay pass spending 114 requests against a ~100/minute
 * allowance was rate-limited on every pass, which disabled the auto-merge lane
 * for 271 consecutive passes.
 *
 * THE ALLOWLIST IS DELIBERATE, AND IT SHRINKS — and as of 2026-09-04 it is
 * empty. It was never a place to park work: each entry named the ticket that
 * removed it, and every one of those tickets has now landed.
 */
/*
 * EMPTY SINCE 2026-09-04 (task 86bbugcpa). `pipeline.mjs`, `pulse.cjs` and
 * `review_gate.mjs` were the last three, and they are migrated — every ClickUp
 * request in the repo now goes through the door and is counted.
 *
 * It stays as a Map rather than being deleted because the shape is the point:
 * a future slice that genuinely cannot migrate in one go has somewhere honest
 * to say so, naming the ticket that empties it again. Adding an entry is not a
 * fix; it is a debt with a name on it.
 */
const NOT_YET_MIGRATED = new Map([]);

/** The one file allowed to call fetch against ClickUp. */
const THE_DOOR = 'scripts/lib/clickup.cjs';

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|cjs|js)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A bare fetch whose URL mentions ClickUp. Comments are stripped first: this
 *  repo has twice had a source-anchored assertion measure a COMMENT that
 *  quoted the very string it was searching for. */
function bareClickUpFetches(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hits = [];
  const re = /(?:await\s+)?fetch\s*\(\s*([`'"][^`'"]*)/g;
  let m;
  while ((m = re.exec(code))) {
    if (/api\.clickup\.com|\$\{API_BASE\}/.test(m[1])) hits.push(m[1].slice(0, 60));
  }
  return hits;
}

test('exactly one function in the repo calls fetch against api.clickup.com', () => {
  const offenders = [];
  for (const full of [...sourceFiles(path.join(ROOT, 'scripts')), ...sourceFiles(path.join(ROOT, 'lib'))]) {
    const rel = path.relative(ROOT, full);
    if (rel === THE_DOOR) continue;
    const hits = bareClickUpFetches(fs.readFileSync(full, 'utf8'));
    if (!hits.length) continue;
    if (NOT_YET_MIGRATED.has(rel)) continue;
    offenders.push(`${rel} (${hits.length}): ${hits.join(' | ')}`);
  }
  assert.deepEqual(offenders, [],
    'a ClickUp request outside the shared client is an uncounted request — route it through clickupFetch');
});

test('the door itself really is the fetch call', () => {
  const door = fs.readFileSync(path.join(ROOT, THE_DOOR), 'utf8');
  // Structural, not textual: the door takes its URL as a PARAMETER, so it
  // carries no literal api.clickup.com for the detector above to find. That is
  // the point of a door.
  assert.match(door, /async function clickupFetch\(/);
  // The transport is a parameter now (task 86bbugcpa) so that a caller with
  // its own test fakes comes THROUGH the door rather than around it. What is
  // asserted is still structural: the door is the thing that calls out.
  assert.match(door, /await fetchImpl\(url, init\)/);
  assert.match(door, /\{ fetchImpl = fetch \} = \{\}/,
    'the default transport must still be the real fetch');
});

/*
 * THE DETECTOR MUST BE ABLE TO FIND SOMETHING, or the guard above passes for
 * the wrong reason forever.
 *
 * Until 2026-09-04 its control was the not-yet-migrated files themselves:
 * real, present offenders it had to keep finding. That was the right control
 * while they existed, and this slice migrated the last of them — so the
 * control had to become synthetic or the guard would have been left grading
 * itself against an empty list, which is the same as not running.
 *
 * These are the shapes the real files actually had, before each was migrated.
 */
const KNOWN_OFFENDING_SHAPES = [
  { why: 'pipeline.mjs, before migration', src: 'const res = await fetch(`https://api.clickup.com${path}`, { method });' },
  { why: 'pulse.cjs, before migration', src: 'const res = await fetch(`https://api.clickup.com${apiPath}`, { method: "GET" });' },
  { why: 'review_gate.mjs, before migration', src: 'const res = await fetch("https://api.clickup.com/api/v2/task/x/comment", {});' },
  { why: 'a call built on the shared base constant', src: 'const r = await fetch(`${API_BASE}/api/v2/task/x`, {});' },
  { why: 'no await — still a request', src: 'fetch(`https://api.clickup.com/api/v2/x`).then(f);' },
];

test('the detector really detects — every known offending shape is caught', () => {
  for (const { why, src } of KNOWN_OFFENDING_SHAPES) {
    assert.ok(bareClickUpFetches(src).length >= 1, `the detector went blind to: ${why}`);
  }
});

/*
 * AND THE SHAPE IT USED TO MISS. `lib/clickupForward.js` resolved its
 * transport indirectly — `deps?.fetchImpl || globalThis.fetch` — so it never
 * wrote `fetch(` against a ClickUp URL and the guard above read clean while
 * the forwarder spent uncounted requests from the bug reporter's own request
 * path. It was migrated in this slice; this is what stops the pattern coming
 * back, in that file or any other.
 */
function indirectTransportFallback(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (!/api\.clickup\.com|API_BASE/.test(code)) return [];
  const hits = [];
  const re = /(?:\|\|\s*globalThis\.fetch|\|\|\s*global\.fetch|=\s*globalThis\.fetch\b)/g;
  let m;
  while ((m = re.exec(code))) hits.push(m[0].trim());
  return hits;
}

test('no ClickUp caller resolves its own transport behind the door\'s back', () => {
  const offenders = [];
  for (const full of [...sourceFiles(path.join(ROOT, 'scripts')), ...sourceFiles(path.join(ROOT, 'lib'))]) {
    const rel = path.relative(ROOT, full);
    if (rel === THE_DOOR) continue;
    const hits = indirectTransportFallback(fs.readFileSync(full, 'utf8'));
    if (hits.length) offenders.push(`${rel}: ${hits.join(' | ')}`);
  }
  assert.deepEqual(offenders, [],
    'falling back to globalThis.fetch is a second door the uniqueness check cannot see — '
    + 'pass your fetch to clickupFetch as { fetchImpl } instead, so the request is still counted');
});

test('the indirect detector really detects', () => {
  const shape = 'const API_BASE = "https://api.clickup.com";\nconst f = deps?.fetchImpl || globalThis.fetch;';
  assert.ok(indirectTransportFallback(shape).length >= 1, 'the pattern that hid clickupForward must be caught');
  // And it must not fire on a file that has nothing to do with ClickUp.
  assert.deepEqual(indirectTransportFallback('const f = deps.fetchImpl || globalThis.fetch;'), []);
});

test('a comment mentioning fetch does not count as one', () => {
  const src = '// const x = await fetch(`https://api.clickup.com/api/v2/x`)\nconst y = 1;';
  assert.deepEqual(bareClickUpFetches(src), [], 'comments are stripped before matching');
});

test('every migrated file has no bare ClickUp fetch left', () => {
  const MIGRATED = [
    ['scripts/clickup_direct.mjs', '86bbugcdb'],
    ['scripts/pipeline.mjs', '86bbugcpa'],
    ['scripts/pulse.cjs', '86bbugcpa'],
    ['scripts/review_gate.mjs', '86bbugcpa'],
    ['lib/clickupForward.js', '86bbugcpa'],
  ];
  for (const [file, ticket] of MIGRATED) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.deepEqual(bareClickUpFetches(src), [], `${file} is migrated (task ${ticket})`);
  }
});

/*
 * The allowlist must not become a place to park new work. Every entry names
 * the ticket that deletes it, and this test fails if one stops doing so.
 */
test('every not-yet-migrated file names the ticket that removes it', () => {
  for (const [file, ticket] of NOT_YET_MIGRATED) {
    assert.match(ticket, /^86b/, `${file} must name the migration ticket`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is listed but does not exist — delete the entry`);
  }
});

/*
 * THE NO-THROW CONTRACT (task 86bbm4zwd). `fetch` rejects on a transport
 * failure; when that rejection escaped it killed the process with exit 1, and
 * loop-build reads exit 1 as "could not tell, so proceed, unbounded by the
 * cap". A network blip UNCAPPED the loop. The door must return, never throw.
 */
test('the door returns a transport failure instead of throwing it', async () => {
  const { clickupFetch, getBudget } = require('../lib/clickup.cjs');
  const before = getBudget().requests;
  // A host that cannot resolve is the cheapest real transport failure.
  const out = await clickupFetch('https://api.clickup.com.invalid-tld-for-this-test/api/v2/task/x', { method: 'GET' });
  assert.equal(out.transportError instanceof Error, true, 'it must hand the error back');
  assert.equal(out.res, null);
  assert.equal(getBudget().requests, before + 1, 'and count the ATTEMPT, not the success');
});
