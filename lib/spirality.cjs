'use strict';

/**
 * Where Spirality's code is on this machine (SC-870).
 *
 * WHY THIS EXISTS
 * StarCaster used to carry its own copy of Spirality's ticket door in `loop/`,
 * copied by hand at a fixed commit. A fix made in Spirality was not in force
 * here until somebody copied it, and on 2026-11-17 that let a build pass hand
 * Dane SQL with no clickable link, eight hours after Spirality had the check
 * (SC-868). Since 2026-11-25 StarCaster's lanes run from Spirality itself
 * (SC-905), so the copy is gone, and every StarCaster file that used to read
 * `loop/...` asks this module where Spirality's own copy of that file is.
 *
 * WHERE IT LOOKS, in order:
 *   1. SPIRALITY_DIR, when set. GitHub's checks set it to the copy of
 *      Spirality they download at the release named in `.spirality-release`.
 *   2. The release StarCaster's lanes ran last, on this machine: Spirality's
 *      runner keeps one folder per release under `<logDir>/releases/` and
 *      writes the name StarCaster ran last into `last-starcaster`. That folder
 *      is never tidied away while it is the one a project ran last, so this
 *      is exactly the code the lanes are running.
 *   3. Spirality's own checkout, `~/WebApps/spirality` (its main, newer than
 *      any release). Said so in `how`, never passed off as the release.
 *   4. Nothing: THROWS, naming what to do. A missing Spirality is never read
 *      as "no tickets" or "no links".
 *
 * `.spirality-release` is the release GitHub's checks download. When the
 * lanes move to a newer release, `npm run spirality:pin` says the pin is
 * behind (on the bus, from the relay's wake), so the two cannot drift apart
 * quietly.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PIN_FILE = '.spirality-release';
const RELEASE_RE = /^release-[1-9]\d*$/;
const SPIRALITY_REPO = 'mentor24-maker/spirality';
/** A file every Spirality this code can use carries. */
const PROBE = path.join('lib', 'clickupTicketLink.js');

const expandHome = (v, home = os.homedir()) => (/^~(\/|$)/.test(v) ? v.replace(/^~/, home) : v);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The release named in `.spirality-release`. THROWS when it is missing or not a release name. */
function pinnedRelease(root = REPO_ROOT) {
  const file = path.join(root, PIN_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    throw new Error(`${file}: could not be read (${err.code || err.message}). It names the Spirality release StarCaster's GitHub checks download.`);
  }
  const name = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
  if (!RELEASE_RE.test(name)) throw new Error(`${file}: "${name}" is not a Spirality release name (release-<n>).`);
  return name;
}

/** `<logDir>/releases`, or SPIRALITY_RELEASES_DIR (Spirality's own override for the same folder). */
function releasesDir(env = process.env, root = REPO_ROOT) {
  if (env.SPIRALITY_RELEASES_DIR) return expandHome(env.SPIRALITY_RELEASES_DIR);
  const config = readJson(path.join(root, 'spirality.project.json')) || {};
  return path.join(expandHome(config.logDir || '~/loop-logs'), 'releases');
}

/** The release StarCaster's lanes ran last on this machine, or '' when none is recorded. */
function laneRelease(env = process.env, root = REPO_ROOT) {
  const config = readJson(path.join(root, 'spirality.project.json')) || {};
  const slug = config.projectSlug || 'starcaster';
  try {
    const name = fs.readFileSync(path.join(releasesDir(env, root), `last-${slug}`), 'utf8').trim();
    return RELEASE_RE.test(name) ? name : '';
  } catch { return ''; }
}

const usable = (dir) => Boolean(dir) && fs.existsSync(path.join(dir, PROBE));

/**
 * `{ dir, how, release }`: the Spirality folder to read, how it was found, and
 * the release it is ('' for a checkout of main). THROWS when there is none.
 */
function locate({ env = process.env, root = REPO_ROOT, home = os.homedir() } = {}) {
  if (env.SPIRALITY_DIR) {
    const dir = path.resolve(expandHome(env.SPIRALITY_DIR, home));
    if (!usable(dir)) throw new Error(`SPIRALITY_DIR names ${dir}, which holds no Spirality (no ${PROBE}).`);
    return { dir, how: 'SPIRALITY_DIR', release: env.SPIRALITY_RELEASE || '' };
  }
  const release = laneRelease(env, root);
  const rdir = releasesDir(env, root);
  if (release && fs.existsSync(path.join(rdir, `.ready-${release}`)) && usable(path.join(rdir, release))) {
    return { dir: path.join(rdir, release), how: `the release StarCaster's lanes run (${release})`, release };
  }
  const checkout = path.join(home, 'WebApps', 'spirality');
  if (usable(checkout)) {
    return { dir: checkout, how: "Spirality's own checkout (its main, not a release: no release folder for StarCaster's lanes on this machine)", release: '' };
  }
  throw new Error([
    "StarCaster could not find Spirality's code on this machine, and needs it (the ticket door and the helpers loop/ used to copy).",
    `Looked for: SPIRALITY_DIR (not set); the release StarCaster's lanes ran last under ${rdir} (${release || 'none recorded'}); a checkout at ${checkout} (none).`,
    `Fix: clone https://github.com/${SPIRALITY_REPO} to ${checkout}, or set SPIRALITY_DIR to a copy of it.`,
  ].join('\n'));
}

let cached;
/** The Spirality folder, found once per process. */
function spiralityDir() {
  if (!cached) cached = locate();
  return cached.dir;
}

/** The absolute path of a file in Spirality's folder (`lib/trackerBus.js`). */
function spiralityPath(...parts) {
  return path.join(spiralityDir(), ...parts);
}

/** require() a Spirality file by its path inside Spirality (`lib/trackerBus.js`). */
function requireSpirality(rel) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(spiralityPath(rel));
}

module.exports = {
  REPO_ROOT,
  PIN_FILE,
  RELEASE_RE,
  SPIRALITY_REPO,
  pinnedRelease,
  releasesDir,
  laneRelease,
  locate,
  spiralityDir,
  spiralityPath,
  requireSpirality,
};
