'use strict';

/**
 * THE NOTICEBOARD REGISTRY — that it is complete, and that it stays complete.
 *
 * Everything here is a pure function over ticket objects and over the source
 * files themselves. No network, no clock, no token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const noticeboards = require('../../lib/loopNoticeboards.js');
const throughput = require('../../lib/loopThroughput.js');
const busFallback = require('../../lib/busFallback.js');

const ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(ROOT, 'lib');
const BUILDER = __dirname;
const SCRIPTS = path.join(ROOT, 'scripts');

/**
 * The trees the require-based scan below can actually reach: plain CommonJS
 * modules with no side effects on load. `scripts/` at large is NOT one of them
 * — most of it is ESM entry points that run their whole program on import — so
 * a second test asserts the seed sentence never appears there.
 */
const REQUIRABLE_DIRS = [LIB, BUILDER];

/** Every hand-written source file under a directory, one level deep. */
function sourceFiles(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !f.endsWith('.test.js'))
    .map((f) => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------

test('all four standing tickets are registered', () => {
  assert.deepEqual(
    [...noticeboards.NOTICEBOARD_NAMES].sort(),
    ['Node roll call', 'Pipeline pause switch', 'Pipeline pulse', 'Undelivered alarms'],
  );
});

test('a noticeboard is recognised however ClickUp cases or pads the name', () => {
  assert.equal(noticeboards.isNoticeboard({ name: '  UNDELIVERED ALARMS  ' }), true);
  assert.equal(noticeboards.isNoticeboard({ name: 'Node roll call' }), true);
});

test('a real ticket is not a noticeboard, and neither is a nameless one', () => {
  assert.equal(noticeboards.isNoticeboard({ name: 'Builder: video background is wiped on save' }), false);
  assert.equal(noticeboards.isNoticeboard({}), false);
  assert.equal(noticeboards.isNoticeboard(null), false);
});

test('workTickets keeps the work and drops the noticeboards, and survives a non-array', () => {
  const kept = noticeboards.workTickets([
    { id: '1', name: 'Undelivered alarms' },
    { id: '2', name: 'A real ticket' },
    { id: '3', name: 'Pipeline pulse' },
  ]);
  assert.deepEqual(kept.map((t) => t.id), ['2']);
  assert.deepEqual(noticeboards.workTickets(null), []);
  assert.deepEqual(noticeboards.workTickets(undefined), []);
});

/**
 * THE ENFORCING ONE — a fifth noticeboard cannot be added and forgotten.
 *
 * Every standing ticket's seed description opens with the same sentence, so
 * the noticeboards can be found by their own words rather than by a list
 * somebody has to remember to update. Write a fifth in the same shape, leave
 * it out of the registry, and this fails.
 *
 * IT SCANS `scripts/builder/` AS WELL AS `lib/`, because round 1's version did
 * not and shipped stale on the day it was written (task 86bbwab1n, review
 * round 2). The pause switch — the fourth standing ticket, live in the queue
 * the whole time — is seeded from `scripts/pipeline.mjs`, so a `lib/`-only
 * scan found three of four and passed, while `docs/LOOP_ENGINEERING.md` told
 * the next reader they were covered.
 */
test('every module that seeds a standing ticket is in the registry', () => {
  const files = REQUIRABLE_DIRS.flatMap(sourceFiles)
    .filter((f) => fs.readFileSync(f, 'utf8').includes(noticeboards.SEED_PHRASE))
    // The registry itself quotes the phrase in order to search for it.
    .filter((f) => path.basename(f) !== 'loopNoticeboards.js');

  assert.ok(
    files.length >= 4,
    `the scan found ${files.length} standing-ticket modules; it should find at least the four known ones — `
    + 'if the seed wording changed, SEED_PHRASE has to change with it or this test stops checking anything',
  );

  for (const file of files) {
    const mod = require(file);
    const names = Object.entries(mod)
      .filter(([key, value]) => key.endsWith('TASK_NAME') && typeof value === 'string')
      .map(([, value]) => value);
    assert.ok(names.length, `${path.basename(file)} seeds a standing ticket but exports no *_TASK_NAME to register`);
    for (const name of names) {
      assert.ok(
        noticeboards.NOTICEBOARD_NAMES.includes(name),
        `${path.basename(file)} keeps a standing ticket called "${name}" and it is NOT in `
        + 'loopNoticeboards.NOTICEBOARD_NAMES — the throughput report will count its creation as a '
        + 'ticket that shipped',
      );
    }
  }
});

/**
 * AND THE SEED SENTENCE MAY NOT BE WRITTEN WHERE THAT SCAN CANNOT REACH.
 *
 * The scan above works by requiring a module and reading its `*_TASK_NAME`
 * exports. An ESM script under `scripts/` runs its whole program on import, so
 * it can never be scanned that way — which is precisely how the pause switch
 * stayed invisible. Widening the scan alone would fix that one ticket and
 * leave the hole; this closes the hole, by making "seed text lives beside the
 * name it seeds" a rule with a failing test behind it rather than a habit.
 */
test('the seed sentence appears only in modules the registry scan can require', () => {
  const stray = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
      if (entry.name.endsWith('.test.js')) continue;
      if (REQUIRABLE_DIRS.includes(dir)) continue;
      if (fs.readFileSync(full, 'utf8').includes(noticeboards.SEED_PHRASE)) {
        stray.push(path.relative(ROOT, full));
      }
    }
  };
  walk(SCRIPTS);

  assert.deepEqual(
    stray, [],
    `these files seed a standing ticket where the registry scan cannot see them: ${stray.join(', ')}. `
    + 'Move the seed text into the CommonJS module that exports its *_TASK_NAME (as '
    + 'scripts/builder/pipelinePause.js does with SWITCH_SEED_DESCRIPTION) and import it here, or the '
    + 'registry can go stale again with every test still green.',
  );
});

// ---------------------------------------------------------------------------
// The blocker: a noticeboard must not read as a ticket that shipped.
// ---------------------------------------------------------------------------

/** ClickUp hands these back as strings of milliseconds. */
const NOW = Date.parse('2026-09-08T18:00:00.000Z');
const TODAY = Date.parse('2026-09-08T12:19:52.000Z');

/** The real shape: created and closed in the same instant, in a closed status. */
const NOTICEBOARD = {
  id: '86bbwf1nr',
  name: busFallback.FALLBACK_TASK_NAME,
  status: { status: 'live' },
  date_created: String(TODAY),
  date_closed: String(TODAY),
  date_updated: String(TODAY),
};

const UTC = { key: (ms) => new Date(ms).toISOString().slice(0, 10), end: (k) => Date.parse(`${k}T00:00:00.000Z`) + 86400000 };

test('saving an alarm does not read as a ticket closed today', () => {
  const rows = throughput.closedPerDay({ tasks: [NOTICEBOARD], now: NOW, days: 2, calendar: UTC });
  assert.deepEqual(rows.map((r) => r.count), [0, 0], 'the noticeboard is not a closure');
});

test('the stall test does not count a noticeboard — the alarm cannot silence the alarm', () => {
  assert.equal(throughput.closedSince({ tasks: [NOTICEBOARD], now: NOW }), 0);

  // The consequence, stated as the verdict it produces. Open work sitting,
  // nothing shipped: that is a stall, and one saved alarm used to flip it.
  const queue = throughput.queueShape([NOTICEBOARD, { name: 'real work', status: { status: 'queued' } }]);
  const v = throughput.verdict({
    closedLast24h: throughput.closedSince({ tasks: [NOTICEBOARD], now: NOW }),
    queue,
    queueTouched: true,
  });
  assert.equal(v.state, 'STALLED');
});

test('a noticeboard is not counted in the queue shape at all', () => {
  const shape = throughput.queueShape([NOTICEBOARD, { name: 'real work', status: { status: 'queued' } }]);
  assert.equal(shape.total, 1);
  assert.equal(shape.closed, 0);
  assert.equal(shape.queued, 1);
});

test('a noticeboard is not the last thing that closed', () => {
  assert.equal(throughput.sinceLastClose({ tasks: [NOTICEBOARD], now: NOW }), null);
});

test('a noticeboard is not on the backlog curve', () => {
  const curve = throughput.depthPerDay({ tasks: [NOTICEBOARD], now: NOW, days: 2, calendar: UTC });
  assert.deepEqual(curve.map((r) => r.open), [0, 0]);
});

test('a noticeboard with no closure date is not a ticket the curve had to guess about', () => {
  const undated = { ...NOTICEBOARD, date_closed: null };
  assert.equal(throughput.undatedClosures([undated]), 0);
  assert.equal(throughput.recentUndatedClosures({ tasks: [undated], now: NOW }), 0);
  assert.deepEqual(throughput.recentUndatedClosureTasks({ tasks: [undated], now: NOW }), []);
});

/**
 * The script's own choke point. `queueTouched` and `ticketStatusById` are
 * derived in `scripts/loop_throughput.mjs` from the array directly, never
 * through the lib, so the filter has to be applied there too — an alarm
 * comment bumps `date_updated`, and without it the watchdog could answer "yes,
 * the queue was touched" on the strength of writing to itself.
 */
test('the throughput script filters the noticeboards before its own derivations', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'loop_throughput.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.match(src, /const tasks = throughput\.workTickets\(queueRead\.tasks\)/);
});

/**
 * THE OTHER READER, WHICH ROUND 1 DID NOT TOUCH (review round 2).
 *
 * `stage-counts` counts the whole Loop Queue by status and counts closures in
 * a date window, and `scripts/weekly_report.mjs` feeds off all three of its
 * numbers. It filtered on `date_closed` alone — so the weekly report would
 * have credited "Undelivered alarms", a ticket created inside its own window
 * by the very change that fixed this everywhere else, as a ticket that
 * shipped, and inflated `total` by one per standing ticket.
 */
test('the stage-counts command counts work, not noticeboards', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const cmd = src.slice(src.indexOf("cmd === 'stage-counts'"), src.indexOf("cmd === 'get'"));
  assert.ok(cmd.length, 'the stage-counts command must still exist to be checked');
  assert.match(
    cmd,
    /const tasks = loopNoticeboards\.workTickets\(/,
    'stage-counts must apply the registry before it derives total, byStatus or closedInWindow — the weekly report reads all three',
  );
  assert.ok(
    !/const \{ tasks \} = await fetchAllTasks/.test(cmd),
    'the raw array must not be bound to `tasks`, or a later edit derives from the unfiltered list without noticing',
  );
});
