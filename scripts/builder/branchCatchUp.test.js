'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const {
  CODES,
  PIN_DRIVER_KEY,
  parseRepoFromRemoteUrl,
  assetPinDriverInstalled,
  catchUpBranchLocally,
} = require('./branchCatchUp');

/**
 * The relay handed twelve PRs to a human in one day for conflicts that were
 * not conflicts. This module lets it ask the machine it is running on instead
 * of taking GitHub's word.
 *
 * The premise is a factual claim about git — "the asset-pin driver turns a
 * conflicting merge into a clean one, and GitHub cannot run it" — so the
 * centrepiece here is a REAL git repository, not a mock. A mocked git would
 * happily confirm any premise I wrote into it, including a wrong one.
 *
 * The mocked tests cover the decision table around that: every way the check
 * can fail must hand over, and none of them may report clean.
 */

// ── A real repository, built to reproduce the exact failure ───────────────

function git(args, cwd) {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: out.status === 0, stdout: String(out.stdout || '').trim(), stderr: String(out.stderr || '').trim() };
}

const DRIVER = path.resolve(__dirname, '../merge_asset_pins.cjs');

/**
 * A bare "origin" plus a working clone, with one pin-carrying HTML file that
 * two branches both change — which is precisely the collision .gitattributes
 * exists for.
 */
function buildRepo({ installDriver, alsoConflictForReal = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-catchup-test-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');

  git(['init', '--bare', '-b', 'main', origin], root);
  git(['clone', origin, work], root);
  git(['config', 'user.email', 'test@example.com'], work);
  git(['config', 'user.name', 'Test'], work);

  fs.writeFileSync(path.join(work, '.gitattributes'), 'site.html merge=asset-pins\n');
  fs.writeFileSync(path.join(work, 'site.html'),
    '<html>\n<script src="/bundle.js?v=aaaaaaaa"></script>\n<p>shared</p>\n</html>\n');
  fs.writeFileSync(path.join(work, 'other.txt'), 'base\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'base'], work);
  git(['push', 'origin', 'main'], work);

  // The branch: a different pin, and its own file.
  git(['checkout', '-b', 'feature'], work);
  fs.writeFileSync(path.join(work, 'site.html'),
    '<html>\n<script src="/bundle.js?v=bbbbbbbb"></script>\n<p>shared</p>\n</html>\n');
  if (alsoConflictForReal) fs.writeFileSync(path.join(work, 'other.txt'), 'branch version\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'feature'], work);
  git(['push', 'origin', 'feature'], work);

  // main moves on: a THIRD pin on the same line.
  git(['checkout', 'main'], work);
  fs.writeFileSync(path.join(work, 'site.html'),
    '<html>\n<script src="/bundle.js?v=cccccccc"></script>\n<p>shared</p>\n</html>\n');
  if (alsoConflictForReal) fs.writeFileSync(path.join(work, 'other.txt'), 'main version\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'main moves'], work);
  git(['push', 'origin', 'main'], work);

  if (installDriver) {
    git(['config', 'merge.asset-pins.name', 'pins'], work);
    git(['config', 'merge.asset-pins.driver', `node ${DRIVER} %O %A %B %P`], work);
  }
  return { root, origin, work };
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

test('THE PREMISE: without the driver the pin merge conflicts, with it it does not', (t) => {
  const bare = buildRepo({ installDriver: false });
  t.after(() => cleanup(bare.root));

  // No driver — this is what GitHub sees.
  git(['checkout', 'feature'], bare.work);
  const plain = git(['merge', 'main', '--no-edit'], bare.work);
  assert.equal(plain.ok, false, 'without the driver, the pins must collide — otherwise this whole module is solving nothing');
  const stuck = git(['diff', '--name-only', '--diff-filter=U'], bare.work);
  assert.match(stuck.stdout, /site\.html/);
  git(['merge', '--abort'], bare.work);

  // Same repository, same commits, driver registered — this is what we see.
  git(['config', 'merge.asset-pins.name', 'pins'], bare.work);
  git(['config', 'merge.asset-pins.driver', `node ${DRIVER} %O %A %B %P`], bare.work);
  const driven = git(['merge', 'main', '--no-edit'], bare.work);
  assert.equal(driven.ok, true, 'with the driver the same merge is clean — that difference IS the false conflict');
});

test('a false conflict is caught up and pushed', (t) => {
  const repo = buildRepo({ installDriver: true });
  t.after(() => cleanup(repo.root));

  const before = git(['rev-parse', 'origin/feature'], repo.work).stdout;
  const out = catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work });

  assert.equal(out.code, CODES.CLEAN, out.reason);
  assert.equal(out.ok, true);

  git(['fetch', 'origin'], repo.work);
  const after = git(['rev-parse', 'origin/feature'], repo.work).stdout;
  assert.notEqual(after, before, 'the branch must actually have moved on the remote');

  // And it now contains main — the thing the whole exercise was for.
  const contains = git(['merge-base', '--is-ancestor', 'origin/main', 'origin/feature'], repo.work);
  assert.equal(contains.ok, true, 'the caught-up branch must contain main');
});

test('the push is a fast-forward — the branch only ever gains commits', (t) => {
  const repo = buildRepo({ installDriver: true });
  t.after(() => cleanup(repo.root));

  const before = git(['rev-parse', 'origin/feature'], repo.work).stdout;
  assert.equal(catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work }).ok, true);
  git(['fetch', 'origin'], repo.work);

  // The old head is still an ancestor. A rebase or a force-push would have
  // discarded it, and a force-push inside a script is invisible to the
  // operator's own deny rule (DOCTRINE 6.6).
  const kept = git(['merge-base', '--is-ancestor', before, 'origin/feature'], repo.work);
  assert.equal(kept.ok, true, 'the previous branch head must survive — nothing may be rewritten');
});

test('a REAL conflict is refused, named, and leaves the branch untouched', (t) => {
  const repo = buildRepo({ installDriver: true, alsoConflictForReal: true });
  t.after(() => cleanup(repo.root));

  const before = git(['rev-parse', 'origin/feature'], repo.work).stdout;
  const out = catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work });

  assert.equal(out.code, CODES.REAL_CONFLICT);
  assert.equal(out.ok, false);
  assert.ok(out.files.includes('other.txt'), `should name the overlapping file, got ${JSON.stringify(out.files)}`);
  assert.ok(!out.files.includes('site.html'), 'the pin file was resolved by the driver and is not the conflict');

  git(['fetch', 'origin'], repo.work);
  assert.equal(git(['rev-parse', 'origin/feature'], repo.work).stdout, before, 'nothing may be pushed on a real conflict');
});

test('the scratch worktree is always cleaned up, conflict or not', (t) => {
  const repo = buildRepo({ installDriver: true, alsoConflictForReal: true });
  t.after(() => cleanup(repo.root));

  catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work });
  const list = git(['worktree', 'list'], repo.work).stdout;
  assert.equal(list.split('\n').filter(Boolean).length, 1, `only the main worktree should remain:\n${list}`);
});

test('without the driver registered it refuses rather than reproducing GitHub', (t) => {
  const repo = buildRepo({ installDriver: false });
  t.after(() => cleanup(repo.root));

  const out = catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work });
  assert.equal(out.code, CODES.NO_DRIVER);
  assert.equal(out.ok, false);
  assert.match(out.reason, /npm install/, 'the message must say how to fix it');
});

// ── The decision table, with git stubbed out ──────────────────────────────

function stubGit(overrides = {}) {
  return (args) => {
    const key = args.slice(0, 2).join(' ');
    if (args[0] === 'remote') return { ok: true, stdout: 'git@github.com:me/starcaster.git', stderr: '' };
    if (args[0] === 'config') return { ok: true, stdout: 'node driver', stderr: '' };
    if (overrides[key]) return overrides[key];
    if (overrides[args[0]]) return overrides[args[0]];
    return { ok: true, stdout: '', stderr: '' };
  };
}

const STUB_OPTS = {
  cwd: '/nowhere',
  makeTempDir: () => '/nowhere/tmp',
  removeDir: () => {},
};

test('a PR on another repo is never caught up from this checkout', () => {
  const out = catchUpBranchLocally({ repo: 'me/normie', branch: 'x', runGit: stubGit(), ...STUB_OPTS });
  assert.equal(out.code, CODES.WRONG_REPO);
  assert.match(out.reason, /me\/starcaster/);
});

test('the right repo passes the repo check regardless of URL style', () => {
  for (const url of [
    'git@github.com:me/starcaster.git',
    'https://github.com/me/starcaster',
    'https://github.com/me/starcaster.git',
  ]) {
    assert.equal(parseRepoFromRemoteUrl(url), 'me/starcaster', url);
  }
  assert.equal(parseRepoFromRemoteUrl(''), '');
  assert.equal(parseRepoFromRemoteUrl('not a url'), '');
});

test('an unreadable remote is treated as the wrong repo, not as a match', () => {
  const run = (args) => (args[0] === 'remote'
    ? { ok: false, stdout: '', stderr: 'no origin' }
    : { ok: true, stdout: 'x', stderr: '' });
  const out = catchUpBranchLocally({ repo: 'me/starcaster', branch: 'x', runGit: run, ...STUB_OPTS });
  assert.equal(out.code, CODES.WRONG_REPO);
});

test('a failed fetch hands over instead of merging stale refs', () => {
  const out = catchUpBranchLocally({
    repo: 'me/starcaster', branch: 'x',
    runGit: stubGit({ fetch: { ok: false, stdout: '', stderr: 'network down' } }),
    ...STUB_OPTS,
  });
  assert.equal(out.code, CODES.FETCH_FAILED);
  assert.match(out.reason, /network down/);
});

test('a failed worktree hands over', () => {
  const out = catchUpBranchLocally({
    repo: 'me/starcaster', branch: 'x',
    runGit: stubGit({ worktree: { ok: false, stdout: '', stderr: 'no space' } }),
    ...STUB_OPTS,
  });
  assert.equal(out.code, CODES.WORKTREE_FAILED);
});

test('a merge that does not contain main is refused, not pushed', () => {
  const pushes = [];
  const run = (args) => {
    if (args[0] === 'push') { pushes.push(args); return { ok: true, stdout: '', stderr: '' }; }
    if (args[0] === 'merge-base') return { ok: false, stdout: '', stderr: '' };
    return stubGit()(args);
  };
  const out = catchUpBranchLocally({ repo: 'me/starcaster', branch: 'x', runGit: run, ...STUB_OPTS });
  assert.equal(out.code, CODES.NOT_ANCESTOR);
  assert.equal(pushes.length, 0, 'nothing may be pushed when the sanity check fails');
});

test('a rejected push hands over and says the next pass will retry', () => {
  const out = catchUpBranchLocally({
    repo: 'me/starcaster', branch: 'x',
    runGit: stubGit({ push: { ok: false, stdout: '', stderr: 'non-fast-forward' } }),
    ...STUB_OPTS,
  });
  assert.equal(out.code, CODES.PUSH_FAILED);
  assert.match(out.reason, /next pass/);
});

test('NO failure path ever reports ok — the whole safety rule, in one assertion', () => {
  const failures = [
    { label: 'wrong repo', opts: { repo: 'me/other', runGit: stubGit() } },
    { label: 'fetch', opts: { runGit: stubGit({ fetch: { ok: false, stdout: '', stderr: 'x' } }) } },
    { label: 'worktree', opts: { runGit: stubGit({ worktree: { ok: false, stdout: '', stderr: 'x' } }) } },
    { label: 'merge', opts: { runGit: stubGit({ merge: { ok: false, stdout: '', stderr: 'x' } }) } },
    { label: 'ancestor', opts: { runGit: stubGit({ 'merge-base': { ok: false, stdout: '', stderr: '' } }) } },
    { label: 'push', opts: { runGit: stubGit({ push: { ok: false, stdout: '', stderr: 'x' } }) } },
    { label: 'no branch', opts: { branch: '', runGit: stubGit() } },
  ];
  for (const f of failures) {
    const out = catchUpBranchLocally({ repo: 'me/starcaster', branch: 'x', ...STUB_OPTS, ...f.opts });
    assert.equal(out.ok, false, `${f.label} must not report ok`);
    assert.notEqual(out.code, CODES.CLEAN, `${f.label} must not report clean`);
    assert.ok(out.reason, `${f.label} must say why`);
  }
});

test('a missing driver config is detected, not assumed present', () => {
  assert.equal(assetPinDriverInstalled(() => ({ ok: false, stdout: '', stderr: '' }), '/x'), false);
  assert.equal(assetPinDriverInstalled(() => ({ ok: true, stdout: '', stderr: '' }), '/x'), false);
  assert.equal(assetPinDriverInstalled(() => ({ ok: true, stdout: 'node d.cjs', stderr: '' }), '/x'), true);
  assert.equal(PIN_DRIVER_KEY, 'merge.asset-pins.driver');
});

// ── The relay must actually call it, and only where it is safe ────────────

test('the relay asks locally before handing a conflict over', () => {
  const src = fs.readFileSync(path.join(__dirname, '../clickup_direct.mjs'), 'utf8');
  const ask = src.indexOf('catchUpBranchLocally');
  const handOff = src.indexOf("if (gate.action === 'conflict') {");
  assert.ok(ask > -1, 'the relay must consult the local check');
  assert.ok(handOff > -1, 'the hand-off must still exist');
  assert.ok(ask < handOff, 'the local check runs BEFORE the hand-off, or it changes nothing');
  assert.match(src, /gate\.action === 'conflict' && !dryRun/, 'a dry run must never push anything');
});

test('this script contains no force-push, in any spelling', () => {
  // The same guard scripts/builder/shipThread.test.js carries, because that
  // one only ever covered shipThread.js — and this is now a SECOND script in
  // the repo that pushes. A force-push buried in a node script is invisible to
  // the operator's `Bash(git push --force*)` deny rule, and a convenience
  // command does not get to route around a standing decision (DOCTRINE 6.6).
  const lines = fs.readFileSync(path.join(__dirname, 'branchCatchUp.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  const code = lines.join('\n');

  // Scoped to the PUSH, deliberately. A first draft of this assertion banned
  // "--force" outright and failed on `worktree remove --force`, which throws
  // away a scratch directory and has nothing to do with rewriting history.
  // A guard that cries wolf on the safe case gets loosened by the next person
  // who trips it, and then it covers nothing.
  const pushLines = lines.filter((l) => /'push'/.test(l));
  assert.ok(pushLines.length, 'this test is worthless if the push line ever moves — find it or fix this');
  for (const line of pushLines) {
    assert.doesNotMatch(line, /--force/, `push must never force: ${line.trim()}`);
  }
  assert.doesNotMatch(code, /--force-with-lease/, 'no --force-with-lease anywhere');
  assert.doesNotMatch(code, /'rebase'/, 'it catches up by merging, not rebasing — that is what removes the need to force');
});

// ── Stale asset pins: the push must be authorized by builds-clean ─────────

/**
 * Task 86bbk15cb. The first version of this module pushed whatever merged
 * cleanly, which turned three green branches red in one pass (#401, #403,
 * #411) — all from one commit that edited `public/js/projectContext.js`.
 *
 * The asset-pins driver restores each `?v=` pin BY ASSET PATH. That is right
 * when only markup moved and wrong when main changed the asset underneath: the
 * restored pin names the pre-merge build, nothing rebuilds, and CI's
 * clean-build check fails on a step that reads like the branch's own fault.
 *
 * The bug was the AUTHORIZATION. "The merge was clean" is a different question
 * from "a clean build of this tree produces these pins".
 */

const { pinnedAssetSourcesIn, PIN_SOURCE_PATHS } = require('./branchCatchUp');

test('a change behind a pinned asset is recognised', () => {
  assert.deepEqual(
    pinnedAssetSourcesIn(['public/js/projectContext.js']),
    ['public/js/projectContext.js'],
    'this exact file is what turned three branches red',
  );
  assert.equal(pinnedAssetSourcesIn(['src/css/_builder-react.css']).length, 1);
  assert.equal(pinnedAssetSourcesIn(['components/builder/x.tsx']).length, 1);
  assert.equal(pinnedAssetSourcesIn(['lib/builder-client/y.ts']).length, 1);
  assert.equal(pinnedAssetSourcesIn(['react-entry.js']).length, 1);
});

test('a change that feeds no pinned asset is NOT flagged — the common case stays cheap', () => {
  // AC2: a catch-up across ordinary work must behave exactly as before, with
  // no extra cost. Flagging everything would be "safe" and would also hand
  // every branch to a human, which is the failure this whole module removed.
  assert.deepEqual(pinnedAssetSourcesIn([
    'docs/WORK-LOG.md',
    'routes/builder.js',
    'lib/projectScope.js',
    'scripts/builder/mergeOnComment.js',
    'supabase/migrations/001.sql',
  ]), []);
});

test('prefix matching does not over-reach on a lookalike path', () => {
  // 'public/app.js' is an exact-match entry, not a prefix — 'public/app.json'
  // and 'public/apps/x.js' must not match it.
  assert.deepEqual(pinnedAssetSourcesIn(['public/app.json', 'public/apps/x.js']), []);
  assert.deepEqual(pinnedAssetSourcesIn(['public/app.js']), ['public/app.js']);
});

test('malformed input does not throw', () => {
  assert.deepEqual(pinnedAssetSourcesIn(null), []);
  assert.deepEqual(pinnedAssetSourcesIn(['', '   ', null]), []);
});

/**
 * The list rots the moment somebody adds a pinned asset built from somewhere
 * new, and the failure would be silent — a branch pushed with stale pins,
 * exactly as before. So this reads what the committed HTML ACTUALLY pins and
 * fails if any of it maps to a source the list does not cover.
 */
/**
 * The guard, rebuilt after review.
 *
 * MY FIRST VERSION COULD NOT FAIL IN THE WAY THAT MATTERS. It mapped each
 * pinned URL to ONE representative source (`/builder-bundle.js` -> `components/`)
 * and asked whether that path was covered. So it could notice a brand-new
 * pinned URL, and could never notice A BUNDLE GAINING AN IMPORT FROM A NEW
 * DIRECTORY — which is how this list actually rots, and how it was ALREADY
 * stale when I wrote it: `lib/crmFormStyles.js` is compiled into
 * public/builder-bundle.js via two components, and nothing in the list covered
 * plain `lib/`.
 *
 * So the question is asked of the real dependency graph instead. esbuild's
 * metafile lists every input it actually compiled; every one of those outside
 * node_modules must be covered, or a commit touching it slips a stale pin past
 * the catch-up — precisely the bug this ticket is about.
 *
 * Node-suite test, so requiring node_modules and esbuild is fine here
 * (landmine 14 applies to vitest, which runs before the build).
 */
test('every real input of every pinned bundle is covered by the source list', async () => {
  const esbuild = require('esbuild');
  const repoRoot = path.join(__dirname, '../..');

  const BUNDLES = [
    { entry: 'builder-react-entry.tsx', loader: { '.js': 'jsx' }, jsx: 'automatic', tsconfig: 'tsconfig.json' },
    { entry: 'react-entry.js', loader: { '.js': 'jsx' } },
  ];

  const inputs = new Set();
  for (const b of BUNDLES) {
    const result = await esbuild.build({
      entryPoints: [path.join(repoRoot, b.entry)],
      bundle: true,
      write: false,
      metafile: true,
      preserveSymlinks: true,
      absWorkingDir: repoRoot,
      loader: b.loader,
      ...(b.jsx ? { jsx: b.jsx } : {}),
      ...(b.tsconfig ? { tsconfig: path.join(repoRoot, b.tsconfig) } : {}),
      logLevel: 'silent',
    });
    for (const file of Object.keys(result.metafile.inputs)) inputs.add(file);
  }

  const covered = (p) => PIN_SOURCE_PATHS.some((prefix) => (
    prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix
  ));

  const uncovered = [...inputs]
    .filter((f) => !f.startsWith('node_modules/'))
    .filter((f) => !covered(f))
    .sort();

  assert.deepEqual(uncovered, [],
    'these files are compiled INTO a ?v=-pinned bundle but PIN_SOURCE_PATHS does not\n' +
    '  cover them, so a commit touching one would push a stale pin:\n  ' + uncovered.join('\n  '));
});

/**
 * The directly-served side of the same question, across ALL the pin-carrying
 * HTML rather than one file — a pin added to public/site.html alone would
 * otherwise slip past (review finding).
 */
test('every directly-served pinned asset is covered too, across all pinned HTML', () => {
  const repoRoot = path.join(__dirname, '../..');
  const PIN_CARRYING_HTML = [
    'src/layout.html',
    'public/site.html',
    'public/about.html',
    'public/explore.html',
    'public/builder-preview.html',
  ];

  // The three assets that are BUILT — their inputs are covered by the metafile
  // test above, so only their existence is checked here.
  const BUILT = new Set(['/styles.css', '/builder-bundle.js', '/bundle.js']);

  const covered = (p) => PIN_SOURCE_PATHS.some((prefix) => (
    prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix
  ));

  const urls = new Set();
  let filesRead = 0;
  for (const rel of PIN_CARRYING_HTML) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    filesRead += 1;
    for (const m of fs.readFileSync(abs, 'utf8').matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))\?v=/gi)) {
      urls.add(m[1]);
    }
  }
  assert.ok(filesRead >= 4, `expected to read the pin-carrying HTML, read ${filesRead}`);
  assert.ok(urls.size > 10, `expected many pinned assets, found ${urls.size}`);

  const uncovered = [...urls]
    .filter((u) => !BUILT.has(u))
    .filter((u) => !covered(`public${u}`))
    .sort();
  assert.deepEqual(uncovered, [], `pinned assets whose source is not covered:\n  ${uncovered.join('\n  ')}`);
});

// ── End to end, against real git ─────────────────────────────────────────

/**
 * Same shape as buildRepo above, but main's new commit touches a file that
 * feeds a pinned asset rather than only the markup.
 */
function buildRepoWithPinnedAssetChange({ touchPinnedSource }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-pins-test-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');

  git(['init', '--bare', '-b', 'main', origin], root);
  git(['clone', origin, work], root);
  git(['config', 'user.email', 'test@example.com'], work);
  git(['config', 'user.name', 'Test'], work);
  fs.mkdirSync(path.join(work, 'public', 'js'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true });

  fs.writeFileSync(path.join(work, '.gitattributes'), 'site.html merge=asset-pins\n');
  fs.writeFileSync(path.join(work, 'site.html'),
    '<html>\n<script src="/js/core.js?v=aaaaaaaa"></script>\n<p>shared</p>\n</html>\n');
  fs.writeFileSync(path.join(work, 'public/js/core.js'), 'var a = 1;\n');
  fs.writeFileSync(path.join(work, 'docs/notes.md'), 'base\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'base'], work);
  git(['push', 'origin', 'main'], work);

  git(['checkout', '-b', 'feature'], work);
  fs.writeFileSync(path.join(work, 'site.html'),
    '<html>\n<script src="/js/core.js?v=bbbbbbbb"></script>\n<p>shared</p>\n</html>\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'feature'], work);
  git(['push', 'origin', 'feature'], work);

  git(['checkout', 'main'], work);
  fs.writeFileSync(path.join(work, 'site.html'),
    '<html>\n<script src="/js/core.js?v=cccccccc"></script>\n<p>shared</p>\n</html>\n');
  // THE DIFFERENCE: main either changed the asset behind that pin, or not.
  if (touchPinnedSource) fs.writeFileSync(path.join(work, 'public/js/core.js'), 'var a = 2;\n');
  else fs.writeFileSync(path.join(work, 'docs/notes.md'), 'main moved on\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'main moves'], work);
  git(['push', 'origin', 'main'], work);

  git(['config', 'merge.asset-pins.name', 'pins'], work);
  git(['config', 'merge.asset-pins.driver', `node ${DRIVER} %O %A %B %P`], work);
  return { root, work };
}

test('a merge that changed a pinned asset is NOT pushed — it hands over with the fix', (t) => {
  const repo = buildRepoWithPinnedAssetChange({ touchPinnedSource: true });
  t.after(() => cleanup(repo.root));

  const before = git(['rev-parse', 'origin/feature'], repo.work).stdout;
  const out = catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work });

  assert.equal(out.code, CODES.NEEDS_REBUILD, out.reason);
  assert.equal(out.ok, false);
  assert.ok(out.files.includes('public/js/core.js'), `should name the file: ${JSON.stringify(out.files)}`);
  assert.match(out.reason, /npm run build/, 'the hand-off must carry the exact next step');

  git(['fetch', 'origin'], repo.work);
  assert.equal(git(['rev-parse', 'origin/feature'], repo.work).stdout, before,
    'a tree known to have stale pins must never be pushed');
});

test('a merge that changed no pinned asset still pushes, exactly as before', (t) => {
  // AC2. The common case must not get slower or start needing a human.
  const repo = buildRepoWithPinnedAssetChange({ touchPinnedSource: false });
  t.after(() => cleanup(repo.root));

  const before = git(['rev-parse', 'origin/feature'], repo.work).stdout;
  const out = catchUpBranchLocally({ repo: '', branch: 'feature', cwd: repo.work });

  assert.equal(out.code, CODES.CLEAN, out.reason);
  git(['fetch', 'origin'], repo.work);
  assert.notEqual(git(['rev-parse', 'origin/feature'], repo.work).stdout, before,
    'the ordinary catch-up must still happen');
});
