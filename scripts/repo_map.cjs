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
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
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

out.push(heading('YOU ARE HERE'));
if (onMain) {
  out.push(bullet(`${MAIN} — this is the live site. Do not edit files here;`));
  out.push(indent('ask me to start a new branch first.'));
} else {
  const ahead = hasMain ? count(['rev-list', '--count', `${MAIN}..HEAD`]) : 0;
  const behind = hasMain ? count(['rev-list', '--count', `HEAD..${MAIN}`]) : 0;
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

const branches = lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], ''))
  .filter((name) => name !== MAIN);

out.push(heading('OTHER WORK IN PROGRESS'));
if (!hasMain) {
  out.push(bullet(`No ${MAIN} branch locally — cannot compare.`));
} else if (!branches.length) {
  out.push(bullet('None — every branch has been shipped and cleaned up.'));
} else {
  branches.forEach((name) => {
    const ahead = count(['rev-list', '--count', `${MAIN}..${name}`]);
    const here = name === current ? '  <- you are here' : '';
    if (!ahead) {
      const note = name === current
        ? 'nothing committed here yet.'
        : 'already shipped, safe to delete.';
      out.push(bullet(`${name} — ${note}${here}`));
      return;
    }
    out.push(bullet(`${name} — ${plural(ahead, 'unshipped change')}, last touched ${age(name)}.${here}`));
    lines(git(['log', '--format=%s', `${MAIN}..${name}`], '')).slice(0, 3)
      .forEach((line) => out.push(indent(`- ${line}`)));
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
