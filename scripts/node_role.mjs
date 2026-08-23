#!/usr/bin/env node
/**
 * `npm run node:whoami` / `npm run node:owns -- <job>` — ask which machine
 * this is, and whether it is allowed to run a particular job.
 *
 * The decision itself is NOT here. It lives in lib/nodeRoles.js, which
 * db:refresh, bus-relay and the loop skills all call as well — one
 * implementation, so two callers can never disagree about who owns what.
 * This file is only a way for a human, or a skill written in prose, to ask
 * the same question and get an answer they can act on.
 *
 * Exit codes, because a skill has nothing else to branch on:
 *   0  this machine owns the job — go ahead
 *   3  another machine owns it — a normal outcome, not a failure
 *   1  we could not tell (this machine has no name we recognise), or the job
 *      is not registered at all. Never treat this as "not mine": that is the
 *      difference between a job that is someone else's and a job nobody is
 *      doing.
 */
import nodeRoles from '../lib/nodeRoles.js';

const { KNOWN_NODES, ROLES, checkRole, rolesOwnedBy, thisNode } = nodeRoles;

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const red = (t) => paint('31', t);

function usage(code = 2) {
  console.error('Usage: node scripts/node_role.mjs <command>');
  console.error('  whoami          which machine this is, and what it is allowed to run');
  console.error('  owns <job>      exit 0 if this machine owns the job, 3 if another does,');
  console.error('                  1 if it cannot be determined');
  console.error(`  jobs: ${Object.keys(ROLES).join(', ')}`);
  process.exit(code);
}

const [cmd, target] = process.argv.slice(2);

if (!cmd || cmd === '--help' || cmd === '-h') usage(0);

if (cmd === 'whoami') {
  const node = thisNode();
  const known = KNOWN_NODES.includes(node.name);
  const from = node.source === 'file' ? node.file : `its hostname (${node.raw})`;

  console.log(`${bold('This machine:')} ${known ? green(node.name) : red(node.name || '(no name)')}`);
  console.log(dim(`  declared by ${from}`));

  if (!known) {
    console.log('');
    console.log(yellow('It is not a machine this system knows, so every exclusive job will refuse to run.'));
    console.log('Tell it who it is, once:');
    console.log(`  echo ${KNOWN_NODES[0]} > ${node.file}      ${dim(`# or: ${KNOWN_NODES.slice(1).join(', ')}`)}`);
    process.exit(1);
  }

  const mine = rolesOwnedBy(node.name);
  console.log('');
  for (const role of Object.keys(ROLES)) {
    const owner = ROLES[role].owner;
    console.log(
      mine.includes(role)
        ? `  ${green('OK')}  ${role.padEnd(16)} ${dim('runs here')}`
        : `  ${dim('--')}  ${dim(role.padEnd(16))} ${dim(`runs on ${owner}`)}`,
    );
  }
  console.log('');
  console.log(dim('To move a job between machines, change its owner in lib/nodeRoles.js and commit.'));
  process.exit(0);
}

if (cmd === 'owns') {
  if (!target) usage(2);
  const verdict = checkRole(target);
  if (verdict.owned) {
    console.log(`${green('OK')} ${verdict.message}`);
    process.exit(0);
  }
  // 'other-node' is an ordinary answer; the rest mean we could not tell.
  const quiet = verdict.verdict === 'other-node';
  console.error(`${quiet ? yellow('--') : red('XX')} ${verdict.message}`);
  process.exit(quiet ? 3 : 1);
}

usage(2);
