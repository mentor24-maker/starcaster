'use strict';

/**
 * The Mini's posting worker (YouTube outreach 5/7, task 86bcda68h). The first
 * thing in Starcaster that says something in public under a real name.
 *
 * One long-running process, kept alive by launchd
 * (scripts/install_youtube_outreach_worker.sh). Every couple of minutes it asks
 * each site adapter for approved comments, checks that site's own limits, and
 * posts AT MOST ONE comment per site per pass through OpenClaw's signed-in
 * browser on this machine. Nothing on the internet calls the Mini; the worker
 * reaches out to Supabase and to OpenClaw at 127.0.0.1, and that is all.
 *
 * ONE WORKER, MANY SITES. Dane asked for a Substack Notes agent the same week
 * (epic substack-notes), and the Mini should run one posting worker, not one
 * per site. So this file owns what every site shares — the loop, the beat, the
 * three rules below — and each site is an adapter in ./adapters/ (the contract
 * is written at the top of ./adapters/youtube.js). Substack Notes 6/7 added
 * ./adapters/substack.js and its line in ADAPTERS (task 86bcet7qr).
 *
 * THE THREE RULES THIS FILE OWNS, so no adapter can loosen them:
 *
 *   1. Limits before posting. An adapter says "wait" (with a reason Dane can
 *      read) and the comment stays `approved`; the reason is written onto the
 *      row so the screen can show it.
 *
 *   2. Never post twice. A comment is moved `approved -> posting` BEFORE the
 *      browser is asked, by a write guarded on `approved`. Only `approved` rows
 *      are ever offered to a site, so a row left `posting` — the worker killed
 *      mid-post, a reply that proves nothing — is never offered again. The
 *      screen shows it as "check this one by hand".
 *
 *   3. Proof or it did not happen. `posted` needs a link back from the browser
 *      AND the site's own record of a comment at that link saying the approved
 *      words (adapter.verify). Anything the browser says is a claim; on
 *      2026-07-19 an agent claimed a Facebook post that never happened (fixed
 *      in b0ec0724). No link is `failed`. A link the site disowns is `failed`.
 *      A link nobody could check is left `posting` for a person, because
 *      calling it failed could hide a comment that is live.
 *
 * NO TIMERS AT MODULE SCOPE (DOCTRINE 5.2). `runPass` is what the tests drive
 * and schedules nothing; `runPoster` is the loop and runs only when called.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** The role this worker beats under. Must match lib/nodeRoles.js. */
const ROLE = 'youtube-outreach-worker';

/** How long between passes. "Within about 2 minutes" is the ticket's promise. */
const DEFAULT_PASS_EVERY_MS = 2 * 60 * 1000;

/** How often a beat is written — every pass would do, this keeps the file quiet. */
const DEFAULT_BEAT_EVERY_MS = 5 * 60 * 1000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Settle one comment the browser was asked to post. Pure of timers; every
 * outcome is one of `posted`, `failed`, `hand-check`, and the row is written
 * to match. This IS rule 3, and it is the function the break-test targets.
 */
async function settle(adapter, item, attempt) {
  // The browser said it could not, in its own words: nothing went out.
  if (!attempt.ok && !attempt.uncertain) {
    const res = await adapter.markFailed(item, { error: attempt.error });
    return { outcome: 'failed', why: attempt.error, write: res };
  }
  // The request broke off, or the answer could not be read: it MAY be live.
  if (!attempt.ok) {
    const res = await adapter.flagForHandCheck(item, {
      error: `${attempt.error} — it may or may not have posted, so it will not be tried again. Check the video by hand.`,
    });
    return { outcome: 'hand-check', why: attempt.error, write: res };
  }

  const kept = attempt.screenshot !== undefined && typeof adapter.keepScreenshot === 'function'
    ? await adapter.keepScreenshot(item, attempt.screenshot)
    : { note: '' };
  const evidence = { screenshotUrl: kept.url || '', note: kept.note || '' };

  if (!text(attempt.url)) {
    const why = 'The browser said it posted but returned no link to the comment, so it is not counted as posted.'
      + (attempt.said ? ` It said: ${attempt.said}` : '');
    const res = await adapter.markFailed(item, { error: why, ...evidence });
    return { outcome: 'failed', why, write: res };
  }

  // The whole answer goes along: a like or a restack has no link of its own,
  // and is proven from the page state the browser reported (adapters/substack.js).
  const check = await adapter.verify(item, attempt.url, attempt);
  if (check.verdict === 'proven') {
    const res = await adapter.markPosted(item, { url: attempt.url, ...evidence });
    return { outcome: 'posted', why: '', write: res };
  }
  if (check.verdict === 'refuted') {
    const res = await adapter.markFailed(item, { error: check.reason, url: attempt.url, ...evidence });
    return { outcome: 'failed', why: check.reason, write: res };
  }
  const res = await adapter.flagForHandCheck(item, { error: check.reason, url: attempt.url, ...evidence });
  return { outcome: 'hand-check', why: check.reason, write: res };
}

/**
 * One site, one pass: note why each waiting comment waits, and post the first
 * one its limits allow. Returns a report; throws nothing an adapter threw.
 */
async function passForAdapter(adapter, now) {
  const report = { site: adapter.name, posted: null, waiting: [], error: null };
  try {
    if (typeof adapter.beginPass === 'function') adapter.beginPass();
    const listed = await adapter.listApproved();
    if (!listed.ok) {
      report.error = `could not read the approved comments: ${listed.error}`;
      return report;
    }
    report.approved = listed.data.length;
    // An ACCOUNT-wide wait (daily maximum, hours, gap) holds every later comment
    // on that account for this pass. The gap's random extra is worked out per
    // comment, so asking again for the next comment could draw a smaller one
    // and let it jump the queue — posts too close together, newest first
    // (round-1 review of 86bcda68h). An item's OWN hold still holds only it.
    const heldAccounts = new Map(); // accountKey -> the reason the oldest waits
    for (const item of listed.data) {
      const account = text(item.accountKey);
      let verdict = await adapter.checkLimits(item, now);
      if (heldAccounts.has(account) && (verdict.ok || verdict.scope === 'account')) {
        verdict = { ok: false, scope: 'account', reason: heldAccounts.get(account) };
      }
      if (!verdict.ok) {
        if (verdict.scope === 'account' && !heldAccounts.has(account)) heldAccounts.set(account, verdict.reason);
        report.waiting.push({ id: item.id, reason: verdict.reason });
        // Written only when it changes, so a comment waiting all night is one
        // write, not one every two minutes.
        if (text(item.waitReason) !== text(verdict.reason)) await adapter.noteWaiting(item, verdict.reason);
        continue;
      }

      // RULE 2. Taken before the browser is asked; a 409 means another taker
      // won (or it was un-approved), and this pass leaves it alone.
      const taken = await adapter.markPosting(item);
      if (!taken.ok) {
        report.skipped = { id: item.id, why: taken.error };
        continue;
      }

      let attempt;
      try {
        attempt = await adapter.post(item);
      } catch (err) {
        attempt = { ok: false, uncertain: true, error: `posting threw: ${err.message}` };
      }
      const settled = await settle(adapter, item, attempt);
      report.posted = { id: item.id, outcome: settled.outcome, why: settled.why };
      if (settled.write && !settled.write.ok) {
        report.posted.writeProblem = settled.write.error;
      }
      break; // one comment per site per pass; the limits are re-read next pass
    }
  } catch (err) {
    report.error = err.message;
  }
  return report;
}

/** Every site, one pass. A site that fails does not stop the others. */
async function runPass({ adapters, now = Date.now() }) {
  const reports = [];
  for (const adapter of adapters) reports.push(await passForAdapter(adapter, now));
  return { at: new Date(now).toISOString(), reports };
}

/** One line per site, in the shape a person reads at 8am with no context. */
function formatPass(pass) {
  return pass.reports.map((r) => {
    const head = `[outreach-poster] ${r.site}`;
    if (r.error) return `${head}: COULD NOT RUN — ${r.error}`;
    if (r.posted) {
      const words = {
        posted: 'POSTED and proven',
        failed: 'FAILED',
        'hand-check': 'NEEDS A HAND CHECK (not retried)',
      }[r.posted.outcome];
      return `${head}: comment ${r.posted.id} ${words}${r.posted.why ? ` — ${r.posted.why}` : ''}`
        + `${r.posted.writeProblem ? ` — AND the row could not be updated: ${r.posted.writeProblem}` : ''}`;
    }
    if (!r.approved) return `${head}: nothing approved to post`;
    const first = r.waiting[0];
    return `${head}: ${r.approved} approved, none posted — ${first ? first.reason : 'nothing was allowed'}`;
  }).join('\n');
}

// ── Configuration, read once at start ──────────────────────────────────────

/** The value of NAME in a KEY=value file, never printed. */
function readEnvFileValue(file, name) {
  let body;
  try { body = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  const line = body.split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}

/**
 * Point the OpenClaw client at THIS machine, and refuse anything else.
 *
 * lib/openclawResponsesClient.js prefers a value saved in Settings > APIs over
 * the environment, and a stale entry there (the July EC2 gateway) would send
 * the gateway token — and Dane's signed-in browser — across the internet. So
 * this checks the address the client WILL use, exactly as
 * scripts/openclaw_smoke.mjs does, and the worker does not start on anything
 * that is not loopback.
 */
function configureOpenClaw(env = process.env, homedir = os.homedir()) {
  if (!text(env.OPENCLAW_BASE_URL)) env.OPENCLAW_BASE_URL = 'http://127.0.0.1:18789';
  if (!text(env.OPENCLAW_API_KEY)) {
    env.OPENCLAW_API_KEY = readEnvFileValue(path.join(homedir, '.openclaw', '.env'), 'OPENCLAW_GATEWAY_TOKEN');
  }
  if (!text(env.OPENCLAW_API_KEY)) {
    return { ok: false, why: 'no OpenClaw gateway token: set OPENCLAW_API_KEY, or install OpenClaw here (./scripts/install_openclaw.sh)' };
  }
  const { getOpenClawConfig } = require('../../lib/openclawResponsesClient');
  const { baseUrl } = getOpenClawConfig();
  let host = '';
  try { host = new URL(baseUrl).hostname; } catch { /* reported below */ }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    return { ok: false, why: `refusing to talk to OpenClaw at "${baseUrl}": only this machine is allowed. A saved setting (Settings > APIs > OpenClaw) is overriding it — clear it.` };
  }
  return { ok: true, baseUrl };
}

/** The project's time zone, for the active hours when the account sets none. */
async function readProjectTimeZone(projectId) {
  const { sbQuery } = require('../../lib/supabase');
  const table = String(process.env.SUPABASE_PROJECTS_TABLE || 'app_projects').trim();
  const res = await sbQuery({ method: 'GET', table, query: `id=eq.${encodeURIComponent(projectId)}&select=timezone&limit=1` });
  const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
  return text(row?.timezone);
}

/**
 * THE ADAPTER LIST. One entry per site. YouTube, then Substack (6/7).
 * Each builder returns an adapter or throws a sentence saying what is missing.
 */
const ADAPTERS = [
  {
    name: 'youtube',
    build: (env) => require('./adapters/youtube.js').createYoutubeAdapter({
      projectId: text(env.YOUTUBE_OUTREACH_PROJECT_ID),
      expectedChannelId: text(env.YOUTUBE_OUTREACH_CHANNEL_ID),
      projectTimeZone: readProjectTimeZone,
    }),
  },
  {
    name: 'substack',
    // Dane of Earth is one project on both sites, so the YouTube setting serves
    // when no Substack one is given; the installer needs nothing new.
    build: (env) => require('./adapters/substack.js').createSubstackAdapter({
      projectId: text(env.SUBSTACK_NOTES_PROJECT_ID) || text(env.YOUTUBE_OUTREACH_PROJECT_ID),
      projectTimeZone: readProjectTimeZone,
    }),
  },
];

function buildAdapters(env = process.env, list = ADAPTERS) {
  const built = [];
  const problems = [];
  for (const entry of list) {
    try {
      built.push(entry.build(env));
    } catch (err) {
      problems.push(`${entry.name}: ${err.message}`);
    }
  }
  return { adapters: built, problems };
}

/**
 * The loop. Runs until SIGTERM/SIGINT, finishing the pass in flight first —
 * stopping mid-post would leave a row `posting` for a person to check, which
 * is safe but avoidable.
 */
async function runPoster(options = {}) {
  const {
    env = process.env,
    passEveryMs = DEFAULT_PASS_EVERY_MS,
    beatEveryMs = DEFAULT_BEAT_EVERY_MS,
    stopAfterPasses = 0,
    clock = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    write = (line) => process.stdout.write(`${line}\n`),
    recordBeat = null,
    node = os.hostname(),
  } = options;

  let adapters = options.adapters;
  if (!adapters) {
    const openclaw = configureOpenClaw(env);
    if (!openclaw.ok) throw new Error(openclaw.why);
    const built = buildAdapters(env);
    for (const problem of built.problems) write(`[outreach-poster] a site is OFF — ${problem}`);
    if (!built.adapters.length) throw new Error('no site could be set up, so there is nothing to post (see the lines above)');
    adapters = built.adapters;
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  const ownsSignals = !stopAfterPasses;
  if (ownsSignals) {
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }
  write(`[outreach-poster] starting — sites: ${adapters.map((a) => a.name).join(', ')}; a pass every ${Math.round(passEveryMs / 1000)}s`);

  let lastBeat = 0;
  let lastLine = '';
  let passes = 0;
  while (!stopping) {
    const pass = await runPass({ adapters, now: clock() });
    const line = formatPass(pass);
    // AN IDLE NIGHT IS ONE LINE, NOT 300. launchd's log has no rotation, so a
    // line is written only when it differs from the last one — every post,
    // failure and change of reason still lands, with its time.
    if (line !== lastLine) {
      write(`${pass.at}\n${line}`);
      lastLine = line;
    }

    // LIVENESS, NOT SUCCESS: recorded whatever the pass concluded, so a quiet
    // weekend with nothing approved never reads as a dead worker.
    const beatAt = clock();
    if (beatAt - lastBeat >= beatEveryMs) {
      lastBeat = beatAt;
      try {
        const beat = recordBeat || require('../../lib/nodeHeartbeat.js').recordBeat;
        beat({ role: ROLE, node, at: new Date(beatAt).toISOString() });
      } catch (err) {
        write(`[outreach-poster] could not record the heartbeat: ${err.message} — posting continues`);
      }
    }

    passes += 1;
    if (stopAfterPasses && passes >= stopAfterPasses) break;
    if (!stopping) await sleep(passEveryMs);
  }

  if (ownsSignals) {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
  write(`[outreach-poster] stopped after ${passes} pass(es).`);
  return { passes };
}

module.exports = {
  runPass,
  runPoster,
  settle,
  passForAdapter,
  formatPass,
  configureOpenClaw,
  buildAdapters,
  ADAPTERS,
  ROLE,
  DEFAULT_PASS_EVERY_MS,
};

if (require.main === module) {
  runPoster().catch((err) => {
    process.stderr.write(`[outreach-poster] stopped: ${err.message}\n`);
    process.exit(1);
  });
}
