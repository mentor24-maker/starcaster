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

// ---------------------------------------------------------------------------
// Review round 1, 2026-09-08 — five defects, each with the mistake it made.
// ---------------------------------------------------------------------------

/** The `chat` command's body, comments already stripped by `codeOnly`. */
function chatCommand() {
  return src.slice(src.indexOf("} else if (cmd === 'chat') {"), src.indexOf("} else if (cmd === 'pass-reconcile')"));
}

/** A named function's body, comments already stripped. */
function bodyOf(name) {
  const at = src.indexOf(name);
  return src.slice(at, src.indexOf('\n}\n', at));
}

test('reaching the ClickUp reserve stops with its own exit code — it is not a refusal to fall back from', () => {
  const cmd = chatCommand();
  const yieldAt = cmd.search(/stoppedAtReserve\(out\)/);
  const fallbackAt = cmd.indexOf('await saveUndeliveredAlarm(');
  assert.ok(
    yieldAt !== -1,
    'a yielded result travels with res.ok === false, so without this check it lands in the fallback — whose own calls yield too, printing "this alarm is lost" and exiting 1 for a deliberate, healthy stop',
  );
  assert.ok(yieldAt < fallbackAt, 'the yield has to be told apart BEFORE the fallback, or it is already too late');
  assert.ok(
    cmd.slice(yieldAt, fallbackAt).includes("die('send chat message'"),
    'die() is what carries the reserve\'s words and EXIT_YIELDED (7) — run_bus_relay.sh reads that code to tell "I stood down" from "I broke"',
  );
});

/**
 * ROUND 2's FINDING: the guard above covers the PRIMARY chat POST only.
 *
 * `saveUndeliveredAlarm` then makes two to four calls of its own, and each one
 * yields the moment the reserve is reached. Those came back as an ordinary
 * `{ ok: false }`, so the chat command printed "Nothing was delivered. This
 * alarm is lost unless the caller retries" and exited 1 — a healthy stand-down
 * reported as a failure, with `run_bus_relay.sh` reading 1 where 7 was true.
 * The window is narrow (the reserve has to be crossed between the chat POST
 * and the fallback's own calls) and it is the same wrong diagnosis.
 */
test('a reserve stop INSIDE the fallback is a stand-down too, not a lost alarm', () => {
  const fn = bodyOf('async function saveUndeliveredAlarm');

  // Every call the fallback makes has to be asked, or the one that is not is
  // the one that reports a yield as a lost alarm.
  const guards = fn.match(/stoppedAtReserve\(/g) || [];
  const calls = fn.match(/await (call\(|fetchAllTasks\()/g) || [];
  assert.ok(
    guards.length >= calls.length,
    `the fallback makes ${calls.length} ClickUp calls but guards only ${guards.length} of them against `
    + 'the reserve — an unguarded one returns ok:false and is reported as "this alarm is lost"',
  );

  assert.ok(
    /stopped: out/.test(fn),
    'a yield has to be reported DISTINCTLY from a refusal; { ok: false } alone is what the caller mistook',
  );
});

test('the chat command dies on a fallback reserve stop before it calls the alarm lost', () => {
  const cmd = chatCommand();
  const stoppedAt = cmd.indexOf('if (saved.stopped)');
  const lostAt = cmd.indexOf('if (!saved.ok)');
  assert.ok(stoppedAt !== -1, 'the fallback\'s yield verdict must be read');
  assert.ok(
    stoppedAt < lostAt,
    'the stand-down must be told apart BEFORE the "nothing was delivered" branch, or exit 7 is lost to exit 1',
  );
  assert.ok(
    cmd.slice(stoppedAt, lostAt).includes('die('),
    'die() is what carries the reserve\'s own words and EXIT_YIELDED (7)',
  );
});

test('a non-fatal list read carries its yield out rather than flattening it to an HTTP status', () => {
  const fn = src.slice(src.indexOf('async function fetchAllTasks'), src.indexOf('\nfunction assigneeNames'));
  assert.ok(
    /yielded: out\.yielded/.test(fn),
    'without this the non-fatal return keeps only res.status, and die() cannot print the reserve\'s own reason',
  );
});

test('the fallback never throws on a 200 whose body did not parse', () => {
  const fn = bodyOf('async function saveUndeliveredAlarm');
  assert.ok(
    /if \(!made\.json \|\| !made\.json\.id\)/.test(fn),
    'made.json is null on a 200 carrying a proxy error page, and made.json.id on that is a TypeError escaping a function documented "Never throws"',
  );
  assert.ok(
    /back\.json && Array\.isArray\(back\.json\.comments\)/.test(fn),
    '(back.json.comments || []) throws the same way when the read-back body did not parse',
  );
  assert.ok(!/\(back\.json\.comments \|\| \[\]\)/.test(fn), 'the unguarded read-back must be gone, not merely commented about');
});

test('two machines creating two noticeboards converge on one, oldest first', () => {
  const fn = bodyOf('async function saveUndeliveredAlarm');
  assert.ok(
    /date_created/.test(fn),
    'find-or-create is check-then-act, so both machines can create one; choosing the oldest is an answer each reaches independently, which first-paged is not',
  );
  assert.ok(
    fn.includes('Two "') || /Two \$\{/.test(fn) || /Two .*tickets exist/.test(fn),
    'a split record has to be said out loud — it needs a hand to delete the duplicate',
  );
});

test('the deliberate blank lines survive, so the alarm keeps its horizontal rule', () => {
  const body = busFallback.renderFallbackComment({
    text: 'ALARM', channel: 'c', why: 'HTTP 400', node: 'mac-mini', at: '2026-09-08T12:00:00.000Z',
  });
  assert.ok(
    body.includes('The alarm itself, unchanged:\n\n---\n\n'),
    'without the blank line Markdown reads `---` as a setext underline: the rule disappears and the line above it becomes a heading',
  );
  assert.ok(body.includes('**\n\n*   raised by:'), 'the header keeps its blank line too');
});

test('an absent `at` or `channel` still drops out, which is what the filter was for', () => {
  const body = busFallback.renderFallbackComment({ text: 'ALARM', why: 'HTTP 400' });
  assert.ok(!body.includes('*   at:'), 'no timestamp, no line');
  assert.ok(!body.includes('*   channel:'), 'no channel, no line');
  assert.ok(body.includes('The alarm itself, unchanged:\n\n---\n\n'), 'and the separators still survive');
  assert.ok(!/\n\n\n/.test(body), 'dropping an optional field must not leave a double gap behind it');
});
