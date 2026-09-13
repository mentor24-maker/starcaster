#!/usr/bin/env node
/**
 * `npm run heartbeat` — is anything that should be running quietly not?
 *
 * The decisions live in lib/nodeHeartbeat.js (pure, no network, fully tested).
 * This file is the IO: the local stamp, the shared roll call on ClickUp, and
 * the bus post. See that module's header for why the two clocks differ, and
 * why the watchdog has to be able to run from the machine that does NOT own
 * the job it is watching.
 *
 *   npm run heartbeat                       read the roll call, print it, post nothing
 *   npm run heartbeat -- --check            the same, and post to the bus if a job is quiet
 *   npm run heartbeat -- --beat --role X    record a successful run of X (jobs call this)
 *   npm run heartbeat -- --stale-check      the LOCAL recency alarm, read-only, no ClickUp read
 *   npm run heartbeat -- --stale-check --check   the same, and post to the bus
 *   npm run heartbeat -- --push-owned       relay this machine's local stamps onto the shared row
 *
 * WHY --stale-check IS A SEPARATE MODE AND NOT PART OF --check
 * The roll call is a network read, and it is the surface that answers "is the
 * other machine dead?". The recency alarm reads THIS machine's own stamps and
 * answers "is this machine awake and not working?" — the 16-hour failure of
 * 2026-09-03. Folding it into --check would make the second question depend on
 * the first one's network call succeeding, so a ClickUp outage would silence
 * an alarm that needs no ClickUp at all. Two questions, two failure domains,
 * two commands. See lib/nodeHeartbeat.js -> recencyReport.
 *
 * Exit codes, because scripts branch on this:
 *   0  read cleanly, nothing overdue
 *   1  something is overdue
 *   2  could not tell — never rendered as "all quiet" (docs/DOCTRINE.md 3.11)
 *
 * NOTHING HERE MAY FAIL THE JOB THAT CALLS IT. `--beat` reports its problems
 * and exits 0: a relay that worked perfectly must not be recorded as a failure
 * because its own bookkeeping could not reach ClickUp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const clickup = require('./lib/clickup.cjs');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const ROLL_CALL_TASK = process.env.CLICKUP_ROLL_CALL_TASK || '';
// The status the roll call rests in: outside every claim query and every
// bus-relay watch, for the same reason the pause switch sits there — a ticket
// that could be picked up as work would be picked up as work.
const ROLL_CALL_STATUS = process.env.CLICKUP_ROLL_CALL_STATUS || 'Live';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const NOW = Date.now();
const NODE = nodeRoles.thisNode();

// --- stamps -----------------------------------------------------------------
// Suppression lives on the machine doing the posting, not on the shared
// surface. That is deliberate: if both machines are awake and both see the
// same silence, two posts is a far better failure than a shared stamp one of
// them cannot write turning into no post at all.

function stampPath(name) {
  return path.join(heartbeat.heartbeatDir(), `${name}.stamp`);
}

function readStamp(name) {
  try {
    return fs.readFileSync(stampPath(name), 'utf8').trim();
  } catch {
    return '';
  }
}

function writeStamp(name, at) {
  try {
    fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
    fs.writeFileSync(stampPath(name), `${at}\n`);
    return true;
  } catch {
    return false;
  }
}

function clearStamp(name) {
  try { fs.unlinkSync(stampPath(name)); } catch { /* nothing to clear is the normal case */ }
}

/**
 * CLOSING AN ALARM — the counterpart to raising one, and for four days the only
 * half of this feature that did not exist for the two Pulse roles
 * (task 86bbw9nbj, round 1 send-back).
 *
 * Every clear used to live inside `--beat`, which a job calls on its own
 * successful run. `channel-steward` and `librarian-sweep` never call it: their
 * runner is in the pulse repo and writes only the local stamp, on purpose. So
 * the two roles this whole slice exists to instrument were the only two that
 * could go quiet, alarm, recover — and stay alarmed for ever, with nobody told
 * they were back. Pulse's own history is 33 hours dark and 820 failed runs over
 * twelve days; every one of those is a recovery event.
 *
 * Two acts, deliberately not one. Clearing the three suppression stamps is
 * bookkeeping and always happens. Posting is the only good news this system
 * ever sends, and it happens only where `stale-<role>` was set — that stamp
 * exists exactly when a quiet report reached the bus, so a healthy job that was
 * never reported quiet posts nothing here, ever.
 *
 * Returns one entry per role it SPOKE about, each carrying whether the words
 * actually got out — a refused post is a cannot-do, not a clear, and rendering
 * it as one is how "nobody was told" becomes a green line. It never throws and
 * never fails its caller: the stamps are already cleared by then, so a refused
 * post costs the words and not the state, and failing a job that just succeeded
 * would be far worse.
 */
function closeAlarms(recovered) {
  const said = [];
  const plan = heartbeat.alarmCloseoutPlan({
    fresh: recovered.map((r) => ({ role: r.role })),
    quietSince: Object.fromEntries(recovered.map((r) => [r.role, r.quietSince || ''])),
  });

  // Both of these are also set by scripts/report_job_failure.mjs and by the
  // shared-row watchdog, so a fault that is fixed and later returns is
  // announced immediately rather than waiting out the previous fault's window.
  for (const role of plan.clear) {
    clearStamp(`quiet-${role}`);
    clearStamp(`failed-${role}`);
    clearStamp(`stale-${role}`);
  }

  for (const item of plan.announce) {
    try {
      clickup.postBusMessage(BUS_CHANNEL, heartbeat.renderRecoveredPost({
        role: item.role, node: NODE.name || 'an unnamed machine', quietSince: item.quietSince, now: NOW,
      }));
      said.push({ role: item.role, told: true, text: `${item.role} was reported quiet at ${item.quietSince} — posted that it is beating again.` });
    } catch (err) {
      said.push({ role: item.role, told: false, text: `${item.role} is beating again and its alarm is closed, but nobody could be told (${String(err && err.message).slice(0, 200)}).` });
    }
  }
  return said;
}

// --- the roll call on ClickUp -----------------------------------------------

/**
 * Find the roll call. Its identity is its NAME; `CLICKUP_ROLL_CALL_TASK` is a
 * shortcut that must never become the definition — a shortcut pointing at a
 * deleted task has to fall back to the name, not report the roll call gone.
 *
 * Never throws. Three answers: found, confirmed-absent, unreadable.
 */
async function findRollCall() {
  if (ROLL_CALL_TASK) {
    try {
      const out = await clickup.call('GET', `/api/v2/task/${ROLL_CALL_TASK}`);
      if (out.ok && out.json && out.json.id) return { readable: true, found: true, task: out.json };
      // 401 covers both a bad token and a task this token cannot see, deleted
      // ones included — so fall through to the name rather than conclude.
    } catch { /* fall through to the list walk */ }
  }
  let tasks;
  try {
    tasks = await clickup.listTasks(LOOP_QUEUE_LIST, { includeClosed: true });
  } catch (err) {
    return { readable: false, found: false, why: `reading the Loop Queue: ${String(err && err.message).slice(0, 200)}` };
  }
  const task = tasks.find(
    (t) => String(t.name || '').trim().toLowerCase() === heartbeat.ROLL_CALL_TASK_NAME.toLowerCase(),
  );
  return task ? { readable: true, found: true, task } : { readable: true, found: false };
}

/**
 * The description ClickUp actually holds.
 *
 * Both fields are consulted and the one with CONTENT wins, because the API
 * does not consistently populate the same one: a task written with
 * `markdown_description` reads back with that field empty and the text under
 * `description` (driven live, 2026-08-31). Preferring one blindly would hand
 * the parser an empty string on a task whose roll call is entirely intact.
 */
function descriptionOf(task) {
  const md = String((task && task.markdown_description) || '');
  const plain = String((task && task.description) || '');
  return md.trim() ? md : plain;
}

async function createRollCall() {
  const out = await clickup.call('POST', `/api/v2/list/${LOOP_QUEUE_LIST}/task`, {
    name: heartbeat.ROLL_CALL_TASK_NAME,
    status: ROLL_CALL_STATUS,
    markdown_description: heartbeat.renderRollCall([], { now: NOW }),
  });
  if (!out.ok) {
    return {
      ok: false,
      why: `HTTP ${out.status} ${String((out.json && out.json.err) || out.text || '').slice(0, 200)}`
        + `\n  If the failure names the status, this list has no "${ROLL_CALL_STATUS}" status — set`
        + '\n  CLICKUP_ROLL_CALL_STATUS to one the Loop Queue has that no loop claims from.',
    };
  }
  return { ok: true, task: out.json };
}

// --- reading ----------------------------------------------------------------

async function loadReport() {
  const found = await findRollCall();
  if (!found.readable) return { readable: false, why: found.why, task: null, rows: [] };
  if (!found.found) {
    // A CONFIRMED absence. Every role reads as "no beat ever recorded", which
    // is exactly right on a system where nothing has beaten yet, and is the
    // state a fresh checkout starts in.
    return { readable: true, task: null, rows: [], report: heartbeat.rollCallReport({ rows: [], now: NOW }) };
  }
  const parsed = heartbeat.parseRollCall(descriptionOf(found.task));
  if (!parsed.parsed) {
    return {
      readable: false,
      why: `${heartbeat.ROLL_CALL_TASK_NAME} (${found.task.url}): ${parsed.why}`,
      task: found.task,
      rows: [],
    };
  }
  return {
    readable: true,
    task: found.task,
    rows: parsed.rows,
    report: heartbeat.rollCallReport({ rows: parsed.rows, now: NOW }),
  };
}

function printReport(state) {
  const out = [];
  out.push('', bold('NODE ROLL CALL — when did each scheduled job last succeed?'), '');

  if (!state.readable) {
    out.push(`  ${yellow('????')}  Cannot tell.`);
    out.push(`        ${dim(`cannot tell: ${state.why}`)}`);
    out.push(`        ${dim('An unreadable roll call is NOT an all-clear. Nothing has been posted.')}`);
    out.push('');
    console.log(out.join('\n'));
    return 2;
  }

  const { beating, overdue, notReporting } = state.report;

  for (const b of beating) {
    out.push(`  ${green('BEAT')}  ${b.role} on ${b.owner} — last succeeded ${heartbeat.ageText(b.ageMs)}.`);
    out.push(`        ${dim(b.at)}`);
  }
  for (const o of overdue) {
    out.push(`  ${red('QUIET')} ${o.role} on ${o.owner} — ${o.reason}.`);
    // Two different failures, two different sentences. Saying "a job that stops
    // firing" about a role that has never beaten is a wrong fact in a report
    // somebody acts on — it sends them looking for a dead schedule when the
    // answer may be that the emitter is newer than the job's own cadence.
    out.push(o.neverBeaten
      ? `        ${dim('Never beaten — either nothing is installed to beat from, or its emitter is newer than the job\'s last run.')}`
      : `        ${dim('A job that stops firing writes nothing anywhere. This is that.')}`);
  }
  for (const n of notReporting) {
    out.push(`  ${yellow('????')}  ${n.role} on ${n.owner} — not reporting.`);
    out.push(`        ${dim(`cannot tell: ${n.why}`)}`);
  }

  if (state.task) out.push('', dim(`  Roll call: ${state.task.url}`));
  else out.push('', dim('  No roll-call ticket exists yet — the first beat creates it.'));

  out.push('');
  if (overdue.length === 0 && beating.length > 0) {
    out.push(bold(green('Everything that reports, reports.')));
  } else if (overdue.length === 0) {
    out.push(bold(yellow('Nothing is overdue, and nothing is reporting either.')));
    out.push(dim('Read the ???? lines. A system with no beat emitters is not a healthy system.'));
  } else {
    out.push(bold(red(`${overdue.length} job${overdue.length === 1 ? ' has' : 's have'} gone quiet.`)));
  }
  out.push('');
  console.log(out.join('\n'));
  return overdue.length > 0 ? 1 : 0;
}

// --- recording a beat -------------------------------------------------------

async function doBeat(role) {
  if (!role) {
    console.error(`--beat needs --role <role>. Known roles: ${Object.keys(nodeRoles.ROLES).join(', ')}`);
    return 0;
  }
  const at = new Date(NOW).toISOString();

  // 1. The local stamp, every time. Free, offline, and the precise answer to
  //    "when did this last work on this machine".
  const local = heartbeat.recordBeat({ role, node: NODE.name, at });
  if (!local.ok) console.error(`heartbeat: could not write the local beat (${local.why}) — carrying on.`);
  else console.error(`heartbeat: ${role} beat recorded locally at ${at}.`);

  // A successful run closes its own alarms and says so. One helper, called from
  // here and from the recency check, so exactly one place knows where those
  // stamps live (NODES P1) — and so the roles that never call this line get the
  // same duty performed for them.
  for (const said of closeAlarms([{ role, quietSince: readStamp(`stale-${role}`) }])) {
    console.error(`heartbeat: ${said.text}`);
  }

  // 2. The shared row, at most once a day. This is the throttle that keeps the
  //    feature from being channel noise x365 — and it is also the resolution
  //    the requirement asks for: a day-long absence, not a ten-minute one.
  if (!heartbeat.dueAgain({ lastAt: readStamp(`push-${role}`), now: NOW, everyMs: heartbeat.PUSH_EVERY_MS })) {
    console.error('heartbeat: shared row already pushed within the last day — not pushing again.');
    return 0;
  }

  const found = await findRollCall();
  if (!found.readable) {
    // Loud, and exit 0. The job itself succeeded; failing it here would turn a
    // ClickUp hiccup into a false failure alert, which is the alarm fatigue
    // this slice exists to avoid, wearing a different hat.
    console.error(`heartbeat: could not reach the roll call (${found.why}) — the local beat stands. Not failing the job.`);
    return 0;
  }

  let task = found.task;
  if (!found.found) {
    console.error(`heartbeat: no "${heartbeat.ROLL_CALL_TASK_NAME}" ticket yet — creating it.`);
    const made = await createRollCall();
    if (!made.ok) {
      console.error(`heartbeat: could not create it (${made.why}). The local beat stands.`);
      return 0;
    }
    task = made.task;
  }

  // Read-modify-write. Two machines share this description, so the merge only
  // ever advances a row and never moves one backwards; a lost update costs at
  // most one day's resolution on the other machine's row, and its next push
  // corrects it.
  const fresh = await clickup.call('GET', `/api/v2/task/${task.id}`);
  const existing = fresh.ok ? heartbeat.parseRollCall(descriptionOf(fresh.json)) : { parsed: false, rows: [] };
  const rows = heartbeat.mergeRollCall(existing.parsed ? existing.rows : [], [{ node: NODE.name, role, at }]);
  if (!existing.parsed) {
    console.error('heartbeat: the existing roll-call block could not be read — rewriting it from this beat alone.');
  }

  const wrote = await clickup.call('PUT', `/api/v2/task/${task.id}`, {
    markdown_description: heartbeat.renderRollCall(rows, { now: NOW }),
  });
  if (!wrote.ok) {
    console.error(`heartbeat: could not write the roll call (HTTP ${wrote.status}). The local beat stands.`);
    return 0;
  }
  writeStamp(`push-${role}`, at);
  console.error(`heartbeat: ${role} pushed to the roll call (${task.url}).`);
  return 0;
}

// --- the recency alarm (local, no ClickUp read) ------------------------------

/**
 * "Is a job this machine owns not beating any more?"
 *
 * Only roles this machine OWNS are considered, and that is load-bearing rather
 * than tidy: the local stamps only exist where the job runs, so asking about
 * another machine's role here would read a missing file and either invent a
 * silence or teach the check to ignore missing files — and ignoring missing
 * files is how a real silence gets swallowed.
 *
 * The machine-is-switched-off case is NOT this check's job and cannot be: a
 * dead machine runs nothing, including this. That case belongs to the roll
 * call, which is read by whichever machine is awake, at day resolution.
 */
async function doStaleCheck({ post }) {
  const out = [];
  out.push('', bold('LOCAL RECENCY — is a job this machine owns still beating?'), '');

  if (!nodeRoles.isKnownNode(NODE.name)) {
    out.push(`  ${yellow('????')}  Cannot tell.`);
    out.push(`        ${dim(`This machine calls itself "${NODE.name || '(nothing)'}", which is not a machine this system knows.`)}`);
    out.push(`        ${dim('Without an identity there is no way to know which jobs it should be running.')}`);
    out.push(`        ${dim(`Fix it once:  echo ${nodeRoles.KNOWN_NODES[0]} > ${NODE.file}`)}`);
    out.push('');
    console.log(out.join('\n'));
    return 2;
  }

  const owned = nodeRoles.rolesOwnedBy(NODE.name).filter((role) => heartbeat.BEAT_EMITTERS[role]);
  const entries = owned.map((role) => ({
    role,
    owner: nodeRoles.ROLES[role] && nodeRoles.ROLES[role].owner,
    beat: heartbeat.readBeat({ role }),
  }));
  const report = heartbeat.recencyReport({ entries, now: NOW });

  for (const f of report.fresh) {
    out.push(`  ${green('BEAT')}  ${f.role} — ${f.beatMeans === 'liveness' ? 'last ran' : 'last succeeded'} `
      + `${heartbeat.ageText(f.ageMs)} (quiet after ${heartbeat.ageText(f.thresholdMs).replace(' ago', '')}).`);
  }
  for (const q of report.quiet) {
    out.push(`  ${red('QUIET')} ${q.role} on ${NODE.name} — ${q.reason}.`);
    out.push(`        ${dim(`threshold ${heartbeat.ageText(q.thresholdMs).replace(' ago', '')}; last beat ${q.at}`)}`);
  }
  for (const u of report.unknown) {
    out.push(`  ${yellow('????')}  ${u.role} — cannot judge.`);
    out.push(`        ${dim(`cannot tell: ${u.why}`)}`);
  }
  if (entries.length === 0) {
    out.push(`  ${yellow('????')}  This machine owns no job that records a beat, so there is nothing to measure here.`);
  }

  // THE ALARM CLOSES ITSELF HERE, not only in `--beat` (task 86bbw9nbj, round 1
  // send-back). This check is where the silence is judged and where the quiet
  // post goes out, so it is where the recovery belongs — and it is the ONLY
  // path that reaches the two Pulse roles, whose runner lives in another repo
  // and never calls `--beat` at all. Gated on `post` because a read-only
  // `--stale-check` must not mutate stamps: this whole block is the same write
  // the quiet half below performs, in the opposite direction.
  //
  // The round-1 review proposed hanging it off `--push-owned` instead. One door
  // along, and for two reasons: that mode's contract is that it judges no job's
  // health, and its push is throttled to once a day, so a recovery could have
  // waited up to 24h to be announced. This runs on the same ten-minute wake and
  // needs no ClickUp to decide — only to speak.
  //
  // Freshness is the gate, never "a beat exists": `report.fresh` means the
  // newest local beat is inside the role's own threshold, judged by the same
  // arithmetic that raised the alarm. A stale beat closing an alarm would be
  // clear-then-realarm churn instead of an honest silence.
  if (post && report.fresh.length > 0) {
    const said = closeAlarms(report.fresh.map((f) => ({
      role: f.role, quietSince: readStamp(`stale-${f.role}`),
    })));
    for (const item of said) {
      out.push(item.told ? `  ${green('CLEAR')} ${item.text}` : `  ${yellow('????')}  ${item.text}`);
    }
  }

  out.push('');
  if (report.quiet.length > 0) {
    out.push(bold(red(`${report.quiet.length} job${report.quiet.length === 1 ? ' has' : 's have'} stopped beating on this machine.`)));
  } else if (report.fresh.length > 0) {
    out.push(bold(green('Every job this machine owns is beating inside its own threshold.')));
  } else {
    out.push(bold(yellow('Nothing could be measured. This is not an all-clear — read the ???? lines.')));
  }
  out.push('');
  console.log(out.join('\n'));

  if (post && report.quiet.length > 0) {
    // Per role, so a second job going quiet is announced straight away instead
    // of being swallowed by the first one's window — the same reasoning the
    // roll call's own suppression uses.
    const toAnnounce = report.quiet.filter((q) => heartbeat.dueAgain({
      lastAt: readStamp(`stale-${q.role}`), now: NOW, everyMs: heartbeat.STALE_REPOST_EVERY_MS,
    }));
    if (toAnnounce.length === 0) {
      console.error('heartbeat: already reported these as quiet within the window — not posting again.');
    } else {
      const text = heartbeat.renderStalePost({ quiet: toAnnounce, node: NODE.name, now: NOW });
      try {
        clickup.postBusMessage(BUS_CHANNEL, text);
        const at = new Date(NOW).toISOString();
        for (const q of toAnnounce) writeStamp(`stale-${q.role}`, at);
        console.error(`heartbeat: posted to the bus about ${toAnnounce.map((q) => q.role).join(', ')} having stopped.`);
      } catch (err) {
        // Not stamped, so the next pass tries again. A failed announcement that
        // recorded itself as sent would silence the alarm for 12 hours on the
        // strength of a message nobody received.
        console.error(`heartbeat: could NOT post to the bus (${String(err && err.message).slice(0, 200)}).`);
        console.error('heartbeat: not stamping it as announced, so the next pass tries again.');
      }
    }
  }

  if (report.quiet.length > 0) return 1;
  if (report.fresh.length === 0) return 2;
  return 0;
}

// --- relaying local stamps onto the shared row -------------------------------

/**
 * `--push-owned` — carry this machine's local stamps to the shared roll call.
 *
 * THE HOLE THIS FILLS (task 86bbw9nbj). `--beat` does two things: it writes the
 * local stamp and it pushes the shared row. Every job whose runner lives in this
 * repo calls it, so both happen together. The two Pulse pipelines cannot: their
 * runner is in the pulse repo and writes only the local stamp, deliberately, so
 * that a beat needs no credential and no network call inside an unattended
 * pipeline runner. Without this mode their stamps would sit on disk for ever
 * while `rollCallReport` read the shared row, found nothing, and called two
 * healthy jobs overdue — a false alarm, which is this feature's own failure mode.
 *
 * WHY IT RIDES THE RELAY'S WAKE AND NOT A SCHEDULE OF ITS OWN. The stamps are
 * local files, so this has to run on the machine that owns the job; the relay
 * wake is already there every ten minutes on every machine that has the
 * schedule, and the plan only ever considers owned roles, so it is correct
 * wherever it runs. It also runs BEFORE the relay's ownership check, alongside
 * the watchdogs, which matters for a reason found this pass: the relay has been
 * exiting non-zero and therefore never reaching its own `--beat` line, and a
 * push hung off the success path would have gone missing in exactly the weeks
 * something was wrong.
 *
 * ONE WRITE FOR EVERY ROLE, not one per role. The description is
 * read-modify-written, so N pushes would be N round trips against a shared
 * surface two machines edit — N chances to lose an update, for no gain.
 *
 * Exit codes follow the harness convention (scripts/ui/harness-exit.mjs):
 *   0  nothing needed pushing, or everything that needed it went up
 *   2  could not tell / could not do — an unknown machine, an unreachable roll
 *      call, a refused write. NEVER rendered as "nothing to do".
 * There is no 1: this mode makes no judgement about any job's health. It moves
 * a fact from one surface to another, and the judging is `--check`'s job.
 */
async function doPushOwned() {
  const out = [];
  out.push('', bold('RELAY — are this machine\'s local beats on the shared roll call?'), '');

  if (!nodeRoles.isKnownNode(NODE.name)) {
    out.push(`  ${yellow('????')}  Cannot tell.`);
    out.push(`        ${dim(`This machine calls itself "${NODE.name || '(nothing)'}", which is not a machine this system knows.`)}`);
    out.push(`        ${dim('Without an identity there is no way to know which roles it owns, and a row pushed under the wrong')}`);
    out.push(`        ${dim('name would report a beating job as one that has never beaten.')}`);
    out.push(`        ${dim(`Fix it once:  echo ${nodeRoles.KNOWN_NODES[0]} > ${NODE.file}`)}`);
    out.push('');
    console.log(out.join('\n'));
    return 2;
  }

  const owned = nodeRoles.rolesOwnedBy(NODE.name).filter((role) => heartbeat.BEAT_EMITTERS[role]);
  const entries = owned.map((role) => ({
    role,
    beat: heartbeat.readBeat({ role }),
    lastPushAt: readStamp(`push-${role}`),
  }));
  const plan = heartbeat.rollCallPushPlan({ entries, now: NOW });

  for (const h of plan.held) out.push(`  ${dim('----')}  ${h.role} — nothing to relay: ${h.why}.`);
  for (const u of plan.unknown) {
    out.push(`  ${yellow('????')}  ${u.role} — cannot relay.`);
    out.push(`        ${dim(`cannot tell: ${u.why}`)}`);
  }
  if (entries.length === 0) {
    out.push(`  ${yellow('????')}  This machine owns no role that records a beat, so there is nothing to relay.`);
  }

  // ONE VERDICT FUNCTION FOR BOTH EXITS FROM HERE (task 86bbw9nbj, round 1
  // send-back). This branch used to answer correctly while the success branch
  // at the bottom returned 0 flat, so an unreadable stamp was downgraded to a
  // pass whenever some other role happened to push on the same wake — the same
  // condition, two verdicts, one function. It also refuses to call a machine
  // that owns no beating role an all-clear: that green line is vacuously true
  // of zero beats and reachable on macbook-pro, which owns only `db-refresh`.
  if (plan.push.length === 0) {
    const verdict = heartbeat.relayVerdict({
      ownedEmitters: entries.length, pushed: 0, unknown: plan.unknown.length,
    });
    out.push('');
    out.push(verdict.reading
      ? bold(green('Every local beat this machine owns is already on the shared roll call.'))
      : bold(yellow(`Nothing was relayed — ${verdict.why}. This is not an all-clear.`)));
    out.push('');
    console.log(out.join('\n'));
    return verdict.exit;
  }

  for (const item of plan.push) out.push(`  ${green('PUSH')}  ${item.role} — ${item.why}.`);

  const found = await findRollCall();
  if (!found.readable) {
    out.push('');
    out.push(bold(yellow('Could not reach the roll call — the local beats stand and the next wake tries again.')));
    out.push(`        ${dim(`cannot tell: ${found.why}`)}`);
    out.push('');
    console.log(out.join('\n'));
    return 2;
  }

  let task = found.task;
  if (!found.found) {
    const made = await createRollCall();
    if (!made.ok) {
      out.push('');
      out.push(bold(yellow(`No "${heartbeat.ROLL_CALL_TASK_NAME}" ticket exists and it could not be created.`)));
      out.push(`        ${dim(`cannot tell: ${made.why}`)}`);
      out.push('');
      console.log(out.join('\n'));
      return 2;
    }
    task = made.task;
  }

  const fresh = await clickup.call('GET', `/api/v2/task/${task.id}`);
  const existing = fresh.ok ? heartbeat.parseRollCall(descriptionOf(fresh.json)) : { parsed: false, rows: [] };
  // The instant pushed is the STAMP's, never NOW. That is what makes relaying
  // safe: a relay running every ten minutes over a job that died on Tuesday
  // reports Tuesday, so it can never silence the alarm it feeds.
  const incoming = plan.push.map((item) => ({ node: NODE.name, role: item.role, at: item.at }));
  const rows = heartbeat.mergeRollCall(existing.parsed ? existing.rows : [], incoming);
  if (!existing.parsed) {
    out.push(`        ${dim('the existing roll-call block could not be read — rewriting it from these beats alone')}`);
  }

  const wrote = await clickup.call('PUT', `/api/v2/task/${task.id}`, {
    markdown_description: heartbeat.renderRollCall(rows, { now: NOW }),
  });
  if (!wrote.ok) {
    out.push('');
    out.push(bold(yellow(`Could not write the roll call (HTTP ${wrote.status}). The local beats stand; nothing was stamped, so the next wake tries again.`)));
    out.push('');
    console.log(out.join('\n'));
    return 2;
  }

  // Stamped only AFTER a confirmed write, so a failed push is retried rather
  // than being recorded as done — the same discipline the bus posts above use.
  for (const item of plan.push) writeStamp(`push-${item.role}`, item.at);
  const verdict = heartbeat.relayVerdict({
    ownedEmitters: entries.length, pushed: plan.push.length, unknown: plan.unknown.length,
  });
  out.push('', bold(green(`Relayed ${plan.push.length} beat${plan.push.length === 1 ? '' : 's'} to the roll call.`)), dim(`  ${task.url}`));
  // A successful push does NOT wash out a stamp this pass could not read. The
  // relay swallows this exit code with `|| true`, so the honest 2 buys nothing
  // operationally today — it buys it the day something reads it.
  if (!verdict.reading) out.push(bold(yellow(`But ${verdict.why}. This is not an all-clear.`)));
  out.push('');
  console.log(out.join('\n'));
  return verdict.exit;
}

// --- the watchdog -----------------------------------------------------------

async function doCheck(state) {
  if (!state.readable) return; // printReport has already said CANNOT TELL.
  const quiet = state.report.overdue;
  if (quiet.length === 0) return;

  // One post per role per 6 hours. Filtering per role rather than per run
  // means a second job going quiet is announced straight away instead of being
  // swallowed by the first one's suppression window.
  const toAnnounce = quiet.filter((o) => heartbeat.dueAgain({
    lastAt: readStamp(`quiet-${o.role}`), now: NOW, everyMs: heartbeat.REPOST_EVERY_MS,
  }));
  if (toAnnounce.length === 0) {
    console.error('heartbeat: already announced within the suppression window — not posting again.');
    return;
  }

  const text = heartbeat.renderSilencePost({
    overdue: toAnnounce,
    now: NOW,
    reportedBy: NODE.name || 'an unnamed machine',
  });
  try {
    clickup.postBusMessage(BUS_CHANNEL, text);
    const at = new Date(NOW).toISOString();
    for (const o of toAnnounce) writeStamp(`quiet-${o.role}`, at);
    console.error(`heartbeat: posted to the bus about ${toAnnounce.map((o) => o.role).join(', ')}.`);
  } catch (err) {
    // The bus was down for sixteen hours on 2026-08-23. A failed announcement
    // must be loud and must NOT be recorded as sent, so the next pass retries.
    console.error(`heartbeat: could NOT post to the bus (${String(err && err.message).slice(0, 200)}).`);
    console.error('heartbeat: not stamping it as announced, so the next pass tries again.');
  }
}

// --- main -------------------------------------------------------------------

if (flag('beat')) {
  process.exit(await doBeat(arg('role')));
}

if (flag('stale-check')) {
  process.exit(await doStaleCheck({ post: flag('check') }));
}

if (flag('push-owned')) {
  process.exit(await doPushOwned());
}

const state = await loadReport();
const code = printReport(state);
if (flag('check')) await doCheck(state);
process.exit(code);
