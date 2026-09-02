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

test('the stage line-up renders Rework, so its tickets cannot vanish from the picture', () => {
  // Task 86bbr1u9v. This is exactly the surface where a missing status is
  // INVISIBLE rather than zero: a stage absent from STAGE_ORDER is not
  // rendered at all, so the report would have kept describing a healthy
  // pipeline while the rework column filled up.
  const html = R.renderStages(R.ok({ rework: 4, queued: 12, building: 1, 'in review': 2, live: 30 }));
  assert.match(html, /Rework/, 'the stage must be drawn');
  assert.match(html, /<div class="stage-count">4<\/div>/, 'with its real count, read case-insensitively');
  // And it comes first, because that is the order the pipeline moves in now.
  assert.ok(html.indexOf('Rework') < html.indexOf('Queued'), 'Rework precedes Queued on the board');
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

// ── The three defects the review pass found ────────────────────────────────
//
// All three broke the same rule, from three different places: a figure the
// script could not fully read was printed as though it were complete.

test('the data file can never be written over the page it belongs to', () => {
  // `--out notes.txt` used to give the HTML and the JSON the same path. The
  // JSON is written first, so the page silently destroyed the machine-readable
  // copy every figure on it is supposed to be traceable to.
  for (const out of ['/tmp/x.html', '/tmp/x.HTML', '/tmp/notes.txt', '/tmp/report', '/tmp/a.b.html']) {
    assert.notEqual(R.dataPathFor(out), out, `${out} would overwrite itself`);
    assert.match(R.dataPathFor(out), /\.data\.json$/);
  }
  assert.equal(R.dataPathFor('/tmp/2026-08-25.html'), '/tmp/2026-08-25.data.json');
  assert.equal(R.dataPathFor('/tmp/notes.txt'), '/tmp/notes.txt.data.json');
});

test('a merge count that excludes unconfirmed work says so, right next to the number', () => {
  // The week of 2026-08-04: 43 merges, 41 of them outside the slice GitHub was
  // asked for, and the page printed "2" with nothing to say it was short.
  const short = R.ok(2, { couldNotConfirm: 41, notCountedBecauseNotMerged: 0 });
  assert.match(R.mergesNote(short), /41/);
  assert.match(R.mergesNote(short), /could not be confirmed/i);

  const clean = R.ok(43, { couldNotConfirm: 0, notCountedBecauseNotMerged: 0 });
  assert.equal(R.mergesNote(clean), null, 'a fully-read week gets no small print to ignore');

  assert.equal(R.mergesNote(R.notAvailable('gh is not installed')), null,
    'an unreadable figure already prints its reason; a note would say it twice');
});

test('an incomplete merge count reaches the page as a warning, not as small print', () => {
  const html = R.renderReportHtml({
    repo: 'mentor24-maker/starcaster',
    window: { from: '2026-08-04', to: '2026-08-10', days: 7 },
    figures: { merges: R.ok(2, { perDay: [], couldNotConfirm: 41 }) },
    merges: [],
    groups: [],
  });
  assert.match(html, /41/, 'the number of unconfirmed merges is on the page');
  assert.match(html, /incomplete/i, 'and the page says the count is incomplete');
  assert.match(html, /class="unread"/, 'in the same amber box an unreadable figure gets');

  // The control: a fully-confirmed week must NOT carry the warning, or the
  // assertion above would pass on every page and prove nothing.
  const cleanHtml = R.renderReportHtml({
    repo: 'mentor24-maker/starcaster',
    window: { from: '2026-08-04', to: '2026-08-10', days: 7 },
    figures: { merges: R.ok(43, { perDay: [], couldNotConfirm: 0 }) },
    merges: [],
    groups: [],
  });
  assert.ok(!/incomplete/i.test(cleanHtml), 'a complete week must not cry wolf');
});

test('the merged check asks about the pull requests it actually found', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  // `gh pr list --state merged --limit 300` returns the 300 most recently
  // CREATED merged PRs — it reaches back to #128 on this repo. It may confirm;
  // it may never be the last word, or every older window silently loses merges.
  assert.match(src, /'pr', 'view', String\(c\.number\)/,
    'a candidate the recent slice does not vouch for is asked about by number');
  assert.match(src, /couldNotConfirm/, 'and anything still unanswered is counted, not dropped');
});

test('the diffstat measures the window, not everything merged since', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const line = src.split('\n').find((l) => /'diff', '--shortstat'/.test(l));
  assert.ok(line, 'it does take a diffstat, or this assertion proves nothing');
  // Diffing against origin/main measured everything merged SINCE the window:
  // 581 files and +113,964 lines for one week, roughly fifty times over.
  assert.ok(!/origin\/main/.test(line), `the diffstat must end at the window, not at HEAD: ${line.trim()}`);
  assert.match(line, /newest/, 'it ends at the newest merge inside the window');
});

test('an unreadable merge list does not make the diffstat report a quiet week', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  // With `gh` unavailable the tiles read "no merged pull requests in the
  // window, so there is nothing to diff" — which is a sentence about a calm
  // week, not about a source that could not be read.
  assert.match(src, /the merge list could not be read/,
    'the diffstat distinguishes "nothing merged" from "we could not tell"');
});

// ── The wrapper's self-update, exercised for real ──────────────────────────
//
// This one is not a text-shape assertion, because the failure it pins is
// invisible in every log: the wrapper prints "update: skipped" both when it is
// healthily leaving someone's work alone and when it has permanently disabled
// itself. Only running it against a checkout carrying the residue can tell
// those apart, so that is what this does — two throwaway git repos on disk, no
// network, no doppler, no npm.

const os = require('node:os');
const { spawnSync } = require('node:child_process');

const GIT_ID = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false'];

function git(cwd, ...args) {
  const res = spawnSync('git', [...GIT_ID, ...args], { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  return (res.stdout || '').trim();
}

test('the self-update survives the output the job itself leaves behind', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-report-wrapper-'));
  try {
    const origin = path.join(tmp, 'origin.git');
    const work = path.join(tmp, 'work');
    const other = path.join(tmp, 'other');

    fs.mkdirSync(origin);
    git(origin, 'init', '--bare', '-b', 'main', '.');

    // A checkout with one commit on main, pushed. The wrapper is a TRACKED
    // file in it, as it is in the real repo — an untracked copy would be dirt
    // of its own and the test would be measuring its own fixture.
    fs.mkdirSync(work);
    git(work, 'init', '-b', 'main', '.');
    git(work, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(path.join(work, 'README.md'), 'first\n');
    fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
    const wrapper = path.join(work, 'scripts', 'run_weekly_report.sh');
    fs.copyFileSync(path.resolve(__dirname, '..', 'run_weekly_report.sh'), wrapper);
    fs.chmodSync(wrapper, 0o755);
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'first');
    git(work, 'push', '-u', 'origin', 'main');

    // Somebody else moves main on, exactly as a merged pull request would —
    // including the first published edition, which adds a file under
    // docs/reports/ that this checkout is about to be sitting on untracked.
    git(tmp, 'clone', '--quiet', origin, other);
    fs.mkdirSync(path.join(other, 'docs', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(other, 'docs', 'reports', '2026-08-25.html'), '<!doctype html>published\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'second');
    git(other, 'push', 'origin', 'main');
    const wanted = git(other, 'rev-parse', 'HEAD');

    // Run 1's leftovers, exactly as the report writes them.
    fs.mkdirSync(path.join(work, 'docs', 'reports'), { recursive: true });
    for (const f of ['2026-08-25.html', '2026-08-25.data.json', 'index.html']) {
      fs.writeFileSync(path.join(work, 'docs', 'reports', f), 'leftover\n');
    }

    // The control. If the fixture were not actually dirty, the assertions
    // below would pass against the broken wrapper too and prove nothing.
    assert.notEqual(
      spawnSync('git', ['status', '--porcelain'], { cwd: work, encoding: 'utf8' }).stdout.trim(), '',
      'the fixture has to reproduce the dirty checkout, or this test is theatre',
    );

    const res = spawnSync('bash', [wrapper], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, WEEKLY_REPORT_UPDATE_ONLY: '1' },
    });
    const out = `${res.stdout}\n${res.stderr}`;

    assert.ok(!/update: skipped/.test(out), `the update disabled itself on run two:\n${out}`);
    assert.match(out, /update: checkout is at/, `the update did not run:\n${out}`);
    assert.equal(git(work, 'rev-parse', 'HEAD'), wanted, 'the checkout did not actually move');
    assert.match(out, /cleanup: removing/, 'and it said what it removed');

    // It removed its OWN output and nothing else — a background job may keep a
    // checkout current, it may not throw away anyone's work.
    fs.writeFileSync(path.join(work, 'README.md'), 'edited by a person\n');
    const second = spawnSync('bash', [wrapper], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, WEEKLY_REPORT_UPDATE_ONLY: '1' },
    });
    assert.match(`${second.stdout}`, /update: skipped — uncommitted changes/,
      'a real uncommitted edit still stops the update');
    assert.equal(fs.readFileSync(path.join(work, 'README.md'), 'utf8'), 'edited by a person\n',
      'and it must not have been touched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── The third door into the self-update deadlock (review pass 3) ───────────
//
// The test above proves the wrapper survives its own UNTRACKED output. That is
// only half of what it leaves behind, and the other half arrives later — which
// is why it was missed. `writeIndex()` rewrites docs/reports/index.html on
// every run, and `publish()` COMMITS it. So the first published edition is
// fine, and from the second one onward index.html is a tracked file with a
// local modification: `git clean` cannot touch it, `git status --porcelain`
// reports it forever, and the self-update is skipped permanently and silently —
// the same deadlock as round 1, through a third door.
//
// The fixture difference is one line (`git add` the index before modifying it)
// and it is the entire point of this test.

test('the self-update survives its own output even once that output is TRACKED', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-report-tracked-'));
  try {
    const origin = path.join(tmp, 'origin.git');
    const work = path.join(tmp, 'work');
    const other = path.join(tmp, 'other');

    fs.mkdirSync(origin);
    git(origin, 'init', '--bare', '-b', 'main', '.');

    fs.mkdirSync(work);
    git(work, 'init', '-b', 'main', '.');
    git(work, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(path.join(work, 'README.md'), 'first\n');
    fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
    const wrapper = path.join(work, 'scripts', 'run_weekly_report.sh');
    fs.copyFileSync(path.resolve(__dirname, '..', 'run_weekly_report.sh'), wrapper);
    fs.chmodSync(wrapper, 0o755);

    // THE STATE THE SECOND PUBLISHED EDITION RUNS IN: index.html is tracked,
    // because the first edition's pull request merged and brought it to main.
    fs.mkdirSync(path.join(work, 'docs', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(work, 'docs', 'reports', 'index.html'), '<!doctype html>edition one\n');
    fs.writeFileSync(path.join(work, 'docs', 'reports', '2026-08-25.html'), '<!doctype html>published\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'first, including the first published edition');
    git(work, 'push', '-u', 'origin', 'main');

    // Upstream moves on, as a merged pull request would.
    git(tmp, 'clone', '--quiet', origin, other);
    fs.writeFileSync(path.join(other, 'README.md'), 'second\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'second');
    git(other, 'push', 'origin', 'main');
    const wanted = git(other, 'rev-parse', 'HEAD');

    // What run two actually leaves: the index REWRITTEN (tracked, modified) and
    // a fresh edition beside it (untracked). Only the second kind was handled.
    fs.writeFileSync(path.join(work, 'docs', 'reports', 'index.html'), '<!doctype html>edition two\n');
    fs.writeFileSync(path.join(work, 'docs', 'reports', '2026-09-01.html'), 'leftover\n');
    fs.writeFileSync(path.join(work, 'docs', 'reports', '2026-09-01.data.json'), '{}\n');

    // The control, and it is a sharper one than the test above needs: the dirt
    // must include a MODIFIED TRACKED file, not just untracked residue. If the
    // fixture only carried untracked files this test would be a copy of the
    // previous one and would pass against the broken wrapper.
    const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: work, encoding: 'utf8' }).stdout;
    assert.match(dirty, /^ M docs\/reports\/index\.html$/m,
      'the fixture must reproduce a MODIFIED TRACKED file, or this test proves nothing new');

    const res = spawnSync('bash', [wrapper], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, WEEKLY_REPORT_UPDATE_ONLY: '1' },
    });
    const out = `${res.stdout}\n${res.stderr}`;

    assert.ok(!/update: skipped/.test(out), `the update disabled itself on the second edition:\n${out}`);
    assert.match(out, /update: checkout is at/, `the update did not run:\n${out}`);
    assert.equal(git(work, 'rev-parse', 'HEAD'), wanted, 'the checkout did not actually move');
    assert.match(out, /cleanup: restoring/, 'and it said what it restored, rather than doing it silently');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('restoring tracked files is fenced to main, so it cannot eat a branch\'s work', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-report-fence-'));
  try {
    const work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    git(work, 'init', '-b', 'main', '.');
    fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
    const wrapper = path.join(work, 'scripts', 'run_weekly_report.sh');
    fs.copyFileSync(path.resolve(__dirname, '..', 'run_weekly_report.sh'), wrapper);
    fs.chmodSync(wrapper, 0o755);
    fs.mkdirSync(path.join(work, 'docs', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(work, 'docs', 'reports', '2026-08-25.html'), 'the shipped edition\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'first');

    // The narrative pass: a person writing prose onto a report, on a branch, in
    // its own worktree. Restoring here would throw away exactly the work this
    // whole script exists to make possible.
    git(work, 'checkout', '-q', '-b', 'weekly-narrative');
    fs.writeFileSync(path.join(work, 'docs', 'reports', '2026-08-25.html'), 'the narrative, half written\n');

    const res = spawnSync('bash', [wrapper], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, WEEKLY_REPORT_UPDATE_ONLY: '1' },
    });

    assert.equal(
      fs.readFileSync(path.join(work, 'docs', 'reports', '2026-08-25.html'), 'utf8'),
      'the narrative, half written\n',
      'a background job may keep a checkout current; it may not throw away a branch\'s work',
    );
    assert.match(`${res.stdout}`, /not main — leaving them alone/,
      'and it says why it left them, rather than appearing to have done nothing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── A failed command is never reported as a success (review pass 3) ─────────
//
// `bus()` is the only escalation channel an unattended Monday run has, and its
// "(could not reach the bus either)" warning was unreachable code: run() was
// called with allowFail, which set ok:true on ANY non-zero exit. A failed bus
// post said nothing whatsoever — while the bus was in fact returning HTTP 400
// in production (ticket 86bbjzg83).
//
// The flag is gone, so the trap is gone with it. These pin the behaviour rather
// than the absence of a word, because "nobody passes allowFail today" is a fact
// about today.

const { run } = require('./runCommand.js');

test('a command that exits non-zero is never ok, and still hands back its output', () => {
  const res = run('sh', ['-c', 'echo the-output-still-matters; exit 3']);
  assert.equal(res.ok, false, 'a non-zero exit is a failure, whatever the caller hoped');
  assert.equal(res.status, 3, 'and the real exit status survives for a caller that wants it');
  assert.match(res.reason, /exited 3/, 'the reason names the exit status');
  assert.match(res.stdout, /the-output-still-matters/,
    'output is still available — that is what allowFail was for, and it costs nothing to give it away for free');
});

test('a command that exits 0 is ok', () => {
  const res = run('sh', ['-c', 'echo fine']);
  assert.equal(res.ok, true);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /fine/);
});

test('a command that cannot run at all is reported as such, not as empty output', () => {
  const res = run('this-command-does-not-exist-anywhere', []);
  assert.equal(res.ok, false);
  assert.match(res.reason, /could not run|exited/,
    'a missing binary must not read as a command that ran and said nothing');
});

test('the report never asks run() to call a failure a success', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  assert.ok(!/allowFail/.test(code),
    'allowFail made every `if (!res.ok)` below it dead code, twice, in two different functions — it does not come back');
});

test('the bus warning is reachable: bus() checks the result it gets back', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const busFn = src.slice(src.indexOf('function bus('));
  const body = busFn.slice(0, busFn.indexOf('\n}'));
  assert.match(body, /if \(!res\.ok\)/, 'a failed bus post is reported');
  assert.ok(!/allowFail/.test(body), 'and nothing upstream is telling run() to lie about it');
});

// ── The three smaller round-3 items ────────────────────────────────────────

// The exit code of a --publish run. These call the function rather than
// reading the script's source, which the first version of this test did — and
// a regex over source can only ever prove a line is PRESENT, not that it runs
// for the right input. That is how the defect below survived being "tested".

test('a publish that was asked for and did not happen exits non-zero', () => {
  assert.equal(R.publishExitCode({ published: true }), 0, 'a report that shipped is a success');
  assert.equal(R.publishExitCode({ published: false, reason: 'no changes' }), 0,
    'a week identical to the last edition is a quiet week, not a failure');
  assert.equal(R.publishExitCode({ published: false, reason: 'other-node' }), 3,
    'another machine owning the job is a designed decline — the code node:owns uses');

  for (const reason of ['gh exited 1', 'push rejected', 'unknown-role']) {
    assert.equal(R.publishExitCode({ published: false, reason }), 1,
      `launchd must not record a clean Monday for a week that produced no report (${reason})`);
  }
});

test("'unidentified' exits 1, not 3 — it is ignorance, not a decline", () => {
  // THE DEFECT THIS PINS. `unidentified` was filed beside `other-node` and
  // given exit 3, on the reasoning that both mean "this machine did not
  // publish". They do — but 3 says WHY: another machine has it in hand. An
  // unidentified machine does not know that. It cannot tell whether some other
  // node published this week or whether nobody did, and those look identical
  // from here while only one of them is safe. Exit 3 reports that ignorance to
  // launchd as a tidy "not my job", and the Monday with no report goes by
  // unnoticed — the exact silence this script exists to prevent.
  assert.equal(R.publishExitCode({ published: false, reason: 'unidentified' }), 1);
});

test('publishExitCode agrees with node_role.mjs about what 3 means', () => {
  // Two files decide this independently, so they can drift. node_role.mjs:
  // "'other-node' is an ordinary answer; the rest mean we could not tell."
  // Every non-owning verdict nodeRoles.js can produce is checked against that
  // sentence, so a NEW verdict added there cannot quietly inherit exit 3.
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'lib', 'nodeRoles.js'), 'utf8');
  const verdicts = [...src.matchAll(/verdict: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(verdicts.includes('unidentified') && verdicts.includes('other-node'),
    'the verdicts are still named this way in lib/nodeRoles.js');

  for (const v of new Set(verdicts)) {
    if (v === 'owned') continue;
    const expected = v === 'other-node' ? 3 : 1;
    assert.equal(R.publishExitCode({ published: false, reason: v }), expected,
      `verdict '${v}' must exit ${expected}; only "another machine has it" earns a 3`);
  }
});

test('the narrative ticket can never be filed pointing at the word "undefined"', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const idx = src.indexOf("const url = pr.stdout");
  assert.ok(idx > 0, 'the PR url is still read off gh here');
  const after = src.slice(idx, idx + 600);
  assert.match(after, /if \(!url\)/, 'a missing url is caught');
  assert.ok(after.indexOf('if (!url)') < after.indexOf('fileNarrativeTicket'),
    'and it is caught BEFORE the ticket is filed, which is the only ordering that helps');
});

test('every window on the page means the same week — the CI median is local, like the rest', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function gatherCiMedian('));
  const bounds = fn.slice(0, fn.indexOf('const created'));
  assert.ok(!/T00:00:00Z|T23:59:59Z/.test(bounds),
    'a UTC bound here measured a span shifted from the local week the page names');
  assert.match(bounds, /T00:00:00`/, 'the window opens on the local day, as gatherMerges does');
  assert.match(bounds, /T23:59:59`/, 'and closes on it');
});

// ── The six defects the second review pass found ───────────────────────────
//
// Five of them are one rule broken from five directions, and it is the same
// rule as the round before: a number that is SHORT must never be printed as
// though it were whole. The sixth is a flag combination that quietly writes
// outside the folder it means to write in.

test('the schedule reports on a week that has finished, not the one we are standing in', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'run_weekly_report.sh'), 'utf8');
  // `--window 7` alone means "the 7 days ending TODAY". Fired Monday 07:00 it
  // stops at 07:00 and the next edition starts Tuesday, so Monday daytime falls
  // into no edition at all — 70 of 107 Monday merges since 1 July, silently.
  const invocation = src.split('\n').find((l) => l.includes('weekly_report.mjs') && !l.trimStart().startsWith('#'));
  assert.ok(invocation, 'the wrapper must actually run the report, or this proves nothing');
  assert.match(invocation, /--as-of/, 'the scheduled run must pin the window to a finished day');
  assert.ok(!/--as-of\s+"?\$\(date \+%F\)/.test(invocation), 'ending the window today is the defect itself');
  // And the day it pins to has to be worked out, not assumed present.
  assert.match(src, /date -v-1d \+%F/, 'yesterday is computed from the clock');
  assert.match(src, /refusing to report on a partial week/, 'and a clock it cannot read stops the run rather than silently reporting a short week');
});

test('shiftDate moves a date by whole days, at the boundary too', () => {
  assert.equal(R.shiftDate('2026-08-30', -1), '2026-08-29');
  assert.equal(R.shiftDate('2026-08-30', 1), '2026-08-31');
  assert.equal(R.shiftDate('2026-09-01', -1), '2026-08-31', 'across a month');
  assert.equal(R.shiftDate('2026-01-01', -1), '2025-12-31', 'across a year');
  assert.throws(() => R.shiftDate('not-a-date', 1), /not a YYYY-MM-DD date/);
});

test('the CI median asks GitHub for the window rather than trimming a recent slice', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function gatherCiMedian'), src.indexOf('function gatherOpenPrs'));
  // The old version asked for the 200 most recent runs and medianed whatever
  // fell inside the window. On this repo 200 runs reaches back under six days
  // against a seven-day window: 466 runs in the window, 200 read, and the page
  // printed a bare "1m27s" for it.
  assert.match(fn, /'--created'/, 'the range is asked of GitHub, not trimmed afterwards');
  assert.match(fn, /shiftDate/, 'and widened a day each side, because --created is UTC-dated');
  // It must be able to tell a complete answer from a cut-off one.
  assert.match(fn, /truncated/, 'it decides whether the slice covered the window');
  assert.match(fn, /partial: truncated/, 'and carries that verdict onto the figure');
});

test('a CI median taken from a partial slice cannot print as a bare number', () => {
  const partial = R.ok(87, { sampleSize: 200, partial: true, limit: 1000 });
  const note = R.ciMedianNote(partial);
  assert.match(note, /1000/, 'the note names how far it could see');
  assert.match(note, /the window holds more/, 'and says plainly that it is short');

  const whole = R.ok(87, { sampleSize: 466, partial: false, limit: 1000 });
  assert.match(R.ciMedianNote(whole), /across 466 successful runs/);
  assert.ok(!/holds more/.test(R.ciMedianNote(whole)), 'a complete median must not warn about nothing');

  // And the tint reaches the page, not just the small print. Match the TILE,
  // not the page: `tile--partial` is also in the stylesheet, so a page-wide
  // search finds it whether or not anything is actually tinted — an assertion
  // that cannot fail. It caught itself on the first run.
  const w = { from: '2026-08-23', to: '2026-08-29', days: 7 };
  const tinted = /<div class="tile tile--partial">/;
  assert.match(R.renderReportHtml({ window: w, figures: { ciMedianSeconds: partial } }), tinted,
    'a short median is tinted like the short merge count is');
  assert.ok(!tinted.test(R.renderReportHtml({ window: w, figures: { ciMedianSeconds: whole } })),
    'and a complete one is not, or the tint means nothing');
});

test('"nothing ran" and "we could not see that far back" are different sentences', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function gatherCiMedian'), src.indexOf('function gatherOpenPrs'));
  // An empty median used to say "no successful CI runs finished inside the
  // window" whether the week was quiet or the slice never reached it. One of
  // those is a fact about the week; the other is a fact about the lookup.
  assert.match(fn, /no successful CI runs finished inside the window/, 'the genuinely quiet week still says so');
  const truncatedBranch = fn.slice(fn.indexOf('if (med === null)'));
  assert.match(truncatedBranch, /may not cover the window/, 'and an unreachable window says THAT instead');
});

test('a checkout whose main was never refreshed says so on the page', () => {
  const stale = R.renderStaleOriginCaution({ ok: false, reason: 'could not reach origin' });
  assert.match(stale, /could not be refreshed/, 'the reader is told');
  assert.match(stale, /could not reach origin/, 'and given the reason');
  assert.match(stale, /class="unread"/, 'in the same amber box an unread figure gets');
  assert.equal(R.renderStaleOriginCaution({ ok: true, reason: null }), '', 'a good fetch says nothing');
  assert.equal(R.renderStaleOriginCaution(null), '', 'and a missing verdict does not invent a warning');

  const page = R.renderReportHtml({
    window: { from: '2026-08-23', to: '2026-08-29', days: 7 },
    figures: {},
    originFetch: { ok: false, reason: 'network is down' },
  });
  assert.match(page, /network is down/, 'and it reaches the rendered page, not just the helper');
});

test('the gatherer fetches origin/main before reading any figure out of it', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  // The merge count, both lines-changed figures and the chart all read
  // origin/main. The wrapper's self-update skips on four separate conditions,
  // and on every one of them origin/main is however stale it happened to be.
  const fetchAt = src.indexOf("run('git', ['fetch', 'origin', 'main'");
  assert.ok(fetchAt > 0, 'it fetches origin/main');
  const gatherAt = src.indexOf('mergeResult = gatherMerges()');
  assert.ok(gatherAt > 0 && fetchAt < gatherAt, 'and does it BEFORE gathering, or the fetch is decoration');
  assert.match(src, /originFetch: \{ ok:/, 'the verdict is recorded in the data file');
  assert.match(src, /NOT fetched/, 'and a failed fetch is loud in the log too');
});

test('the scratch files it writes cannot wedge the checkout', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  // These used to be written to the repo root and unlinked on the way out. A
  // run killed mid-publish left one behind untracked, `git status --porcelain`
  // was non-empty from then on, and the wrapper's self-update skipped every
  // week after — the same deadlock the docs/reports/ cleanup was added to fix,
  // arriving through a second door.
  const writes = src.split('\n').filter((l) => /writeFileSync/.test(l) && !l.trimStart().startsWith('*'));
  assert.ok(writes.length > 0, 'it does write files, or this assertion proves nothing');
  for (const line of writes) {
    assert.ok(!/path\.join\(REPO, '\./.test(line), `a scratch file at the repo root came back: ${line.trim()}`);
  }
  assert.match(src, /os\.tmpdir\(\)/, 'scratch files go somewhere the repo has no opinion about');
  assert.ok(!/'\.weekly-report-ticket\.md'/.test(src), 'the old root ticket path is gone');
  assert.ok(!/'\.weekly-report-bus\.md'/.test(src), 'the old root bus path is gone');
});

test('the closed-ticket count is bounded at BOTH ends', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'weekly_report.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function gatherStages'), src.indexOf('function gatherLoopPasses'));
  // With only a floor, "closed in the window" ran from the window start until
  // NOW — so a report for a week ending the 25th counted tickets closed on the
  // 28th. Correct for a window ending today, wrong for every --as-of.
  assert.match(fn, /'--since', WINDOW\.from/, 'the floor is the window start');
  assert.match(fn, /'--until', WINDOW\.to/, 'and the ceiling is the window END, not today');

  const cli = fs.readFileSync(path.resolve(__dirname, '..', 'clickup_direct.mjs'), 'utf8');
  const cmd = cli.slice(cli.indexOf("cmd === 'stage-counts'"), cli.indexOf("cmd === 'get'"));
  assert.match(cmd, /closedAt >= cutoff && closedAt <= ceiling/, 'and stage-counts honours both');
  assert.match(cmd, /--until needs --since/, 'a ceiling with no floor is refused rather than ignored');
  // The range is worked out before the fetch, so a typo costs no API budget.
  assert.ok(cmd.indexOf('--until needs --since') < cmd.indexOf('await fetchAllTasks'), 'the dates are validated before ClickUp is called');
});

test('--out and --publish refuse to combine', () => {
  // Publishing copies the report into a throwaway worktree by its path RELATIVE
  // TO THE REPO. An --out inside docs/reports/ is a copy onto itself; an --out
  // anywhere else is a relative path that climbs out of the worktree entirely.
  const res = spawnSync(process.execPath, [
    path.resolve(__dirname, '..', 'weekly_report.mjs'), '--out', path.join(os.tmpdir(), 'x.html'), '--publish',
  ], { encoding: 'utf8', timeout: 60000 });
  assert.equal(res.status, 2, `expected a refusal, got ${res.status}: ${res.stderr || res.stdout}`);
  assert.match(res.stderr, /do not combine/, 'and it says why in words');
  // It must refuse BEFORE doing any work — no branch, no PR, no ticket.
  assert.ok(!/Pull request:/.test(res.stdout + res.stderr), 'it stopped before publishing anything');
});
