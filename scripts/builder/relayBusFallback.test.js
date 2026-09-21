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
  // Anchored on the STRUCTURE — the `saved.ok` branch answering `via: 'ticket'`
  // — rather than on one line's exact formatting. Task 86bc3t0n1 added an
  // `assignedToOperator` field to that return and the old single-line pattern
  // failed on the reflow alone, which is a test reporting a defect that is not
  // there.
  assert.match(body, /if \(saved\.ok\)[\s\S]{0,240}?via: 'ticket'/);
  assert.match(body, /if \(saved\.ok\)[\s\S]{0,240}?ok: true/);
  assert.match(body, /return \{ ok: false,/);
});

/**
 * The relay alarms whose ONLY copy is the party line (task 86bbztcza). Each of
 * these writes nothing durable anywhere else, so while chat refused posts
 * (from 2026-09-07) they reached nobody — and the stalled hand-off also left
 * its marker unstamped, so it retried, failed and exited 1 on every pass.
 * The courtesy copies (MERGED, Lane armed, refusal explained on the ticket)
 * deliberately stay on postToBus: their record is already on the ticket.
 */
test('the alarms that exist only on the party line fall back to the ticket', () => {
  assert.match(SRC, /const bus = await postOrSaveToBus\(channel, `\[CC-starcaster bus-relay\] Merge NOT performed on /,
    'an unclassified merge refusal writes nothing on the ticket — the bus is its only copy');
  assert.match(SRC, /const busStall = await postOrSaveToBus\(channel,/,
    'a stalled hand-off retries every pass until announced, so a chat-only post makes the relay exit 1 forever');
  assert.match(SRC, /\(filed \|\| selfHealing\)\s*\?\s*await postToBus\(channel, busBody\)\s*:\s*await postOrSaveToBus\(channel, busBody\)/,
    'an UNFILED conflict hand-off has no other actor and must fall back');
  assert.match(SRC, /AUTO-MERGE DISABLED ITSELF[\s\S]{0,900}?const posted = await postOrSaveToBus\(channel, line\);\s*\n\s*if \(!posted\.ok\) unchecked\.push\(/,
    'the first latch announcement must fall back AND report a double refusal');
  assert.doesNotMatch(SRC, /else await postToBus\(channel, line\);/, 'the latch announcement must not go back to an unchecked chat-only post');
});
