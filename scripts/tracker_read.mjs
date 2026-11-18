#!/usr/bin/env node
/**
 * tracker_read.mjs — two narrow, READ-ONLY questions for the tracker, each
 * answered in one or two requests (SC-851).
 *
 *   node scripts/tracker_read.mjs named --project <slug> --name "<ticket name>"
 *       every ticket in <slug> with exactly that name, Live included, as a
 *       JSON list of { id, name, status, created, updated }
 *   node scripts/tracker_read.mjs comments --task <id>
 *       that ticket's top-level comments, as a JSON list, oldest first, in the
 *       shape the door's `tickets --json --comments` prints them
 *       ({ id, text, author: { id, name }, at })
 *
 * Run it under Doppler, exactly as the ticket door is run
 * (`node loop/scripts/with_doppler.mjs node scripts/tracker_read.mjs ...`);
 * scripts/lib/trackerDoor.cjs is the one caller, and it does that for you.
 *
 * WHY THIS EXISTS. The pause switch is one ticket found by its NAME, and it
 * rests in Live. The only listing the door offers (`tickets --json
 * --include-closed`) also looks up every ticket's status history, one request
 * per ticket: 851 requests for 849 tickets on 2026-11-17. On the Mini those
 * take two seconds. From the MacBook each one is a fresh connection to
 * mac-mini.local, and the read ran past its three-minute limit, so every
 * `npm run pipeline -- check` there reported PAUSED and `npm run ship` merged
 * nothing. The tracker's own API lists a project's tickets in ONE request and
 * a ticket with its comments in one more, which is all the switch needs.
 *
 * It uses the door's own tracker client and the door's own sign-in rule, so
 * the address and the seat cannot differ from the door's. It never writes:
 * the client is only ever asked to list and to read. And a failed read exits
 * 1 with the reason and prints nothing on stdout, never an empty list —
 * "no switch ticket" is a reading that means RUNNING, so it may only come
 * from a read that actually worked.
 */

import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { loadProjectConfig } from '../loop/lib/projectConfig.mjs';
import { projectSeats } from '../loop/scripts/lib/expectedSecrets.mjs';
import { createApiTracker, trackerTokenEnv } from '../loop/scripts/tracker/apiTracker.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : null;
}

function fail(message, code = 1) {
  console.error(`tracker_read: ${message}`);
  process.exit(code);
}

/** The reason a tracker answer failed, in the door's words. */
function why(out) {
  const status = out?.res?.status ?? 0;
  const err = out?.json?.err || out?.json?.message || String(out?.text || '').slice(0, 160);
  return `HTTP ${status}${err ? `: ${err}` : ''}`;
}

/** Same comparison as pipelinePauseStore's findSwitchByName. */
export function sameName(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/** A listed task (the client's ClickUp shape) as the small row `named` prints. */
export function namedRow(t) {
  const iso = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null);
  return {
    id: String(t.id),
    name: t.name,
    status: String(t.status?.status ?? t.status ?? ''),
    created: iso(t.date_created),
    updated: iso(t.date_updated),
  };
}

/** A read comment (the client's ClickUp shape) as the door's `tickets --comments` prints it. */
export function commentRow(c) {
  return {
    id: String(c.id),
    text: String(c.comment_text ?? ''),
    author: { id: c.user?.id ?? null, name: c.user?.username ?? null },
    at: Number.isFinite(Number(c.date)) ? new Date(Number(c.date)).toISOString() : null,
  };
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== 'named' && cmd !== 'comments') {
    fail('usage: tracker_read.mjs named --project <slug> --name "<name>" | comments --task <id>', 2);
  }

  let project;
  try { project = loadProjectConfig({}); } catch (err) { fail(`the project config is not usable — ${err.message}`); }
  if (project.tracker !== 'api') fail(`this project's tickets are not on the tracker (tracker is ${JSON.stringify(project.tracker)})`, 2);
  let tokenEnv;
  try { tokenEnv = trackerTokenEnv(process.env, projectSeats(project)); } catch (err) { fail(err.message); }
  const tracker = createApiTracker({
    token: process.env[tokenEnv],
    baseUrl: project.trackerApiUrl,
    project: project.projectSlug,
    listId: project.loopQueueListId,
    timeoutMs: process.env.TRACKER_HTTP_TIMEOUT_MS,
  });

  if (cmd === 'named') {
    const slug = arg('project');
    const name = arg('name');
    if (!slug || !name) fail('named needs --project <slug> and --name "<name>"', 2);
    const out = await tracker.listTasksPage(slug, 0, { includeClosed: true });
    if (!out.res?.ok || !Array.isArray(out.json?.tasks)) fail(`listing the ${slug} tickets failed: ${why(out)}`);
    console.log(JSON.stringify(out.json.tasks.filter((t) => sameName(t.name, name)).map(namedRow)));
  } else {
    const task = arg('task');
    if (!task) fail('comments needs --task <id>', 2);
    const { paged, bad } = await tracker.listComments(task);
    if (!paged.complete) fail(`reading the comments on ${task} failed: ${why(bad)}`);
    // The client answers newest first; the door's JSON is oldest first.
    console.log(JSON.stringify([...paged.comments].reverse().map(commentRow)));
  }
  tracker.reportLimits();
}

// Run only as a command, so a test can import the pure helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  main().catch((err) => fail(String(err?.stack || err)));
}
