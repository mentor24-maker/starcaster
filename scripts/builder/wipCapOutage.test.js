'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * THE WHOLE POINT OF THIS FILE: what `wip-check` does when ClickUp is
 * UNREACHABLE — and it has to run the real command to find out.
 *
 * Task 86bbm4zwd, review round 2. The cap must fail TOWARD the cap when it
 * cannot read the queue: exit 3 (a normal decline) or exit 0 (genuinely room),
 * never exit 1. Exit 1 means "could not tell" and `loop-build`'s SKILL.md
 * reads it as *"it proceeds deliberately … the pass is unbounded by the cap"*
 * — so an exit 1 here does not stop the loop, it UNCAPS it. That is the
 * inverted safety property this ticket exists to close, and round 2 found it
 * still open through a second door: `fetch` REJECTS on a transport failure
 * (DNS, TLS, offline, timeout) rather than returning a non-ok response, and
 * the rejection reached the top-level await unhandled.
 *
 * WHY A SPAWNED PROCESS AND NOT A UNIT TEST. A source-text assertion cannot
 * see this: the try/catch was *present and correct-looking* both times it was
 * wrong (round 1 it sat around a `die()`-ing call so it never ran; round 2 it
 * did not cover the throw at all). The only assertion that can fail is the
 * exit code of the real command with a real failure underneath it. So these
 * tests run `scripts/clickup_direct.mjs wip-check` for real, with `fetch`
 * replaced by a rejecting stub and `gh` replaced by a script on PATH.
 *
 * BREAK-TESTED. Each case below names the edit that makes it fail; every one
 * was made, watched to fail, and reverted before this file was committed.
 */

const REPO_SCRIPT = path.join(__dirname, '../clickup_direct.mjs');

/**
 * Run the real `wip-check` in a sandbox: a fake `gh` first on PATH, and a
 * preload module that replaces global `fetch` before the command loads.
 *
 * @param {object} o
 * @param {string} o.fetchStub  the body of the replacement fetch, as source
 * @param {string} o.prsJson    what the fake `gh pr list --json ...` prints
 */
function runWipCheck({ fetchStub, prsJson, cap = '5' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipcheck-'));
  try {
    // A `gh` that answers only the call wip-check makes, and fails loudly on
    // anything else — so a future change that shells out to gh for something
    // new cannot silently get an empty answer here and look fine.
    const ghPath = path.join(dir, 'gh');
    fs.writeFileSync(ghPath,
      '#!/bin/sh\n'
      + 'case "$*" in\n'
      + `  *"pr list"*) cat <<'JSON'\n${prsJson}\nJSON\n    ;;\n`
      + '  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;\n'
      + 'esac\n');
    fs.chmodSync(ghPath, 0o755);

    const preload = path.join(dir, 'preload.cjs');
    fs.writeFileSync(preload, `globalThis.fetch = ${fetchStub};\n`);

    return spawnSync(process.execPath, ['-r', preload, REPO_SCRIPT, 'wip-check'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CLICKUP_API_TOKEN: 'test-token-not-a-real-one',
        CLAUDE_LOOP_WIP_CAP: cap,
      },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Six open PRs, each linking a ticket — six is above a cap of five, so the
 *  conservative fallback must DECLINE and the assertion has teeth. */
const SIX_OPEN = JSON.stringify([1, 2, 3, 4, 5, 6].map((n) => ({
  number: n, state: 'OPEN',
  body: `Ticket: https://app.clickup.com/t/tkt${n}\n`,
})));

const THROWS = '(async () => { throw new Error("fetch failed"); })';

test('ClickUp unreachable: the pass declines, and NEVER exits 1', () => {
  // BREAK TEST: delete BOTH try/catches (the one in `call()` and the one at
  // the wip-check call site) and this exits 1 with an unhandled-rejection
  // stack trace. Watched fail.
  const out = runWipCheck({ fetchStub: THROWS, prsJson: SIX_OPEN });
  assert.notEqual(out.status, 1,
    `exit 1 means "proceed, unbounded by the cap" — a network blip must not uncap the loop.\n${out.stderr}`);
  assert.equal(out.status, 3, `6 open PRs against a cap of 5 must decline.\n${out.stderr}`);
  assert.match(out.stdout, /cap 5/);
  assert.match(`${out.stdout}${out.stderr}`, /could not be read|NOT available/i,
    'and it must SAY it is counting blind, not decline silently');
  // AND it must get there by `call()` converting the rejection into a non-ok
  // response (status 0), not by the outer catch mopping it up. Asserting the
  // exit code alone could not tell those apart — and would then pass on a
  // build where `call()` had stopped catching, leaving every OTHER command
  // dying with a stack trace. See the note above `unreachable()`.
  assert.match(out.stderr, /HTTP 0/,
    'a transport failure must arrive as a non-ok response, not as a thrown exception');
});

test('ClickUp unreachable with little in flight: it still claims, quietly correct', () => {
  // The other half of the property. Failing toward the cap must not become
  // "refuse always" — that would be a silent way for the loop to stop working,
  // which the wipCap tests call the worst outcome of all.
  const two = JSON.stringify([1, 2].map((n) => ({
    number: n, state: 'OPEN', body: `Ticket: https://app.clickup.com/t/tkt${n}\n`,
  })));
  const out = runWipCheck({ fetchStub: THROWS, prsJson: two });
  assert.equal(out.status, 0, `2 open against a cap of 5 is room to claim.\n${out.stderr}`);
});

test('a 200 carrying a non-JSON body is a failed read, not an empty queue', () => {
  // BREAK TEST: restore `tasks.push(...out.json.tasks)` without the
  // Array.isArray guard and this exits 1 — spreading `null.tasks` throws
  // exactly like the transport failure, straight past the fatal:false
  // contract. An HTML error page from a proxy is the real-world shape.
  const stub = '(async () => ({ ok: true, status: 200,'
    + ' headers: { get: () => null },'
    + ' text: async () => "<html>502 Bad Gateway</html>" }))';
  const out = runWipCheck({ fetchStub: stub, prsJson: SIX_OPEN });
  assert.equal(out.status, 3,
    `a junk body must fall back to the stricter counting, not exit 1.\n${out.stderr}`);
  // THE ASSERTION THAT ACTUALLY PINS THE GUARD, and the reason it is here.
  // With only the exit code asserted, this test PASSED with the unguarded
  // spread restored: the outer catch at the call site swallowed the TypeError
  // and produced the same exit 3. A green test that cannot fail is precisely
  // the shape this ticket exists to stamp out, so the assertion names the
  // reason `fetchAllTasks` reports — which the outer catch cannot fake,
  // because what it catches says "Cannot read properties of null" instead.
  assert.match(out.stderr, /the response body was not the expected JSON/,
    'the junk body must be recognised as such by fetchAllTasks, not caught downstream');
});

test('a routine 429 declines conservatively — the round 1 path, still closed', () => {
  // Kept because it is the cheapest regression guard on the fatal:false
  // contract: ClickUp throttles at ~100 requests a minute and the loops share
  // that budget, so this is the failure most likely to actually happen.
  const stub = '(async () => ({ ok: false, status: 429,'
    + ' headers: { get: () => null }, text: async () => "{\\"err\\":\\"rate limit\\"}" }))';
  const out = runWipCheck({ fetchStub: stub, prsJson: SIX_OPEN });
  assert.equal(out.status, 3, `a 429 must decline, never exit 1.\n${out.stderr}`);
});

test('the queue read succeeding still governs the answer', () => {
  // The control. Without it every test above would pass on a wip-check that
  // had stopped reading ClickUp altogether — the instrument proving itself
  // before its readings are trusted (docs/VISUAL_REVIEW.md, same principle).
  // Six open PRs, but every ticket is Queued rework, so NOTHING is in flight.
  const tasks = JSON.stringify({
    tasks: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `tkt${n}`, status: { status: 'Queued' } })),
    last_page: true,
  });
  const stub = '(async () => ({ ok: true, status: 200, headers: { get: () => null },'
    + ` text: async () => ${JSON.stringify(tasks)} }))`;
  const out = runWipCheck({ fetchStub: stub, prsJson: SIX_OPEN });
  assert.equal(out.status, 0,
    `6 open PRs whose tickets are all Queued rework must NOT cap the loop — that is the deadlock.\n${out.stderr}`);
  assert.match(out.stdout, /0 in flight, cap 5/);
  assert.match(out.stdout, /6 queued for rework/);
});
