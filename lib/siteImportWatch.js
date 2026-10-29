'use strict';

/**
 * Is a Site Import sitting in the queue with nothing picking it up?
 *
 * Ticket 86bctakm0. Dane queued an import of alphire.agency on 2026-10-13. It
 * sat in `queued` for 14 days, attempts 0, never claimed, because the worker
 * (scripts/site_import_worker.mjs) only ever ran when somebody started it by
 * hand — and nothing on the screen or the bus said nobody was going to. An
 * agent session found it on 2026-10-27 and ran the worker by hand.
 *
 * The worker now runs on a schedule (scripts/install_site_import_worker.sh,
 * role `site-import-worker` in lib/nodeRoles.js), so a queued job should be
 * claimed within minutes. This is the alarm for when it is not: any job
 * queued for more than an hour without a claim is named on the bus, ONCE per
 * job, and one all-clear goes out when it has been picked up (or cancelled).
 *
 * WHERE IT RUNS. scripts/run_bus_relay.sh calls it on the ten-minute wake of
 * the machine that OWNS the worker, and only there. That is the opposite of
 * the other watchdogs on that wake, on purpose: they post nothing per item,
 * this posts once per job, and "once" is only true with one poster — a second
 * machine keeping its own memory of what it said would say everything twice.
 * The case this check cannot see — the owning machine switched off entirely —
 * is the heartbeat's: the worker records a beat on every drain, and the roll
 * call reads that from the other machine.
 *
 * Three verdicts, never two (docs/DOCTRINE.md §3.11):
 *   OK           production was read and no job has waited over an hour
 *   WAITING      at least one job has
 *   CANNOT TELL  production could not be read — never a pass
 *
 * The pure half lives here so it can be tested without a database;
 * scripts/site_import_watch.mjs does the reading, the stamps and the posting.
 */

const VERDICT = Object.freeze({ OK: 'OK', WAITING: 'WAITING', CANNOT_TELL: 'CANNOT TELL' });
const EXIT = Object.freeze({ OK: 0, WAITING: 1, 'CANNOT TELL': 2 });

/** The ticket's number: a job queued longer than this with no claim is an alarm. */
const QUEUED_TOO_LONG_MS = 60 * 60 * 1000;

/** A CANNOT TELL is repeated at most this often, like every other watchdog. */
const CANNOT_TELL_EVERY_MS = 6 * 60 * 60 * 1000;

/** "14 days", "3 hours", "25 minutes" — the wait, in words. */
function waitText(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

/**
 * Judge one reading of the queue.
 *   jobs  — rows { id, sourceUrl, projectId, status, claimedAt, createdAt },
 *           or null when production could not be read
 *   error — why it could not be read
 */
function judge({ jobs, error = '', now = Date.now(), tooLongMs = QUEUED_TOO_LONG_MS }) {
  if (!Array.isArray(jobs)) {
    return {
      verdict: VERDICT.CANNOT_TELL,
      stale: [],
      reason: `production's import queue could not be read (${String(error || 'no reading').slice(0, 300)})`,
    };
  }
  const stale = [];
  let unreadable = 0;
  for (const job of jobs) {
    if (!job || job.status !== 'queued' || job.claimedAt) continue;
    const created = Date.parse(job.createdAt || '');
    if (!Number.isFinite(created)) {
      // A queued job with no readable date cannot be timed, and dropping it
      // would be the silent all-clear this check exists against.
      unreadable += 1;
      stale.push({ ...job, waitedMs: null });
      continue;
    }
    const waitedMs = now - created;
    if (waitedMs > tooLongMs) stale.push({ ...job, waitedMs });
  }
  if (!stale.length) {
    return { verdict: VERDICT.OK, stale, reason: 'no import has waited over an hour for the worker' };
  }
  return {
    verdict: VERDICT.WAITING,
    stale,
    reason: `${stale.length} import${stale.length === 1 ? '' : 's'} waiting over an hour with no worker`
      + (unreadable ? ` (${unreadable} with no readable queued date)` : ''),
  };
}

/**
 * What to say, given what has already been said.
 *   state — { alarmed: { [jobId]: postedAt }, cannotTellAt: '' } from the stamp file
 *
 * Returns { alarm: [jobs to name now], cleared: [jobIds no longer waiting],
 *           cannotTell: boolean, next: the state to write back after posting }.
 *
 * ONCE PER JOB: a job is named the first time it is seen waiting and never
 * again while it keeps waiting. When it stops waiting (claimed, cancelled,
 * deleted) one all-clear names it and it is forgotten. A CANNOT TELL changes
 * nothing about which jobs were already named — not being able to look is not
 * the same as the job having been picked up.
 */
function plan({ judged, state = {}, now = Date.now(), everyMs = CANNOT_TELL_EVERY_MS }) {
  const alarmed = { ...((state && state.alarmed) || {}) };
  const at = new Date(now).toISOString();

  if (judged.verdict === VERDICT.CANNOT_TELL) {
    const then = Date.parse((state && state.cannotTellAt) || '');
    const due = !(Number.isFinite(then) && now - then < everyMs);
    return {
      alarm: [],
      cleared: [],
      cannotTell: due,
      next: { alarmed, cannotTellAt: due ? at : state.cannotTellAt },
    };
  }

  const waitingIds = new Set(judged.stale.map((j) => j.id));
  const alarm = judged.stale.filter((j) => !alarmed[j.id]);
  const cleared = Object.keys(alarmed).filter((id) => !waitingIds.has(id));
  for (const job of alarm) alarmed[job.id] = at;
  for (const id of cleared) delete alarmed[id];
  return { alarm, cleared, cannotTell: false, next: { alarmed, cannotTellAt: '' } };
}

function renderAlarm({ jobs, node, at }) {
  const lines = jobs.map((j) => `• ${j.sourceUrl || '(no address)'} — job ${j.id}, `
    + (j.waitedMs == null ? 'queued at an unreadable time' : `waiting ${waitText(j.waitedMs)}`));
  return [
    `[CC-starcaster] 🔴 Site Import: ${jobs.length === 1 ? 'an import is' : `${jobs.length} imports are`} waiting with no worker to run ${jobs.length === 1 ? 'it' : 'them'}`,
    '',
    ...lines,
    '',
    'The import worker should claim a queued job within minutes; it runs every 5 minutes on the Mac Mini. '
      + 'Over an hour means it is not running.',
    'On the Mini: `./scripts/install_site_import_worker.sh --status` says whether the schedule is installed and when it last ran.',
    `Checked from ${node} at ${at}. Each job is named once; one all-clear when it is picked up.`,
  ].join('\n');
}

function renderClear({ ids, node, at }) {
  return [
    `[CC-starcaster] ✅ Site Import: ${ids.length === 1 ? 'the waiting import has' : `${ids.length} waiting imports have`} left the queue`,
    '',
    `${ids.map((id) => `job ${id}`).join(', ')} — picked up by the worker, or cancelled.`,
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

function renderCannotTell({ judged, node, at }) {
  return [
    '[CC-starcaster] ⚠️ Site Import queue — CANNOT TELL whether imports are waiting',
    '',
    judged.reason,
    '',
    'This is not a pass. Until it can read the queue again, an import that nobody picks up goes unnoticed — '
      + 'exactly what happened to alphire.agency for 14 days in October 2026.',
    `Checked from ${node} at ${at}. Re-posts every 6h while it stays this way.`,
  ].join('\n');
}

module.exports = {
  VERDICT,
  EXIT,
  QUEUED_TOO_LONG_MS,
  CANNOT_TELL_EVERY_MS,
  waitText,
  judge,
  plan,
  renderAlarm,
  renderClear,
  renderCannotTell,
};
