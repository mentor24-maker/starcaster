#!/usr/bin/env node
'use strict';

/**
 * `npm run thread <topic>` — start a new piece of work, correctly, in one step.
 *
 * Every part of this used to be done by hand, and each one had a failure that
 * cost real time:
 *   - branching off a stale local main → the branch starts behind, and needs a
 *     rebase later (which is where the asset-stamp conflicts come from)
 *   - forgetting `npm ci` and pointing node_modules at another checkout → the
 *     bundles hash differently and CI rejects the ?v= pins (PR #149/#150)
 *   - never cleaning up afterwards → 41 local branches and 10 worktrees
 *
 * So: tidy first, branch off CURRENT origin/main, real install, every time.
 *
 *   npm run thread my-topic
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { git } = require('./lib/repo_state.cjs');

const topic = process.argv[2];

if (!topic || topic.startsWith('-')) {
  console.error('\nUsage: npm run thread <topic>\n');
  console.error('  <topic> names the work, in lowercase-with-dashes.');
  console.error('  Example: npm run thread table-cell-editor\n');
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(topic)) {
  console.error(`\n"${topic}" will not work as a name.`);
  console.error('Use lowercase letters, numbers and dashes only — e.g. slideshow-captions.\n');
  process.exit(1);
}

// The main checkout, wherever this was run from: .git/ lives at its root.
const commonDir = git(['rev-parse', '--git-common-dir'], '');
if (!commonDir) {
  console.error('Not a git checkout — nothing to do.');
  process.exit(1);
}
const mainRoot = path.dirname(path.resolve(commonDir));
const dest = path.join(mainRoot, '.claude', 'worktrees', topic);

if (fs.existsSync(dest)) {
  console.error(`\nThere is already a folder for "${topic}":\n  ${dest}\n`);
  console.error('Either work in it, or pick a different name.\n');
  process.exit(1);
}

if (git(['rev-parse', '--verify', '--quiet', topic], '')) {
  console.error(`\nA branch named "${topic}" already exists.`);
  console.error('Pick a different name, or ask me to clean up the old one first.\n');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { cwd: mainRoot, stdio: 'inherit', ...opts });
}

console.log('\n[thread] Clearing out anything already finished…');
try {
  run('node', [path.join(mainRoot, 'scripts', 'repo_tidy.cjs'), '--quiet']);
} catch {
  console.log('[thread] (cleanup skipped — carrying on)');
}

console.log('[thread] Fetching the latest from GitHub…');
run('git', ['fetch', 'origin', '--prune']);

const base = git(['rev-parse', '--verify', '--quiet', 'origin/main'], '') ? 'origin/main' : 'main';
console.log(`[thread] Creating the folder, branched off ${base}…`);
run('git', ['worktree', 'add', dest, '-b', topic, base]);

console.log('[thread] Installing dependencies (about a minute, and its own copy on purpose)…');
run('npm', ['ci'], { cwd: dest, stdio: ['ignore', 'ignore', 'inherit'] });

// AFTER the install, never before. Creating the worktree fires post-checkout,
// which tries to build while this folder still has no dependencies — esbuild
// would reach up to the parent checkout and write bundles referencing
// ../../../node_modules. build_pinned_assets now refuses that, so the folder
// simply has no artifacts until here.
// The FULL build, not just the pinned assets.
//
// build_pinned_assets alone produces builder-bundle.js and styles.css but not
// app-shell.html, which IS the admin app — so a fresh worktree could pass every
// test and still serve a 404 to a browser. On 2026-08-15 that swallowed an hour
// twice: `npm run check:panels` reported "No panels carrying `.is-lattice` were
// found", which reads as a broken check rather than a folder that was never
// built. lib/builder/template.js was missing for the same reason, and took the
// server-side test suite down with it.
//
// Costs about half a minute more than the old step, once, and makes the folder
// something you can actually run.
console.log('[thread] Building this folder’s own bundles…');
run('npm', ['run', 'build'], { cwd: dest, stdio: ['ignore', 'ignore', 'inherit'] });

console.log(`
[thread] Ready.

  Folder:  ${dest}
  Branch:  ${topic}   (branched off ${base} just now, so it is current)

  Open a session in that folder and work there. When the work has merged,
  \`npm run tidy\` removes the folder and the branch — or the next
  \`npm run thread\` does it for you.
`);
