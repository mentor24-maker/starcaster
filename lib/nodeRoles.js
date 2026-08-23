'use strict';

/**
 * Which machine is allowed to run which job — the whole answer, in one place.
 *
 * WHY THIS EXISTS (NODES Slice C, principle P3)
 * Slices A and B make this system able to run on more than one machine. That
 * is only an improvement if it is also SAFE to, and three of our jobs are not
 * safe to run twice at once. Each breaks differently:
 *
 *   bus-relay   — dedup correctness. Two machines can both read "this comment
 *                 has not been relayed yet" in the same minute and both post
 *                 it before either writes the marker back. The operator sees
 *                 his own message twice on the bus.
 *   db-refresh  — one shared physical budget. Six runs in a single day
 *                 exhausted Supabase's disk IO and took every client site
 *                 down for two and a half hours on 2026-08-17
 *                 (docs/DOCTRINE.md §1.5). It does not matter which machine
 *                 spent it; there is only one meter.
 *   loop-build  — claim races. Claiming a ticket is check-then-act (a GET, a
 *                 comparison, a PUT) because ClickUp has no compare-and-set.
 *                 That is sound with exactly one claimant and unsound with
 *                 two, so "exactly one claimant" has to be guaranteed
 *                 somewhere. It is guaranteed here.
 *
 * Until now all three were enforced by a person remembering a rule before
 * typing a command. That works right up until the day it doesn't, and the day
 * it doesn't is the day there are two machines.
 *
 * ONE IMPLEMENTATION, ON PURPOSE
 * Every exclusive job asks THIS module and nothing else. The same reasoning
 * put `db:use`, the admin banner and the dev-server guard behind
 * lib/environmentBanner.js: two copies of a safety rule are two rules, and
 * they disagree quietly. If you are adding a fourth exclusive job, add a row
 * to ROLES below and call `checkRole()` — do not write a second check.
 *
 * WHY THE TABLE LIVES IN THIS REPO
 * It was a real question (NODES §9 Q2) and the operator answered it on
 * 2026-08-22: the registry lives in starcaster, referenced from canon, rather
 * than in the vault. A guard that read the vault at runtime would couple two
 * repositories on the hot path of every ops command, which is exactly the
 * coupling the ecosystem work has avoided everywhere else. Canon describes
 * the arrangement; this file IS the arrangement.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The file that names this machine. A short name, one line, nothing else:
 *
 *   echo mac-mini > ~/.alphire-node
 *
 * It is not in the repo and never will be — a committed file that names a
 * machine is correct on exactly one machine (NODES principle P1, Slice A).
 */
const IDENTITY_FILENAME = '.alphire-node';

/** A role that genuinely may run anywhere. Not a wildcard for "unsure". */
const ANY = 'any';

/**
 * The machines this system knows about. A name outside this list is not a
 * "different node", it is a machine that has not been told who it is — and
 * those two cases must never be treated the same way. See `checkRole()`.
 */
const KNOWN_NODES = ['macbook-pro', 'mac-mini'];

/**
 * THE REGISTRY — role -> the one machine that runs it.
 *
 * Ratified on the bus 2026-08-20 as the "review-first" cutover sequence: the
 * Mac Mini's first job is draining the review lane (the measured bottleneck),
 * and everything else moves over later, one row at a time.
 *
 * To hand a job to another machine, change its `owner` here and commit. That
 * is the entire cutover procedure, and it is deliberately a reviewable commit
 * rather than a setting someone can flip on one machine at 2am.
 */
const ROLES = {
  'bus-relay': {
    owner: 'macbook-pro',
    why: 'Two relays can both decide a comment is unrelayed and post it twice.',
  },
  'db-refresh': {
    owner: 'macbook-pro',
    why: "Supabase disk IO is one budget for the whole company; spending it twice took every client site down on 2026-08-17.",
  },
  'loop-build': {
    owner: 'mac-mini',
    why: 'Claiming a ticket is check-then-act, which is only safe with a single claimant. '
      + 'The Mini owns it because the Mini is the machine that is awake: the laptop closes, '
      + 'and a build loop on a sleeping machine is a queue that stops moving overnight with '
      + 'nothing to show for it.',
  },
  'loop-review': {
    owner: 'mac-mini',
    why: 'Same claim race as loop-build. The Mini runs both loops (2026-08-22): it is the '
      + 'always-on machine, and review is the lane that backs up.',
  },
  'pulse-pipelines': {
    owner: 'macbook-pro',
    why: 'Scheduled pipelines double-post if two machines both hold the schedule.',
  },
};

/**
 * Reduce anything a machine or a person might write to a comparable short
 * name. `Danes-MacBook-Pro.local` and `mac mini` both become something this
 * module can match, and a trailing newline never costs an hour.
 */
function normalizeNodeName(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The path to the identity file, for messages and for tests. */
function identityFilePath(homedir) {
  return path.join(homedir || os.homedir(), IDENTITY_FILENAME);
}

/**
 * First meaningful line of the identity file, or null if there isn't one.
 * Blank lines and `#` comments are skipped so the file can explain itself.
 */
function readIdentityFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    return line;
  }
  return null;
}

/**
 * Who is this machine?
 *
 * The file wins over the hostname, always. A hostname is inferred, and it
 * changes the moment somebody renames a Mac in System Settings — at which
 * point every guard in this file would quietly stop recognising the machine.
 * The file is a statement; the hostname is a guess we accept when there is
 * no statement.
 *
 * Both `identityFile` and `hostname` can be supplied, which is how the tests
 * drive this without a real home folder.
 */
function thisNode({ identityFile, hostname, homedir } = {}) {
  const file = identityFile || identityFilePath(homedir);
  const declared = readIdentityFile(file);
  if (declared) {
    return { name: normalizeNodeName(declared), source: 'file', file, raw: declared };
  }
  const host = hostname === undefined ? os.hostname() : hostname;
  return { name: normalizeNodeName(host), source: 'hostname', file, raw: String(host || '') };
}

/** True if this system has heard of a machine by that name. */
function isKnownNode(name) {
  return KNOWN_NODES.includes(normalizeNodeName(name));
}

/**
 * Who owns a role, or null if the role is not in the registry at all.
 *
 * `roles` exists so the tests can drive this table's every branch — including
 * the `any` owner, which nothing in the real registry currently uses. An
 * untested branch is a branch that is broken the first time somebody needs it.
 */
function roleOwner(role, roles = ROLES) {
  const entry = roles[String(role || '').trim().toLowerCase()];
  return entry ? entry.owner : null;
}

/** Every role this machine is allowed to run, `any` roles included. */
function rolesOwnedBy(nodeName) {
  const name = normalizeNodeName(nodeName);
  return Object.keys(ROLES).filter((role) => {
    const owner = ROLES[role].owner;
    return owner === ANY || normalizeNodeName(owner) === name;
  });
}

/**
 * THE GUARD. Every exclusive job calls this before doing anything.
 *
 * It returns a verdict rather than exiting, because the right reaction is not
 * the same everywhere and each caller knows its own:
 *
 *   'owned'        run it.
 *   'other-node'   a NORMAL outcome, not an error — this job belongs to a
 *                  machine that is not this one. A background poller should
 *                  say so and exit 0; a command a person just typed should
 *                  refuse out loud, because they are standing there waiting.
 *   'unidentified' we do not know which machine this is, so we cannot know
 *                  whether it is the owner. This must NEVER be treated as
 *                  'other-node'. Silently skipping on an unrecognised machine
 *                  is how a relay stops relaying for a week without anyone
 *                  noticing — the failure has to be loud (DOCTRINE §3.11:
 *                  say what you could not check).
 *   'unknown-role' a caller asked about a role nobody registered. That is a
 *                  bug in the caller, and it fails loudly for the same reason.
 *
 * `message` is written for the operator, not for a log parser: it says what
 * happened, why, and what to type next.
 */
function checkRole(role, options = {}) {
  const key = String(role || '').trim().toLowerCase();
  const roles = options.roles || ROLES;
  const node = options.node || thisNode(options);
  const owner = roleOwner(key, roles);
  const base = { role: key, node, owner };

  if (!owner) {
    return {
      ...base,
      verdict: 'unknown-role',
      owned: false,
      message:
        `No machine is registered to run "${role}", so nothing may run it.\n` +
        `Known jobs: ${Object.keys(roles).join(', ')}.\n` +
        'Add it to the table in lib/nodeRoles.js if it is a real job.',
    };
  }

  if (owner === ANY) {
    return { ...base, verdict: 'owned', owned: true, message: `"${key}" may run on any machine.` };
  }

  if (!isKnownNode(node.name)) {
    const seen = node.name || '(nothing)';
    return {
      ...base,
      verdict: 'unidentified',
      owned: false,
      message:
        `This machine has not been told which node it is, so it cannot know whether it is allowed to run "${key}".\n` +
        `It called itself "${seen}" (from ${node.source === 'file' ? node.file : 'its hostname'}), which is not a machine this system knows.\n` +
        `Known machines: ${KNOWN_NODES.join(', ')}.\n` +
        `Fix it once, on this machine, and every job stops asking:\n` +
        `  echo ${KNOWN_NODES[0]} > ${node.file}      # or ${KNOWN_NODES.slice(1).join(', ')}`,
    };
  }

  if (normalizeNodeName(owner) === node.name) {
    return {
      ...base,
      verdict: 'owned',
      owned: true,
      message: `This machine (${node.name}) owns "${key}".`,
    };
  }

  return {
    ...base,
    verdict: 'other-node',
    owned: false,
    message:
      `"${key}" is owned by ${owner}. This machine is ${node.name}, so it did nothing.\n` +
      `Why only one machine: ${roles[key].why}\n` +
      `To move the job here, change its owner in lib/nodeRoles.js and commit.`,
  };
}

module.exports = {
  ANY,
  IDENTITY_FILENAME,
  KNOWN_NODES,
  ROLES,
  checkRole,
  identityFilePath,
  isKnownNode,
  normalizeNodeName,
  readIdentityFile,
  roleOwner,
  rolesOwnedBy,
  thisNode,
};
