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
 * THE ALLOWLIST IS DELIBERATE, AND IT SHRINKS. This ticket's non-goals forbid
 * migrating the other callers here — clickup_direct.mjs alone is 4100 lines and
 * the slice has to stay reviewable. Without an allowlist this test could not be
 * written at all until every slice landed, which is how a guard ends up never
 * being written. Each entry names the ticket that removes it. Adding a NEW file
 * to this list is not a fix; migrating it is.
 */
const NOT_YET_MIGRATED = new Map([
  ['scripts/pipeline.mjs', '86bbugcpa'],
  ['scripts/pulse.cjs', '86bbugcpa'],
  ['scripts/review_gate.mjs', '86bbugcpa'],
]);

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
  assert.match(door, /await fetch\(url, init\)/);
});

/*
 * THE DETECTOR MUST BE ABLE TO FIND SOMETHING, or the guard above passes for
 * the wrong reason forever. The three not-yet-migrated files are known,
 * present offenders — so they double as the detector's own control. When the
 * next slice migrates them, this test is what says the allowlist is stale.
 */
test('the detector really detects — every allowlisted file still has a bare ClickUp fetch', () => {
  for (const file of NOT_YET_MIGRATED.keys()) {
    const hits = bareClickUpFetches(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    assert.ok(hits.length >= 1,
      `${file} no longer has a bare ClickUp fetch — it is migrated, so remove it from NOT_YET_MIGRATED`);
  }
});

test('a comment mentioning fetch does not count as one', () => {
  const src = '// const x = await fetch(`https://api.clickup.com/api/v2/x`)\nconst y = 1;';
  assert.deepEqual(bareClickUpFetches(src), [], 'comments are stripped before matching');
});

test('the migrated file has no bare ClickUp fetch left', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/clickup_direct.mjs'), 'utf8');
  assert.deepEqual(bareClickUpFetches(src), [], 'clickup_direct.mjs is migrated (task 86bbugcdb)');
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
