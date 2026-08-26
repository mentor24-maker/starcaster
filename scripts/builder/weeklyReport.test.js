'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('./weeklyReport');

/**
 * Task 86bbkw1mn. Two things can go wrong with a generated report, and only one
 * of them is loud.
 *
 * The loud one is a crash, and nobody ships that. The quiet one is a report that
 * looks complete and is not: a metric silently dropped because its source
 * failed, or an open pull request counted as shipped. Both read as good news.
 * The first edition did the second — it credited PR #373 as shipped while it was
 * still open — so that case gets a fixture with an open PR in it, not a comment.
 *
 * Everything here is pure. No network, no clock, no fixture server (CLAUDE.md
 * landmine 14 aside, a test that needs `gh` is a test that fails on a train).
 */

// ── Only merged work counts ────────────────────────────────────────────────

test('mergedOnly keeps merged pull requests and drops an open one', () => {
  const fixture = [
    { number: 371, title: 'Something that shipped', state: 'MERGED' },
    { number: 373, title: 'Something still in flight', state: 'OPEN' },
    { number: 374, title: 'Something else that shipped', state: 'MERGED' },
  ];
  const kept = R.mergedOnly(fixture);
  assert.deepEqual(kept.map((p) => p.number), [371, 374]);
  assert.ok(!kept.some((p) => p.number === 373), 'PR #373 was open — the exact mistake the first edition made');
});

test('mergedOnly drops anything whose state it cannot read, rather than assuming shipped', () => {
  const fixture = [
    { number: 1, state: 'MERGED' },
    { number: 2, state: 'CLOSED' },
    { number: 3 },
    { number: 4, state: null },
    { number: 5, state: 'merged' }, // casing is not a reason to lose a merge
  ];
  assert.deepEqual(R.mergedOnly(fixture).map((p) => p.number), [1, 5]);
});

test('mergedOnly survives junk input', () => {
  assert.deepEqual(R.mergedOnly(null), []);
  assert.deepEqual(R.mergedOnly(undefined), []);
  assert.deepEqual(R.mergedOnly([null, undefined]), []);
});

// ── Reading a squash-merge subject ─────────────────────────────────────────

test('parseMergeSubject reads the number GitHub appends', () => {
  assert.deepEqual(R.parseMergeSubject('The relay wakes every 10 minutes, not every hour (#426)'),
    { number: 426, title: 'The relay wakes every 10 minutes, not every hour' });
});

test('parseMergeSubject returns null for a direct commit, which is not a pull request', () => {
  assert.equal(R.parseMergeSubject('Fix a typo'), null);
  assert.equal(R.parseMergeSubject(''), null);
  assert.equal(R.parseMergeSubject(null), null);
  assert.equal(R.parseMergeSubject('(#426)'), null, 'a number with no subject is not a merge either');
});

test('parseMergeSubject only reads a number at the END, where GitHub puts it', () => {
  assert.equal(R.parseMergeSubject('Revert (#12) because it broke the build'), null);
});

// ── Which area a merge belongs to ──────────────────────────────────────────

test('areaForPath puts the narrow rules ahead of the broad ones', () => {
  // lib/builder-client before lib/, src/css before src/ — get this backwards and
  // every styling change files under "the admin app".
  assert.equal(R.areaForPath('lib/builder-client/builder-template.ts'), 'The Builder');
  assert.equal(R.areaForPath('lib/projectScope.js'), 'Server and data');
  assert.equal(R.areaForPath('src/css/_builder-react.css'), 'Styling');
  assert.equal(R.areaForPath('src/pages/contacts.html'), 'The admin app');
  assert.equal(R.areaForPath('components/SettingsPanel.tsx'), 'The Builder');
  assert.equal(R.areaForPath('scripts/builder/wipCap.js'), 'The pipeline');
  assert.equal(R.areaForPath('docs/DOCTRINE.md'), 'Documentation');
  assert.equal(R.areaForPath('README.md'), 'Elsewhere');
});

test('areaForMerge follows the majority of changed files', () => {
  assert.equal(R.areaForMerge([
    'components/A.tsx', 'components/B.tsx', 'scripts/x.js',
  ]), 'The Builder');
  assert.equal(R.areaForMerge([
    'scripts/a.js', 'scripts/b.js', 'components/C.tsx',
  ]), 'The pipeline');
});

test('areaForMerge breaks a tie by rule order, so the answer is stable', () => {
  // One component, one script. Both plausible; the answer must not depend on
  // which path git happened to print first.
  const a = R.areaForMerge(['components/A.tsx', 'scripts/x.js']);
  const b = R.areaForMerge(['scripts/x.js', 'components/A.tsx']);
  assert.equal(a, b);
  assert.equal(a, 'The Builder');
});

test('areaForMerge shrugs honestly when it has no paths', () => {
  assert.equal(R.areaForMerge([]), 'Elsewhere');
  assert.equal(R.areaForMerge(null), 'Elsewhere');
});

test('groupMergesByArea returns areas in pipeline order and drops the empty ones', () => {
  const merges = [
    { number: 3, title: 'c', area: 'Documentation' },
    { number: 1, title: 'a', area: 'The Builder' },
    { number: 2, title: 'b', area: 'The Builder' },
  ];
  const groups = R.groupMergesByArea(merges);
  assert.deepEqual(groups.map((g) => g.area), ['The Builder', 'Documentation']);
  assert.deepEqual(groups[0].entries.map((e) => e.number), [1, 2], 'order within a group is preserved');
  assert.ok(!groups.some((g) => g.entries.length === 0), 'an area nothing touched is not printed');
});

// ── The honesty rule ───────────────────────────────────────────────────────

test('a figure carries its reason, and figureText prints it', () => {
  const bad = R.notAvailable('gh exited 1: could not resolve host');
  assert.equal(bad.ok, false);
  assert.equal(bad.value, null);
  assert.equal(R.figureText(bad), 'not available — gh exited 1: could not resolve host');
});

test('figureText refuses to invent a value even when the figure is missing entirely', () => {
  assert.match(R.figureText(undefined), /^not available/);
  assert.match(R.figureText(null), /^not available/);
  assert.match(R.figureText(42), /^not available/, 'a bare number is not a figure — it has no readable/unreadable state');
});

test('an unreadable figure reaches the page as a reason, not as a gap', () => {
  const html = R.renderReportHtml({
    repo: 'mentor24-maker/starcaster',
    window: { from: '2026-08-18', to: '2026-08-24', days: 7 },
    figures: {
      merges: R.ok(3, { perDay: R.perDay(['2026-08-20'], '2026-08-18', '2026-08-24') }),
      diffstat: R.notAvailable('git exited 128: bad revision'),
      tests: R.ok({ pass: 900, fail: 0 }),
      ciMedianSeconds: R.notAvailable('no successful CI runs finished inside the window'),
      openPrs: R.ok(9),
      stages: R.notAvailable('ClickUp returned 429'),
      loopPasses: R.ok({ total: 120, byLoop: {} }),
    },
    groups: [],
  });
  assert.match(html, /not available — git exited 128: bad revision/);
  assert.match(html, /not available — no successful CI runs finished inside the window/);
  assert.match(html, /not available — ClickUp returned 429/);
  // And it is visibly marked, not just worded — an unread figure that looks
  // like a read one is the failure this whole rule exists to prevent.
  assert.match(html, /tile--unread/);
});

test('a stage block that could not be read never prints confident zeroes', () => {
  const html = R.renderStages(R.notAvailable('ClickUp returned 429'));
  assert.match(html, /not available — ClickUp returned 429/);
  assert.ok(!/stage-count/.test(html), 'no counts at all, rather than six zeroes that look like a quiet week');
});

// ── The chart ──────────────────────────────────────────────────────────────

test('perDay includes days with no merges, so a quiet week looks quiet', () => {
  const days = R.perDay(['2026-08-20', '2026-08-20', '2026-08-22'], '2026-08-18', '2026-08-24');
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.count), [0, 0, 2, 0, 1, 0, 0]);
});

test('perDay ignores a date outside the window rather than folding it into an edge', () => {
  const days = R.perDay(['2026-08-01', '2026-08-31'], '2026-08-18', '2026-08-24');
  assert.equal(days.reduce((s, d) => s + d.count, 0), 0);
});

test('the chart says so when it has nothing to draw', () => {
  assert.match(R.renderChart([]), /not available/);
});

// ── Small numbers ──────────────────────────────────────────────────────────

test('median of an empty set is null, never zero', () => {
  assert.equal(R.median([]), null, 'zero would read as "CI is instant"');
  assert.equal(R.median(null), null);
  assert.equal(R.median([4, 1, 3]), 3);
  assert.equal(R.median([4, 1, 3, 2]), 2.5);
  assert.equal(R.median(['nonsense', 5]), 5, 'unparseable entries are dropped, not counted as 0');
});

test('formatDuration reads like a duration', () => {
  assert.equal(R.formatDuration(43), '43s');
  assert.equal(R.formatDuration(432), '7m 12s');
  assert.equal(R.formatDuration(3840), '1h 04m');
  assert.match(R.formatDuration('nonsense'), /^not available/);
});

test('windowRange counts inclusively — 7 days means 7 days', () => {
  const w = R.windowRange('2026-08-24', 7);
  assert.deepEqual(w, { from: '2026-08-18', to: '2026-08-24', days: 7 });
  assert.equal(R.daysBetween(w.from, w.to).length, 7);
});

// ── Determinism ────────────────────────────────────────────────────────────

test('the same data renders the same page twice (the second run is a different program)', () => {
  const data = {
    repo: 'mentor24-maker/starcaster',
    window: { from: '2026-08-18', to: '2026-08-24', days: 7 },
    figures: {
      merges: R.ok(2, { perDay: R.perDay(['2026-08-19', '2026-08-21'], '2026-08-18', '2026-08-24') }),
      diffstat: R.ok({ filesChanged: 12, insertions: 300, deletions: 40 }),
      tests: R.ok({ pass: 900, fail: 0 }),
      ciMedianSeconds: R.ok(240),
      openPrs: R.ok(9),
      stages: R.ok({ queued: 34, live: 101 }),
      loopPasses: R.ok({ total: 120, byLoop: { '/loop-build': 70 } }),
    },
    groups: [{ area: 'The Builder', entries: [{ number: 1, title: 'a' }, { number: 2, title: 'b' }] }],
  };
  assert.equal(R.renderReportHtml(data), R.renderReportHtml(data));
  // And nothing in the page comes from a clock: no ISO timestamp beyond the
  // window it was asked for.
  const html = R.renderReportHtml(data);
  const stamps = html.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) || [];
  assert.deepEqual(stamps, [], 'a wall-clock stamp would make every rerun a diff');
});

// ── Links and escaping ─────────────────────────────────────────────────────

test('every pull request reference is a link to the real repo', () => {
  assert.equal(R.prUrl('mentor24-maker/starcaster', 426), 'https://github.com/mentor24-maker/starcaster/pull/426');
  const html = R.renderReportHtml({
    repo: 'mentor24-maker/starcaster',
    window: { from: '2026-08-18', to: '2026-08-24', days: 7 },
    figures: { merges: R.ok(1, { perDay: [] }) },
    groups: [{ area: 'The Builder', entries: [{ number: 426, title: 'The relay wakes every 10 minutes' }] }],
  });
  assert.match(html, /href="https:\/\/github\.com\/mentor24-maker\/starcaster\/pull\/426"/);
});

test('a merge title carrying HTML cannot break the page', () => {
  const html = R.renderReportHtml({
    repo: 'mentor24-maker/starcaster',
    window: { from: '2026-08-18', to: '2026-08-24', days: 7 },
    figures: { merges: R.ok(1, { perDay: [] }) },
    groups: [{ area: 'The Builder', entries: [{ number: 1, title: '<script>alert(1)</script> & "quoted"' }] }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

// ── The index ──────────────────────────────────────────────────────────────

test('the index lists editions newest first', () => {
  const html = R.renderIndexHtml([
    { date: '2026-08-17', file: '2026-08-17.html', window: 'a' },
    { date: '2026-08-31', file: '2026-08-31.html', window: 'b' },
    { date: '2026-08-24', file: '2026-08-24.html', window: 'c' },
  ]);
  const order = [...html.matchAll(/>(\d{4}-\d{2}-\d{2})</g)].map((m) => m[1]);
  assert.deepEqual(order, ['2026-08-31', '2026-08-24', '2026-08-17']);
});

test('an empty index says so rather than rendering a bare list', () => {
  assert.match(R.renderIndexHtml([]), /No editions yet/);
});

// ── The arrangement around it ──────────────────────────────────────────────

test('the reports folder is NOT gitignored — these are records, not build artifacts', () => {
  const root = path.resolve(__dirname, '..', '..');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const offending = ignore.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && /docs\/reports/.test(l));
  assert.deepEqual(offending, [], 'a report that vanishes on the next build is not a record');
});

test('the weekly-report job is registered to exactly one machine', () => {
  const { ROLES, roleOwner, checkRole, KNOWN_NODES } = require(path.resolve(__dirname, '..', '..', 'lib', 'nodeRoles.js'));
  assert.ok(ROLES['weekly-report'], 'the job has to be in the registry or node:owns cannot answer');
  assert.equal(roleOwner('weekly-report'), 'mac-mini');
  assert.ok(ROLES['weekly-report'].why.length > 40, 'the registry entry says WHY only one machine may run it');
  // On the machine that does not own it, the verdict is a clean decline — not
  // an error, and not silence.
  const other = KNOWN_NODES.find((n) => n !== 'mac-mini');
  const v = checkRole('weekly-report', { node: { name: other, source: 'file', file: '/tmp/.alphire-node' } });
  assert.equal(v.verdict, 'other-node');
  assert.equal(v.owned, false);
});

test('the gatherer never commits to main', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  // A `git push origin main` here would be a scheduled deploy to production at
  // 07:00 on a Monday with nobody awake (CLAUDE.md landmine 4).
  assert.ok(!/push[^\n]*['"]main['"]/.test(src), 'nothing may push main');
  // Specifically a force PUSH. `git worktree remove --force` is a different
  // thing entirely — it discards a scratch folder, not shared history — and an
  // assertion that cannot tell them apart would either fail honest code or get
  // loosened until it stops meaning anything.
  const pushLines = src.split('\n').filter((l) => /'push'/.test(l));
  assert.ok(pushLines.length > 0, 'it does push something, or this assertion proves nothing');
  for (const line of pushLines) {
    assert.ok(!/--force/.test(line), `a force-push slipped in (DOCTRINE 6.6): ${line.trim()}`);
  }
});

test('publishing happens in a throwaway worktree, never by switching the checkout branch', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  // The obvious version — `git checkout -B <branch> origin/main` in place —
  // works once and then leaves the MAIN checkout parked on a weekly-report
  // branch forever. The next bus-relay pass sees it is not on main, skips its
  // self-update, and the Mini silently runs frozen code from then on.
  assert.ok(!/'checkout', '-B'/.test(src), 'it must not switch the checkout off its own branch');
  assert.match(src, /'worktree', 'add'/, 'it publishes from its own temporary worktree');
  assert.match(src, /'worktree', 'remove'/, 'and cleans that worktree up');
  // Cleanup has to be unconditional, or next Monday fails with "already exists".
  assert.match(src, /\} finally \{/, 'the cleanup runs even when publishing fails');
});

test('an edition identical to last week does not open an empty pull request', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  assert.match(src, /diff', '--cached', '--name-only'/, 'it checks whether anything actually changed');
  assert.match(src, /no changes/, 'and stops rather than filing a weekly no-op PR');
});
