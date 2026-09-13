'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * The relay's own posts fall back to the "Undelivered alarms" ticket
 * (task 86bbzwxrw). From 2026-09-07 the party line refused every post; the
 * daily auto-merge digest and the latch reminder used postToBus alone, so every
 * relay pass ended "could not fully verify", exited 1, and never beat — the
 * relay read QUIET for five days while doing all of its real work.
 *
 * clickup_direct.mjs is a CLI with no seams for these paths, so this reads its
 * source — comments stripped, anchored on calls rather than phrases.
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

test('the daily digest and the latch reminder post through the fallback', () => {
  assert.match(SRC, /const bus = await postOrSaveToBus\(channel, body\);\s*\n\s*if \(bus\.ok\) ledger = ledgerAfterDigest\(ledger, now\);/);
  assert.match(SRC, /const posted = await postOrSaveToBus\(channel, line\);/);
  assert.doesNotMatch(SRC, /const bus = await postToBus\(channel, body\);/, 'the digest must not go back to the party line alone');
});

test('a message saved on the fallback ticket counts as delivered; a double refusal does not', () => {
  const start = SRC.indexOf('async function postOrSaveToBus(');
  assert.ok(start > -1, 'postOrSaveToBus is gone — re-point this test');
  const body = SRC.slice(start, SRC.indexOf('\n}\n', start));
  assert.match(body, /if \(bus && bus\.ok\) return \{ ok: true, via: 'chat'/);
  assert.match(body, /await saveUndeliveredAlarm\(\{ text, channel, why \}\)/);
  assert.match(body, /if \(saved\.ok\) return \{ ok: true, via: 'ticket'/);
  assert.match(body, /return \{ ok: false,/);
});
