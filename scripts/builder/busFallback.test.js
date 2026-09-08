'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const busFallback = require('../../lib/busFallback.js');

const DIRECT = path.join(__dirname, '..', 'clickup_direct.mjs');

/**
 * The file with its COMMENTS REMOVED.
 *
 * Every assertion below scans this rather than the raw source, and the reason
 * is a break test that did not fail: `classifyFieldRefusal` is named in the
 * comment block explaining why it is called, so an assertion looking for the
 * bare name passed on a version with the call deleted. A check that cannot
 * fail is worse than no check — it reports a guard that is not there.
 */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const src = codeOnly(fs.readFileSync(DIRECT, 'utf8'));

// ---------------------------------------------------------------------------
// The comment a dropped alarm arrives as.
// ---------------------------------------------------------------------------

test('the alarm text is reproduced verbatim, not summarised', () => {
  const alarm = '🚨 **bus-relay has stopped beating**\n\n*   last beat 3.4h ago\n*   threshold 3h';
  const body = busFallback.renderFallbackComment({
    text: alarm, channel: '2kydhxeu-474', why: 'HTTP 400 Invalid Request', node: 'mac-mini', at: '2026-09-08T12:00:00.000Z',
  });
  assert.ok(body.includes(alarm), 'the alarm itself must survive the wrapper intact');
});

test('the comment says which machine raised it, and why the bus refused it', () => {
  const body = busFallback.renderFallbackComment({
    text: 'something is wrong', channel: '2kydhxeu-474', why: 'HTTP 400 Invalid Request', node: 'mac-mini', at: '2026-09-08T12:00:00.000Z',
  });
  assert.match(body, /mac-mini/);
  assert.match(body, /HTTP 400 Invalid Request/);
  assert.match(body, /2026-09-08T12:00:00\.000Z/);
});

test('a missing node name reads as unnamed rather than as an empty gap', () => {
  const body = busFallback.renderFallbackComment({ text: 'x', why: 'HTTP 500' });
  assert.match(body, /an unnamed machine/);
  assert.ok(!/raised by: \*\*\*\*/.test(body), 'an empty bold is a blank the reader cannot interpret');
});

test('the reason is bounded, so a giant error body cannot bury the alarm', () => {
  const body = busFallback.renderFallbackComment({ text: 'the alarm', why: 'x'.repeat(5000) });
  assert.ok(body.length < 1200, `the wrapper grew to ${body.length} characters`);
  assert.ok(body.includes('the alarm'));
});

// ---------------------------------------------------------------------------
// The line the calling job's log gets. Its whole job is to stop "delivered
// somewhere else" reading like "delivered as normal".
// ---------------------------------------------------------------------------

test('a fallback delivery never reads like an ordinary bus post', () => {
  const normal = busFallback.renderRouteLine({ via: 'chat', channel: '2kydhxeu-474' });
  const fell = busFallback.renderRouteLine({ via: 'ticket', channel: '2kydhxeu-474', why: 'HTTP 400', url: 'https://app.clickup.com/t/abc' });
  assert.match(normal, /Posted to channel/);
  assert.match(fell, /REFUSED/);
  assert.match(fell, /NOT lost/);
  assert.ok(!/^Posted to channel/.test(fell));
  assert.match(fell, /https:\/\/app\.clickup\.com\/t\/abc/);
});

test('the standing ticket tells a reader not to build or close it', () => {
  const seed = busFallback.renderFallbackSeed();
  assert.match(seed, /Do not build this, do not close it, do not delete it/);
  assert.match(seed, new RegExp(busFallback.FALLBACK_TASK_NAME));
});

// ---------------------------------------------------------------------------
// The two loop-note refusals. This is the whole of part 2: they used to print
// the same thing and they mean opposite things.
// ---------------------------------------------------------------------------

test('"custom field usages exceeded" is classified as the plan being out, not as a missing field', () => {
  const r = busFallback.classifyFieldRefusal({ status: 400, body: 'Custom field usages exceeded for your plan' });
  assert.equal(r.kind, 'plan-exhausted');
  const said = r.lines.join('\n');
  assert.match(said, /NOT "the field is not set up yet"/);
  assert.match(said, /invisible/i);
  // The 2026-08-23 incident is the reason this sentence exists: the same pair
  // of symptoms was diagnosed as the plan and the proposed fix was to pay for
  // an upgrade, on a plan that had not changed and a window that closed by
  // itself. A message that sends the next reader down that road again would
  // cost real money to answer a ClickUp-side outage.
  assert.match(said, /DO NOT ASK ANYONE TO PAY FOR THIS/);
  assert.match(said, /2026-08-23/);
});

test('the wording is matched case-insensitively — ClickUp owns that string, not us', () => {
  const r = busFallback.classifyFieldRefusal({ status: 400, body: 'CUSTOM FIELD USAGES EXCEEDED for your plan' });
  assert.equal(r.kind, 'plan-exhausted');
});

test('any other refusal is left alone, so the ordinary failure path still runs', () => {
  for (const body of ['Team not authorized', 'Field not found', '', 'rate limit exceeded']) {
    assert.equal(busFallback.classifyFieldRefusal({ status: 401, body }).kind, 'other', `misread ${JSON.stringify(body)}`);
  }
});

// ---------------------------------------------------------------------------
// The wiring. These assert on the source because the alternative is a live
// ClickUp call, and the properties below are exactly the ones whose absence
// costs an alarm.
// ---------------------------------------------------------------------------

test('the chat command falls back before it dies', () => {
  const cmd = src.slice(src.indexOf("} else if (cmd === 'chat') {"), src.indexOf("} else if (cmd === 'pass-reconcile')"));
  const fallbackAt = cmd.indexOf('await saveUndeliveredAlarm(');
  assert.ok(fallbackAt !== -1, 'the chat command must reach the fallback');
  const dieAt = cmd.indexOf("die('send chat message'");
  assert.ok(dieAt !== -1 && fallbackAt !== -1);
  assert.ok(cmd.slice(dieAt).includes('no-fallback') || cmd.indexOf("flag('no-fallback')") < dieAt,
    'the only unguarded die must be the one --no-fallback asked for');
});

test('a fallback that did not stick exits non-zero, so the caller retries instead of stamping', () => {
  const cmd = src.slice(src.indexOf("} else if (cmd === 'chat') {"), src.indexOf("} else if (cmd === 'pass-reconcile')"));
  const at = cmd.indexOf('if (!saved.ok)');
  assert.ok(at !== -1, 'the fallback verdict must be checked');
  assert.ok(cmd.slice(at, at + 600).includes('process.exit(1)'),
    'both surfaces refusing must be a non-zero exit — a caller that stamps its suppression window here silences the alarm for six hours on a message nobody received');
});

test('the fallback verifies its comment by reading it back before calling it delivered', () => {
  const fn = src.slice(src.indexOf('async function saveUndeliveredAlarm'), src.indexOf('\n}\n', src.indexOf('async function saveUndeliveredAlarm')));
  assert.ok(/call\('GET'[^)]*comment/s.test(fn), 'a 200 is not proof the comment stuck');
  assert.ok(fn.includes('could not be read back'));
});

test('the standing ticket is found by NAME, with the env var only a shortcut', () => {
  const fn = src.slice(src.indexOf('async function saveUndeliveredAlarm'), src.indexOf('\n}\n', src.indexOf('async function saveUndeliveredAlarm')));
  const shortcutAt = fn.indexOf('CLICKUP_ALARM_TASK');
  const nameAt = fn.indexOf('busFallback.FALLBACK_TASK_NAME');
  assert.ok(nameAt !== -1, 'the name is the identity');
  assert.ok(shortcutAt !== -1, 'the shortcut exists');
  assert.ok(shortcutAt < nameAt, 'the shortcut is tried first and must fall through to the name');
});

test('the loop-note stamp routes the plan-exhausted refusal away from the generic die', () => {
  const fn = src.slice(src.indexOf("async function stampLoopNote("), src.indexOf('\n}\n', src.indexOf("async function stampLoopNote(")));
  const classifyAt = fn.indexOf('busFallback.classifyFieldRefusal(');
  const dieAt = fn.indexOf("die('set loop-note field'");
  assert.ok(classifyAt !== -1, 'the two causes must actually be told apart, not merely described in a comment');
  assert.ok(dieAt !== -1, 'the generic failure path must still exist for every other refusal');
  assert.ok(classifyAt < dieAt, 'the classification has to happen before the generic failure path');
  assert.ok(fn.includes("refusal.kind === 'plan-exhausted'"), 'the classification has to change what happens');
});

test('the auto-merge lane\'s soft stamp reports WHICH refusal it hit, not just that one happened', () => {
  const at = src.indexOf('async function stampLoopNoteSoftly');
  const fn = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(fn.includes('busFallback.classifyFieldRefusal('),
    'this stamp pushes its failure into `unchecked`, which a human reads — "the write failed" is the same sentence for a field nobody created and a field the plan has run out of usages for');
  assert.match(fn, /out of custom-field usages/,
    'the plan-exhausted case must say so in the words the reader gets');
});
