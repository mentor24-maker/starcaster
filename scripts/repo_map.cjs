#!/usr/bin/env node
'use strict';

/**
 * `npm run map` — plain-English picture of the repository.
 *
 * Answers, without jargon: where am I, is my work saved, what is waiting
 * to ship, and what is on the live site. Read-only: this never changes a
 * branch, a file, or anything on GitHub.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const MAIN = 'main';

function git(args, fallback = '') {
  try {
    // stderr ignored: several probes below are expected to fail on refs that
    // do not exist, and their noise would clutter the report.
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function count(args) {
  const value = git(args, '');
  return value ? Number(value) || 0 : 0;
}

/** "3 days ago" style age, or '' when unknown. */
function age(ref) {
  return git(['log', '-1', '--format=%cr', ref], '');
}

function subject(ref) {
  return git(['log', '-1', '--format=%s', ref], '');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const heading = (text) => `\n${text}`;
const bullet = (text) => `  ${text}`;
const indent = (text) => `      ${text}`;

const out = [];

if (!git(['rev-parse', '--is-inside-work-tree'], '')) {
  console.error('Not a git checkout — nothing to map.');
  process.exit(1);
}

// --- Where am I -------------------------------------------------------------

const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
const hasMain = !!git(['rev-parse', '--verify', '--quiet', MAIN], '');
const onMain = current === MAIN;

// Compare against origin/main when we have it — that is what a branch will
// actually merge into, and the local copy of main may be out of date.
const base = git(['rev-parse', '--verify', '--quiet', `origin/${MAIN}`], '')
  ? `origin/${MAIN}`
  : MAIN;

out.push(heading('YOU ARE HERE'));
if (onMain) {
  out.push(bullet(`${MAIN} — this is the live site. Do not edit files here;`));
  out.push(indent('ask me to start a new branch first.'));
} else {
  const ahead = hasMain ? count(['rev-list', '--count', `${base}..HEAD`]) : 0;
  const behind = hasMain ? count(['rev-list', '--count', `HEAD..${base}`]) : 0;
  out.push(bullet(`${current} — a separate copy, safe to work in.`));
  if (ahead) out.push(indent(`${plural(ahead, 'change')} here that the live site does not have yet.`));
  if (!ahead) out.push(indent('No committed changes yet on this branch.'));
  if (behind) out.push(indent(`The live site has moved on by ${plural(behind, 'change')} since you branched.`));
}

// --- Is my work saved -------------------------------------------------------

const dirty = lines(git(['status', '--porcelain'], ''));
out.push(heading('UNSAVED WORK IN THIS FOLDER'));
if (!dirty.length) {
  out.push(bullet('Nothing — every edit is committed.'));
} else {
  out.push(bullet(`${plural(dirty.length, 'file')} edited but not committed:`));
  dirty.slice(0, 12).forEach((line) => out.push(indent(line.replace(/^..\s*/, ''))));
  if (dirty.length > 12) out.push(indent(`...and ${dirty.length - 12} more`));
  out.push(indent('These are NOT backed up anywhere until committed.'));
}

// --- What is waiting to ship ------------------------------------------------

/**
 * Every branch anywhere — on this Mac, on GitHub, or both. A branch that
 * lives only on GitHub is still unshipped work; listing local branches
 * alone hides it.
 */
function branchInventory() {
  const local = lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], ''));
  // Full refnames, not short ones: the short name of refs/remotes/origin/HEAD
  // is plain "origin", which would otherwise show up as a branch.
  const remote = lines(git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/'], ''))
    .map((ref) => ref.replace(/^refs\/remotes\/origin\//, ''))
    .filter((name) => name && name !== 'HEAD');

  const names = Array.from(new Set([...local, ...remote])).filter((name) => name !== MAIN);
  return names.sort().map((name) => {
    const onMac = local.includes(name);
    const onGitHub = remote.includes(name);
    return {
      name,
      onMac,
      onGitHub,
      ref: onMac ? name : `origin/${name}`,
      where: onMac && onGitHub ? 'on your Mac and GitHub' : (onMac ? 'on your Mac only' : 'on GitHub only'),
    };
  });
}

const branches = hasMain ? branchInventory() : [];

out.push(heading('OTHER WORK IN PROGRESS'));
if (!hasMain) {
  out.push(bullet(`No ${MAIN} branch locally — cannot compare.`));
} else if (!branches.length) {
  out.push(bullet('None — every branch has been shipped and cleaned up.'));
} else {
  branches.forEach((branch) => {
    const here = branch.name === current ? '  <- you are here' : '';

    // `git cherry` marks a commit "-" when the same change already exists on
    // main under a different commit id. Those branches look unshipped to
    // `--merged` but hold nothing new.
    const cherry = lines(git(['cherry', base, branch.ref], ''));
    const fresh = cherry.filter((line) => line.startsWith('+'));

    if (!cherry.length) {
      const note = branch.name === current
        ? 'nothing committed here yet.'
        : 'already shipped, safe to delete.';
      out.push(bullet(`${branch.name} — ${note}${here}`));
      return;
    }

    if (!fresh.length) {
      out.push(bullet(`${branch.name} — its work is already live, safe to delete (${branch.where}).${here}`));
      out.push(indent('(Applied to main as a separate commit, so git still calls it unmerged.)'));
      return;
    }

    out.push(bullet(
      `${branch.name} — ${plural(fresh.length, 'unshipped change')}, `
      + `last touched ${age(branch.ref)}, ${branch.where}.${here}`
    ));
    fresh.slice(0, 3).forEach((line) => {
      const sha = line.slice(2).trim();
      out.push(indent(`- ${subject(sha)}`));
    });
    if (fresh.length > 3) out.push(indent(`...and ${fresh.length - 3} more`));
  });
}

// --- What is live -----------------------------------------------------------

if (hasMain) {
  out.push(heading('THE LIVE SITE (main)'));
  out.push(bullet(`Last changed ${age(MAIN)}:`));
  out.push(indent(subject(MAIN)));

  const remoteMain = git(['rev-parse', '--verify', '--quiet', `origin/${MAIN}`], '');
  if (remoteMain) {
    const behindRemote = count(['rev-list', '--count', `${MAIN}..origin/${MAIN}`]);
    if (behindRemote) {
      out.push(bullet(`Your copy is ${plural(behindRemote, 'change')} out of date.`));
      out.push(indent('Ask me to catch it up before starting new work.'));
    }
  }
}

out.push('');
console.log(out.join('\n'));
