#!/usr/bin/env node
/**
 * npm run build-start -- --task <id>
 *
 * BEFORE branching: has this ticket been started already — an open pull
 * request, or a half-built worktree on this disk or another machine? The
 * fast-track lane's step 4 (CLAUDE.md). It used to be
 * `npm run clickup -- build-start`, which the tracker's ticket door does not
 * have (SC-877); the reading is scripts/builder/buildStartTicket.js and every
 * decision is still scripts/builder/buildStart.js.
 *
 * Exit codes, so a shell can branch without parsing prose (as `node:owns`):
 *   0  nothing started here or anywhere it could look — go ahead and branch
 *   3  CONTINUE (a `pr:` or `work:` line says where) or WORK ON ANOTHER MACHINE
 *   1  could not tell — read the `next:` line, and do not guess
 *   2  usage
 *
 * The ticket door supplies its own token through Doppler; nothing here sees it.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const buildStart = require('./builder/buildStart.js');
const { readBuildStart, reportLines, exitCode } = require('./builder/buildStartTicket.js');
const pipelineTrackerCall = require('./builder/pipelineTrackerCall.js');
const localWorkReading = require('./builder/localWorkReading.js');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}

const task = arg('task');
if (!task) {
  console.error('Usage: npm run build-start -- --task <id>');
  console.error('  (the `--` is required — without it npm eats --task before this script sees it)');
  console.error('  exit 0 = nothing started, branch; 3 = continue the work it names / it is on another machine;');
  console.error('  1 = could not tell, do not guess');
  process.exit(2);
}

// gh, with --repo ALWAYS (buildStart.prLookupArgs): without it gh answers from
// whichever repo the working directory is, which once gave a `repo:pulse`
// ticket StarCaster's PR of the same number (task 86bbqyyfn).
const lookupPr = (pr) => {
  const out = spawnSync('gh', buildStart.prLookupArgs(pr), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (out.status !== 0) return null; // could not tell — NOT "no PR"
  try { return JSON.parse(out.stdout); } catch { return null; }
};

let decision;
try {
  decision = await readBuildStart({
    taskId: task,
    call: pipelineTrackerCall.trackerCall(),
    lookupPr,
    findLocalWork: (ticket) => localWorkReading.workInProgressFor(ticket, localWorkReading.workProbe()),
    hereId: localWorkReading.thisNodeName(),
  });
} catch (err) {
  // Nothing above should throw; if it does, that is CANNOT TELL, never a go-ahead.
  decision = { action: 'unknown', pr: null, why: `the check itself failed (${err?.message || err}) — do NOT start a branch` };
}

for (const line of reportLines(decision, { task })) console.log(line);
process.exit(exitCode(decision));
