'use strict';

// SC-870: `npm run spirality:pin` says out loud when GitHub's checks
// (.spirality-release) and StarCaster's lanes use different Spirality releases.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pin = require('../../lib/spiralityPin.js');
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'spirality_pin.mjs');

test('three verdicts: in step, out of step, and cannot tell — never a blank read as fine', () => {
  assert.equal(pin.judge({ pinned: 'release-2', lanes: 'release-2' }).verdict, pin.VERDICT.IN_STEP);
  const out = pin.judge({ pinned: 'release-2', lanes: 'release-3' });
  assert.equal(out.verdict, pin.VERDICT.OUT_OF_STEP);
  assert.match(out.reason, /checks use release-2, the lanes run release-3/);
  assert.equal(pin.judge({ pinned: 'release-2', lanes: '' }).verdict, pin.VERDICT.CANNOT_TELL);
  assert.equal(pin.judge({ pinned: '', lanes: 'release-2', error: 'gone' }).verdict, pin.VERDICT.CANNOT_TELL);
});

test('each alarm is said once a day, and one all-clear follows a posted alarm', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const out = pin.judge({ pinned: 'release-2', lanes: 'release-3' });
  const first = pin.plan({ judged: out, state: {}, now });
  assert.equal(first.out, true);
  const again = pin.plan({ judged: out, state: first.next, now: now + 60 * 60 * 1000 });
  assert.equal(again.out, false, 'not again within the day');
  const nextDay = pin.plan({ judged: out, state: first.next, now: now + pin.DAY_MS + 1 });
  assert.equal(nextDay.out, true);
  const fine = pin.plan({ judged: pin.judge({ pinned: 'release-3', lanes: 'release-3' }), state: first.next, now });
  assert.equal(fine.cleared, true);
  assert.deepEqual(fine.next, { outAt: '', cannotTellAt: '' });
  const quiet = pin.plan({ judged: pin.judge({ pinned: 'release-3', lanes: 'release-3' }), state: fine.next, now });
  assert.equal(quiet.cleared, false, 'an all-clear only after an alarm');
});

test('the out-of-step post names both releases and the fix', () => {
  const text = pin.renderOut({ judged: pin.judge({ pinned: 'release-2', lanes: 'release-3' }), node: 'mac-mini', at: 'now' });
  assert.match(text, /names release-2/);
  assert.match(text, /changing \.spirality-release to release-3/);
});

function run(releasesDir, extra = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, SPIRALITY_RELEASES_DIR: releasesDir, SPIRALITY_PIN_STAMP: path.join(releasesDir, 'stamp.json') },
  });
}

test('the script reads the lanes\' release record and exits with the verdict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc870-pin-'));
  const pinned = require('../../lib/spirality.cjs').pinnedRelease();
  let r = run(dir);
  assert.equal(r.status, 2, 'no record is CANNOT TELL');
  fs.writeFileSync(path.join(dir, 'last-starcaster'), `${pinned}\n`);
  r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // BREAK-TEST: the lanes move on, the pin does not.
  fs.writeFileSync(path.join(dir, 'last-starcaster'), 'release-999\n');
  r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /OUT OF STEP/);
});

test('the relay asks it on every wake, and never lets it fail the wake', () => {
  const relay = fs.readFileSync(path.join(ROOT, 'scripts', 'run_bus_relay.sh'), 'utf8');
  assert.match(relay, /^npm run --silent spirality:pin -- --check \|\| true$/m);
});
