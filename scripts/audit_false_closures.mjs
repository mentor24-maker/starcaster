#!/usr/bin/env node
/**
 * `npm run audit:false-closures` — which closed tickets might have been closed
 * on somebody else's pull request?
 *
 * READ-ONLY, AND THAT IS THE POINT. This audit exists because an unattended job
 * repaired the board on a bad inference (ticket 86bbuv66c): until 2026-09-04,
 * `reconcile --live` decided a ticket had shipped by matching ANY GitHub PR URL
 * in ANY of its comments, so a PR merely quoted in discussion could close a
 * ticket that had never been built. It closed 86bbu60ax that way — urgent,
 * claimed, unbuilt, marked shipped, and completely silent.
 *
 * A sweep that then repaired what it found unattended would be the same mistake
 * wearing different clothes. So this prints, and a person or an agent session
 * decides. There is no --apply and there is not going to be one.
 *
 *   npm run audit:false-closures                every closed Loop Queue ticket
 *   npm run audit:false-closures -- --limit N   stop after N (default: all)
 *
 * Exit codes:
 *   0  nothing suspect
 *   3  suspects found — printed, nothing changed
 *   2  the reading could not be completed. NEVER rendered as "nothing found"
 *      (DOCTRINE 3.11)
 *
 * WHAT COUNTS AS A SUSPECT. A closed ticket with NO `PR opened:` trail of its
 * own, whose comments nonetheless quote at least one MERGED pull request. That
 * is the exact shape the old code acted on: no trail to check against, a merged
 * URL sitting in prose, and a status it was allowed to close. A ticket WITH its
 * own trail was decided on its own work and is not listed, even when it also
 * quotes others.
 *
 * It cannot prove any single ticket was wrongly closed — a ticket can be closed
 * by hand for good reasons and happen to quote a PR. It narrows hundreds to a
 * handful somebody can actually read, and names the PR the old rule would have
 * acted on so that checking one takes a click.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { listTasks, getTaskCommentRecords } = require('./lib/clickup.cjs');
const { findPullRequests } = require('./builder/mergeOnComment.js');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';

/** The OLD rule, reproduced here on purpose so the audit can measure it. */
const PR_URL_RE = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g;

const argv = process.argv.slice(2);
const limitAt = argv.indexOf('--limit');
const LIMIT = limitAt >= 0 ? Number(argv[limitAt + 1]) || 0 : 0;

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `[${code}m${text}[0m` : text);

function isClosed(task) {
  const type = String(task?.status?.type || '').toLowerCase();
  if (type) return type === 'closed';
  return String(task?.status?.status || '').toLowerCase() === 'live';
}

function quotedPrs(records) {
  const out = new Map();
  for (const r of records) {
    for (const m of String(r.comment_text || '').matchAll(PR_URL_RE)) {
      out.set(m[0], { url: m[0], owner: m[1], repo: m[2], number: Number(m[3]) });
    }
  }
  return [...out.values()];
}

/** null means "could not read" — which is never the same as "not merged". */
function prState(pr) {
  const out = spawnSync(
    'gh',
    ['pr', 'view', String(pr.number), '--repo', `${pr.owner}/${pr.repo}`, '--json', 'state,title'],
    { encoding: 'utf8' },
  );
  if (out.status !== 0) return null;
  try {
    const json = JSON.parse(out.stdout);
    return { merged: json.state === 'MERGED', title: json.title };
  } catch {
    return null;
  }
}

async function main() {
  let tasks;
  try {
    tasks = await listTasks(LOOP_QUEUE_LIST, { includeClosed: true });
  } catch (err) {
    console.error(`[audit] could not read the Loop Queue — NOTHING was checked: ${err.message}`);
    process.exit(2);
  }

  const closed = tasks.filter(isClosed);
  const scanned = LIMIT > 0 ? closed.slice(0, LIMIT) : closed;
  console.log(`[audit] ${closed.length} closed ticket(s) in the Loop Queue; reading ${scanned.length}.`);

  const suspects = [];
  const cannotTell = [];

  for (const task of scanned) {
    let records;
    try {
      records = await getTaskCommentRecords(task.id);
    } catch (err) {
      cannotTell.push(`${task.id} "${task.name}": comments could not be read — ${err.message}`);
      continue;
    }

    // Decided on its own work: not this audit's business, however much prose
    // it also carries.
    if (findPullRequests(records).length) continue;

    for (const pr of quotedPrs(records)) {
      const state = prState(pr);
      if (state === null) {
        cannotTell.push(`${task.id} "${task.name}": quotes ${pr.url}, but its state could not be read`);
        continue;
      }
      if (!state.merged) continue;
      suspects.push({ task, pr, title: state.title });
      break;
    }
  }

  console.log('');
  if (suspects.length) {
    console.log(paint('33', `${suspects.length} closed ticket(s) with no PR trail of their own, quoting a MERGED PR:`));
    for (const s of suspects) {
      console.log(`  - ${s.task.id} "${s.task.name}"`);
      console.log(`      the old rule would have closed it on ${s.pr.url} — "${s.title}"`);
      console.log(`      https://app.clickup.com/t/${s.task.id}`);
    }
    console.log('');
    console.log('Read each one and decide. Nothing here has been changed, and this audit has no --apply:');
    console.log('the incident it comes from was a job repairing the board on an inference nobody checked.');
  } else {
    console.log(paint('32', 'No closed ticket matches the shape. Nothing to review.'));
  }

  if (cannotTell.length) {
    console.log('');
    console.log(paint('33', `Could NOT check ${cannotTell.length} — not the same as clean:`));
    cannotTell.forEach((l) => console.log(`  ? ${l}`));
    process.exit(2);
  }

  process.exit(suspects.length ? 3 : 0);
}

main().catch((err) => {
  console.error(`[audit] unexpected failure: ${err.stack || err.message}`);
  process.exit(2);
});
