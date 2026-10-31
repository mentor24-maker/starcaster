'use strict';

/**
 * The Mini's daily brake on background AI (AI Quota 5/5, task 86bcvj7zw).
 *
 * An alarm tells Dane; a brake protects the money while he is asleep. On
 * Oct 28–30, 2026 the Mini's background checks drained the Anthropic account
 * two nights running. 86bcvhy8c fixed that cause; the next bug in an
 * unattended job will look the same, so every BACKGROUND OpenClaw request asks
 * this first and is refused once today's count reaches the limit on
 * Settings › AI Quota (default 40).
 *
 * ONE COUNT. The count is the meter rows AI Quota 3/5 writes for every
 * OpenClaw request (lib/openclawResponsesClient.js recordOpenClawCall) — this
 * keeps no second tally that could disagree with the page. Every OpenClaw row
 * counts, background or not: posting a reply Dane approved is never blocked
 * here, but it is spent from the same day.
 *
 * THE DAY IS MOUNTAIN TIME, because "stopped until midnight" is a sentence Dane
 * reads on his own clock. (The spending alarm's day is UTC, Anthropic's
 * billing day; the two answer different questions.)
 *
 * IT FAILS SHUT. If the limit or the count cannot be read, a background job
 * does not run: the job is retried on its next schedule, and a database blip
 * is not a reason to spend without a limit. The limit itself falls back to the
 * default when no row is saved or the setting cannot be read — a brake that
 * vanishes with its settings row is no brake.
 *
 * Reaching the limit posts ONE bus line per day, claimed atomically on the
 * alarm row so the worker, Reddit watch and the Notes search (three processes
 * on the Mini) cannot each post it.
 */

const DEFAULT_LIMIT = 40;
const LIMIT_MAX = 10000;
const TIME_ZONE = 'America/Denver';

/**
 * The jobs this limit stops, by the label their requests carry
 * (lib/openclawResponsesClient.js jobLabel). Everything else — posting an
 * approved reply, Facebook personal posts, the website's own buttons — is
 * counted and never blocked. scripts/builder/miniAiLimit.test.js checks each
 * is a label lib/aiJobs.js lists for a Mini job.
 */
const BACKGROUND_LABELS = Object.freeze([
  'starcaster:openclaw-smoke', // the sign-in check (every 6 hours, and "Check now")
  'starcaster:reddit-watch', // Reddit watch, posts and their comments
  'starcaster:substack-miner-notes-search', // Substack Notes search
  'starcaster:reddit-post-reader', // reads a Reddit thread before a reply is drafted
]);

/** What the refusal is called in an OpenClaw reply envelope. */
const STOPPED_CODE = 'MINI_AI_LIMIT';

function isBackground(label) {
  const { jobLabel } = require('./openclawResponsesClient');
  return BACKGROUND_LABELS.includes(jobLabel(label));
}

/** Wall-clock parts of `ms` in Mountain time. */
function zonedParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** How far Mountain wall-clock time is from UTC at the instant `ms`. */
function zoneOffsetMs(ms) {
  const p = zonedParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * Today in Mountain time: its date, the instant it began and the instant the
 * next one begins. Midnight is never inside a daylight-saving jump (those
 * happen at 2 AM), so one correction pass is exact.
 */
function mountainDay(now = Date.now()) {
  const p = zonedParts(now);
  const startOf = (y, m, d) => {
    const wall = Date.UTC(y, m - 1, d);
    let at = wall - zoneOffsetMs(wall);
    at = wall - zoneOffsetMs(at);
    return at;
  };
  const start = startOf(p.year, p.month, p.day);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = startOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return { day, startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

/** "3:12 AM", on Mountain time. */
function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
}

/**
 * Where today stands. Pure. `calls` are today's OpenClaw meter rows, oldest
 * first (`created_at`). The limit was reached by the `limit`-th request, so
 * that row's time is when it stopped.
 */
function limitStatus({ limit, calls, now = Date.now() }) {
  const n = Math.max(0, Math.floor(Number(limit) || 0));
  const rows = Array.isArray(calls) ? calls : [];
  const day = mountainDay(now);
  const reached = rows.length >= n;
  const reachedAt = reached ? (n > 0 ? String(rows[n - 1]?.created_at || '') : day.startIso) : null;
  return {
    day: day.day,
    limit: n,
    used: rows.length,
    reached,
    reachedAt,
    resetsAt: day.endIso,
    sentence: reached ? stoppedSentence({ limit: n, reachedAt }) : '',
  };
}

/** The one sentence every surface shows, worded as the ticket asked. */
function stoppedSentence({ limit, reachedAt }) {
  return `Stopped for today: the Mini's AI limit (${limit} request${limit === 1 ? '' : 's'}) was reached at ${clock(reachedAt)}. `
    + 'Background checks start again at midnight (Mountain time); posting approved replies is not stopped.';
}

function busLine(status, node) {
  const byJob = status.byJob && Object.keys(status.byJob).length
    ? ` Today so far: ${Object.entries(status.byJob).sort((a, b) => b[1] - a[1]).map(([job, n]) => `${job.replace(/^starcaster:/, '')} ${n}`).join(', ')}.`
    : '';
  return `🛑 **Mini AI limit (${node || 'the Mini'})** — ${status.sentence}${byJob} `
    + 'Change the limit on Settings › AI Quota.';
}

function tallyJobs(calls) {
  const out = {};
  for (const row of Array.isArray(calls) ? calls : []) {
    const job = String(row?.metadata?.job || row?.metadata?.feature || 'unlabelled');
    out[job] = (out[job] || 0) + 1;
  }
  return out;
}

function liveDeps() {
  return {
    readAlarm: () => require('./aiSpendAlarmStore').readAlarm(),
    readCalls: (sinceIso) => require('./observeStore').getOpenClawCallsSince(sinceIso),
    claimPost: (day) => require('./aiSpendAlarmStore').claimMiniLimitPost(day),
    releasePost: (day) => require('./aiSpendAlarmStore').releaseMiniLimitPost(day),
    postBus: (text) => require('./clickupForward').postBusMessage(text),
    node: (() => {
      if (process.env.VERCEL) return 'refused on the website';
      try {
        const roles = require('./nodeRoles');
        const { name } = roles.thisNode();
        return roles.isKnownNode(name) ? name : '';
      } catch { return ''; }
    })(),
  };
}

/**
 * Today's reading: the limit in force and how much of it is used.
 * `{ ok: true, data: status }`, or `{ ok: false, error }` when it cannot tell.
 */
async function readLimitStatus(deps = liveDeps(), now = Date.now()) {
  const alarm = await deps.readAlarm();
  // An unreadable settings row still leaves a brake: the default one.
  const limit = alarm && alarm.ok ? alarm.data.miniDailyRequests : DEFAULT_LIMIT;
  const day = mountainDay(now);
  const calls = await deps.readCalls(day.startIso);
  if (!calls || !calls.ok) {
    return { ok: false, error: `Today's count of the Mini's AI requests could not be read: ${calls?.error || 'no answer'}` };
  }
  const status = limitStatus({ limit, calls: calls.data, now });
  status.byJob = tallyJobs(calls.data);
  status.limitSource = alarm && alarm.ok ? (alarm.data.exists ? 'saved' : 'default') : 'default (the setting could not be read)';
  return { ok: true, data: status };
}

/** Post the once-a-day line, if this process is the first to claim the day. */
async function announceOnce(status, deps) {
  let claimed;
  try {
    claimed = await deps.claimPost(status.day);
  } catch (err) {
    claimed = { ok: false, error: err.message };
  }
  if (!claimed || !claimed.ok) {
    console.warn(`[mini-ai-limit] could not claim today's bus line: ${claimed?.error || 'no answer'}`);
    return { posted: false };
  }
  if (!claimed.data) return { posted: false, already: true };
  let sent;
  try {
    sent = await deps.postBus(busLine(status, deps.node));
  } catch (err) {
    sent = { ok: false, why: err.message };
  }
  if (sent && sent.ok) return { posted: true };
  // Not delivered: give the day back so the next refusal tries again.
  console.warn(`[mini-ai-limit] the bus line was not delivered: ${sent?.why || 'no answer'}`);
  try { await deps.releasePost(status.day); } catch { /* the next day still posts */ }
  return { posted: false };
}

/**
 * May this OpenClaw request go? Only background labels are ever refused.
 * `{ allowed: true }` or `{ allowed: false, error, code }` — never throws.
 */
async function checkRequest(label, deps = null, now = Date.now()) {
  if (!isBackground(label)) return { allowed: true };
  try {
    const d = deps || liveDeps();
    const read = await readLimitStatus(d, now);
    if (!read.ok) {
      return { allowed: false, code: STOPPED_CODE, error: `Not run: ${read.error}. It tries again on its next schedule.` };
    }
    if (!read.data.reached) return { allowed: true, status: read.data };
    const announced = await announceOnce(read.data, d);
    return { allowed: false, code: STOPPED_CODE, error: read.data.sentence, status: read.data, announced };
  } catch (err) {
    return { allowed: false, code: STOPPED_CODE, error: `Not run: the Mini's AI limit could not be checked (${err.message}).` };
  }
}

module.exports = {
  DEFAULT_LIMIT,
  LIMIT_MAX,
  TIME_ZONE,
  BACKGROUND_LABELS,
  STOPPED_CODE,
  isBackground,
  mountainDay,
  limitStatus,
  stoppedSentence,
  busLine,
  tallyJobs,
  readLimitStatus,
  checkRequest,
};
