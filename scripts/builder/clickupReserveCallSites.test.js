'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/*
 * EVERY CALLER OF THE DOOR HANDLES ITS THIRD OUTCOME (2026-09-15, task
 * 86bc0w6my).
 *
 * `clickupFetch` returns one of three things: a response, a transport error,
 * or a YIELD — a scheduled job declining to spend the last of the minute's
 * ClickUp budget so a session Dane is talking to is never blocked. A yield
 * hands back `res: null`.
 *
 * The docstring on that branch said "both call sites handle it by name". There
 * were five. Four of them wrote `const { res } = out; res.ok` and crashed with
 * `TypeError: Cannot read properties of null (reading 'ok')`, which every
 * layer above then dressed up as a network fault. On 2026-09-15 that stopped
 * the build and review loops on the Mini for hours, each pass reporting "the
 * pipeline is being treated as PAUSED" while the pipeline was running — a
 * perfectly normal thing for a pass to say, so nobody looked.
 *
 * WHY A GUARD AND NOT FOUR EDITS. Four independent authors each forgot the
 * same branch, and the fifth call site (`lib/clickupForward.js`) was not even
 * in the ticket that found the other four — it was discovered by grep while
 * fixing them. A rule that depends on remembering has already been measured
 * failing five times out of six. Modelled on `clickupOneDoor.test.js`, which
 * guards the door's other invariant the same way.
 *
 * WHAT IT ASSERTS, precisely: every function outside the door that calls
 * `clickupFetch(` also mentions `yielded` or `stoppedAtReserve` somewhere in
 * the same function body. That is a coarse check on purpose — it cannot prove
 * the handling is CORRECT — but the failure it exists against is not subtle
 * handling, it is no handling at all.
 */

/** The one file allowed to PRODUCE a yield rather than handle one. */
const THE_DOOR = path.join('scripts', 'lib', 'clickup.cjs');

/* Same walk as clickupOneDoor.test.js, and for the same reason: a denylist so
 * a new top-level folder is covered the day it appears, rather than being
 * invisible until somebody remembers this file. */
const NOT_WALKED = new Set(['node_modules', 'components', 'src', 'public', 'archive']);
const SOURCE_FILE = /\.(mjs|cjs|js|ts|tsx)$/;
const TEST_FILE = /\.test\.(mjs|cjs|js|ts|tsx)$/;

function sourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (NOT_WALKED.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The body of each function that calls `clickupFetch(`, found by brace
 * matching backwards from the call to the enclosing `function`/`=>` and
 * forwards to its close.
 *
 * Comments are stripped FIRST. This repo has twice had a source-anchored
 * assertion pass because it measured a comment that quoted the very string it
 * was searching for — including, very nearly, this one: the door's own
 * docstring contains the word `yielded` several times over.
 */
function callSiteBodies(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  const bodies = [];
  const re = /clickupFetch\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    // Walk back to the nearest enclosing `{` that opens a function body, by
    // counting braces backwards until one is unmatched.
    let depth = 0;
    let start = m.index;
    for (let i = m.index; i >= 0; i -= 1) {
      if (code[i] === '}') depth += 1;
      else if (code[i] === '{') {
        if (depth === 0) { start = i; break; }
        depth -= 1;
      }
    }
    // ...and forwards to the matching close.
    let end = code.length;
    depth = 0;
    for (let i = start; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    bodies.push({ index: m.index, body: code.slice(start, end + 1) });
  }
  return bodies;
}

function handlesYield(body) {
  return /\byielded\b|\bstoppedAtReserve\b/.test(body);
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

test('every caller of clickupFetch handles the yield', () => {
  const offenders = [];
  for (const full of sourceFiles(ROOT)) {
    const rel = path.relative(ROOT, full);
    if (rel === THE_DOOR) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const site of callSiteBodies(src)) {
      if (handlesYield(site.body)) continue;
      offenders.push(`${rel}:${lineOf(src, site.index)}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a caller of clickupFetch that never mentions `yielded` dereferences a null `res` when a '
    + 'scheduled job stops at the ClickUp reserve — use yieldedResult/stoppedAtReserve from '
    + 'scripts/lib/clickup.cjs. See the block above `callOnce` there for what this cost.');
});

/*
 * THE DETECTOR MUST BE ABLE TO FIND SOMETHING, or the test above passes for
 * the wrong reason forever. Both directions, because a brace-matcher can fail
 * either way: too greedy and it swallows a neighbouring function that DOES
 * handle the yield, which is a false pass.
 */
test('the detector sees an unhandled call site', () => {
  const src = [
    'async function good(url) {',
    '  const out = await clickupFetch(url, {});',
    '  if (out.yielded) return null;',
    '  return out.res.ok;',
    '}',
    'async function bad(url) {',
    '  const out = await clickupFetch(url, {});',
    '  return out.res.ok;',
    '}',
  ].join('\n');
  const sites = callSiteBodies(src);
  assert.equal(sites.length, 2, 'both call sites must be found');
  assert.equal(handlesYield(sites[0].body), true, 'the handled one must read as handled');
  assert.equal(handlesYield(sites[1].body), false,
    'the unhandled one must read as unhandled — if the brace walk swallowed the function above '
    + 'it, every offender in the repo reads as clean');
});

test('a yield mentioned only in a COMMENT does not count as handling it', () => {
  const src = [
    'async function bad(url) {',
    '  // out.yielded is a thing we should probably check one day',
    '  /* yielded */',
    '  const out = await clickupFetch(url, {});',
    '  return out.res.ok;',
    '}',
  ].join('\n');
  const [site] = callSiteBodies(src);
  assert.equal(handlesYield(site.body), false,
    'comments are stripped before the check — a note about the yield is not the check');
});

test('the walk reaches every tree that could hold a ClickUp call', () => {
  const walked = sourceFiles(ROOT).map((f) => path.relative(ROOT, f));
  for (const tree of ['api', 'lib', 'routes', 'scripts']) {
    assert.ok(
      walked.some((rel) => rel.startsWith(`${tree}${path.sep}`)),
      `the walk opened no file under ${tree}/ — it has narrowed, and the guard is blind there `
      + 'while still reporting a clean repo',
    );
  }
});
