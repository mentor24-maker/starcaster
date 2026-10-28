'use strict';
/**
 * "Is this compiled code still the code in this folder?" — asked by the
 * operator scripts that load a generated lib, BEFORE they load it.
 *
 * WHY: on 2026-10-27 the Site Import page builder crashed on the Alphire job
 * with `Cannot read properties of undefined (reading 'length')`. The main
 * folder's `lib/site-import/dist/` had been compiled on Oct 9 and the script
 * calling it expected the Oct 14 source. Rebuilding fixed it; nothing had said
 * the code was stale (task 86bctakmc). Vercel and CI always build fresh, so
 * this only bites the scripts run straight out of a checkout — the worker,
 * the mapper, the reconciler, the one-shot migrations.
 *
 * HOW: each build records, next to its output, a sha256 of every source file
 * esbuild actually read (from its metafile — so an import added next week is
 * covered without anybody updating a list here). Before loading, a script
 * re-hashes those files. Content, not timestamps: `git checkout` and
 * `git pull` reset mtimes, so a timestamp can say "fresh" about old code.
 *
 * Three answers, never two: `fresh`, `stale` (names the files that changed),
 * and `unstamped` — output built before this check existed, or a stamp that
 * cannot be read. Unstamped is NOT fresh: it is exactly the Oct 9 dist.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/** Every generated lib an operator script may load, and how to rebuild it. */
const GENERATED_LIBS = {
  'site-import': {
    name: 'the Site Import engine (lib/site-import/dist/)',
    stamp: 'lib/site-import/dist/.build-inputs.json',
    rebuild: 'build:site-import',
  },
  'builder-template': {
    name: 'the page renderer (lib/builder/template.js)',
    stamp: 'lib/builder/.build-inputs.json',
    rebuild: 'build:builder-template',
  },
};

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Source files an esbuild metafile says were read, repo-relative, without
 * node_modules (a dependency upgrade is `npm ci`'s business, and hashing a
 * whole package tree on every script start is not worth it).
 */
function inputsFromMetafiles(root, metafiles) {
  const out = new Set();
  for (const meta of metafiles) {
    for (const key of Object.keys((meta && meta.inputs) || {})) {
      // esbuild keys are relative to its working directory (root here).
      const rel = toPosix(path.relative(root, path.resolve(root, key)));
      if (rel.startsWith('..') || rel.split('/').includes('node_modules')) continue;
      out.add(rel);
    }
  }
  return [...out].sort();
}

/** Write the stamp for a build that just succeeded. `extra` adds files esbuild did not read (the build script). */
function recordBuildInputs({ root, lib, metafiles, extra = [] }) {
  const spec = GENERATED_LIBS[lib];
  if (!spec) throw new Error(`recordBuildInputs: unknown generated lib "${lib}"`);
  const files = [...new Set([...inputsFromMetafiles(root, metafiles), ...extra.map(toPosix)])].sort();
  if (!files.length) throw new Error(`recordBuildInputs: the build of ${spec.name} read no source files`);
  const inputs = {};
  for (const rel of files) inputs[rel] = sha256File(path.join(root, rel));
  const stampPath = path.join(root, spec.stamp);
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  fs.writeFileSync(stampPath, `${JSON.stringify({ builtAt: new Date().toISOString(), inputs }, null, 2)}\n`);
  return { stamp: spec.stamp, count: files.length };
}

/** Read-only verdict for one generated lib. */
function checkBuildInputs({ root, lib }) {
  const spec = GENERATED_LIBS[lib];
  if (!spec) throw new Error(`checkBuildInputs: unknown generated lib "${lib}"`);
  const base = { lib, name: spec.name, rebuild: `npm run ${spec.rebuild}` };
  let stamp;
  try {
    stamp = JSON.parse(fs.readFileSync(path.join(root, spec.stamp), 'utf8'));
  } catch (err) {
    const why = err.code === 'ENOENT'
      ? 'it was built before builds recorded their sources, or never built'
      : `its build record (${spec.stamp}) could not be read: ${err.message}`;
    return { ...base, state: 'unstamped', why, changed: [] };
  }
  const inputs = stamp && stamp.inputs;
  if (!inputs || typeof inputs !== 'object' || !Object.keys(inputs).length) {
    return { ...base, state: 'unstamped', why: `its build record (${spec.stamp}) lists no sources`, changed: [] };
  }
  const changed = [];
  for (const [rel, hash] of Object.entries(inputs)) {
    let now;
    try { now = sha256File(path.join(root, rel)); } catch { now = null; }
    if (now === null) changed.push(`${rel} (deleted)`);
    else if (now !== hash) changed.push(rel);
  }
  return {
    ...base,
    state: changed.length ? 'stale' : 'fresh',
    builtAt: stamp.builtAt || null,
    changed,
  };
}

function describe(result) {
  if (result.state === 'unstamped') return `${result.name} cannot be confirmed current: ${result.why}.`;
  const list = result.changed.slice(0, 5).join(', ') + (result.changed.length > 5 ? `, and ${result.changed.length - 5} more` : '');
  return `${result.name} is out of date: built ${result.builtAt || 'at an unknown time'}, and ${result.changed.length} source file${result.changed.length === 1 ? ' has' : 's have'} changed since (${list}).`;
}

function defaultRebuild(root, script) {
  // stdout → stderr: some callers print machine-readable output on stdout.
  execFileSync('npm', ['run', script], { cwd: root, stdio: ['ignore', 2, 2] });
}

/**
 * Make sure every named lib is current before the caller `require`s it.
 * Rebuilds what is stale or unstamped (the build is a pure function of the
 * source in this same folder, so that is always the right output) and says so
 * on stderr. Throws — with the command to run — if a rebuild fails or still
 * does not match, so the caller stops instead of loading the wrong code.
 */
function ensureBuildCurrent(root, libs, { log = (m) => console.error(m), rebuild = defaultRebuild } = {}) {
  for (const lib of libs) {
    const first = checkBuildInputs({ root, lib });
    if (first.state === 'fresh') continue;
    log(`${describe(first)} Rebuilding with \`${first.rebuild}\` before going on.`);
    try {
      rebuild(root, GENERATED_LIBS[lib].rebuild);
    } catch (err) {
      throw new Error(`${describe(first)} The automatic rebuild failed (${err.message}). Run \`${first.rebuild}\` in ${root}, fix what it reports, then run this again.`);
    }
    const second = checkBuildInputs({ root, lib });
    if (second.state !== 'fresh') {
      throw new Error(`${describe(second)} A rebuild did not fix it. Run \`${second.rebuild}\` in ${root} and check its output before running this again.`);
    }
    log(`Rebuilt ${second.name}; it now matches the source.`);
  }
}

module.exports = {
  GENERATED_LIBS,
  inputsFromMetafiles,
  recordBuildInputs,
  checkBuildInputs,
  ensureBuildCurrent,
  describeBuildState: describe,
};
