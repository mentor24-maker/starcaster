#!/usr/bin/env node
'use strict';

/**
 * `npm run map` — plain-English picture of the repository.
 *
 * Answers, without jargon: where am I, is my work saved, what is waiting
 * to ship, and what is on the live site. Read-only: this never changes a
 * branch, a file, or anything on GitHub.
 */

const {
  MAIN,
  git,
  lines,
  mergeBase,
  branchInventory,
  classifyBranch,
} = require('./lib/repo_state.cjs');

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
const base = mergeBase();

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

const branches = hasMain ? branchInventory() : [];

out.push(heading('OTHER WORK IN PROGRESS'));
if (!hasMain) {
  out.push(bullet(`No ${MAIN} branch locally — cannot compare.`));
} else if (!branches.length) {
  out.push(bullet('None — every branch has been shipped and cleaned up.'));
} else {
  branches.forEach((branch) => {
    const here = branch.name === current ? '  <- you are here' : '';

    const { state, fresh } = classifyBranch(branch, base);

    if (state === 'empty') {
      const note = branch.name === current
        ? 'nothing committed here yet.'
        : 'already shipped, safe to delete.';
      out.push(bullet(`${branch.name} — ${note}${here}`));
      return;
    }

    if (state === 'shipped') {
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
