#!/usr/bin/env node
'use strict';

/**
 * Refuse to ship a branch that carries someone else's commits.
 *
 * A branch started from another branch instead of `main` inherits that
 * branch's unshipped commits. Merging it then puts BOTH sets of work on the
 * live site, and the diff of your own changes never shows it. That happened
 * on 2026-07-21 (PR #14 quietly carried two unrelated commits to main).
 *
 * A "passenger" is any commit that would land on main with this branch but
 * also sits on a different branch — i.e. it belongs to another thread of
 * work that has not been shipped on its own.
 *
 * Runs from the pre-push hook. Bypass with SKIP_PASSENGER_CHECK=1 when you
 * genuinely intend to ship another branch's work along with yours.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const MAIN = 'main';

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

if (process.env.SKIP_PASSENGER_CHECK === '1') {
  console.log('[passengers] Skipped (SKIP_PASSENGER_CHECK=1).');
  process.exit(0);
}

const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], '');
if (!current || current === 'HEAD' || current === MAIN) process.exit(0);

// Prefer origin/main: it is what the branch will actually merge into.
const base = git(['rev-parse', '--verify', '--quiet', `origin/${MAIN}`], '')
  ? `origin/${MAIN}`
  : (git(['rev-parse', '--verify', '--quiet', MAIN], '') ? MAIN : '');
if (!base) process.exit(0);

const commits = lines(git(['rev-list', `${base}..HEAD`], ''));
if (!commits.length) process.exit(0);

const mine = new Set([current, `origin/${current}`, `refs/heads/${current}`]);
const passengers = [];

commits.forEach((sha) => {
  const containing = lines(git(['branch', '--all', '--contains', sha, '--format=%(refname:short)'], ''))
    .map((name) => name.replace(/^remotes\//, ''))
    .filter((name) => !mine.has(name) && name !== MAIN && name !== `origin/${MAIN}` && !name.startsWith('('));
  if (containing.length) {
    passengers.push({
      sha: sha.slice(0, 7),
      subject: git(['log', '-1', '--format=%s', sha], ''),
      branches: Array.from(new Set(containing)),
    });
  }
});

if (!passengers.length) process.exit(0);

const say = (text) => console.error(text);

say('');
say('  STOP — this branch is carrying work that is not yours.');
say('');
say(`  Branch "${current}" was started from another branch instead of ${MAIN}.`);
say('  Shipping it would also put these unrelated changes on the live site:');
say('');
passengers.forEach((item) => {
  say(`    ${item.sha}  ${item.subject}`);
  say(`             belongs to: ${item.branches.join(', ')}`);
});
say('');
say('  What to do: ask Claude to "move my work onto a clean branch off main".');
say('  If you DO want to ship all of it together, run the push again with:');
say('    SKIP_PASSENGER_CHECK=1 git push');
say('');

process.exit(1);
