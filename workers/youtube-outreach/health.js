'use strict';

/**
 * The posting worker's hourly look at its own browser (YouTube outreach 7/7,
 * task 86bcda6dt). Without it, a signed-out browser leaves every approved
 * comment sitting at `approved` forever, which looks exactly like a quiet week.
 *
 * Once an hour, for every account an adapter posts with, it asks two separate
 * questions, in this order:
 *
 *   1. Is OpenClaw answering at all? (lib/openclawSignIn.js probeGateway)
 *   2. If so: is that account's browser profile signed in as the right
 *      account? (the same read-only check scripts/openclaw_smoke.mjs runs)
 *
 * Each answer is written onto the account's settings row, where the YouTube
 * Outreach screen and Observe read it — nothing on the internet can reach the
 * Mini to ask (lib/youtubeOutreachStore.js recordBrowserCheck).
 *
 * THREE ALARMS, WORDED BY THEIR FIX. Signed out and signed in as someone else
 * both need Dane at the Mini's screen; OpenClaw not answering needs a service
 * restarted and no sign-in at all. Sending him to sign in when the gateway is
 * down is an alarm that names the wrong fix, so the gateway is asked first and
 * its alarm is its own sentence.
 *
 * ONCE PER SIX HOURS, CLEARED BY THE NEXT GOOD CHECK. The same discipline as
 * every other alarm here (scripts/report_job_failure.mjs): an alarm posts the
 * first time it is seen, again only if it is still true six hours later, and a
 * check that comes back good posts one line saying it cleared — the only good
 * news this ever posts, and only because an alarm went out first. A change of
 * KIND (signed out → signed in as someone else) posts at once: it is a new
 * fact with a different fix.
 *
 * "COULD NOT TELL" NEVER CLEARS AND NEVER ALARMS. An answer the check could not
 * read says nothing about the browser either way, so it leaves any open alarm
 * standing and opens none. The screen still shows it, so it never reads as
 * healthy.
 *
 * Pure apart from the seams (`deps`); no timers at module scope (DOCTRINE 5.2).
 */

const fs = require('node:fs');
const path = require('node:path');

const signIn = require('../../lib/openclawSignIn.js');

/** How often the worker checks. "Within about an hour" is the ticket's promise. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/** How long an open alarm stays quiet before it is said again. */
const REPOST_EVERY_MS = 6 * 60 * 60 * 1000;

/** The states that post to the bus. */
const ALARM_STATES = ['signed_out', 'wrong_account', 'gateway_down'];

const GATEWAY_KEY = 'gateway';

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * The sentence for one check, as the screen shows it and the bus reads it.
 * `who` is the account name the profile must be signed in as.
 */
function sentence(state, { site = 'youtube', who = 'Dane of Earth', profile = 'dane-of-earth', detail = '' } = {}) {
  const label = signIn.SITES[site]?.label || site;
  switch (state) {
    case 'signed_in':
      return `Mini: connected to ${label} as ${who}.`;
    case 'signed_out':
      return `${label} on the Mini is signed out of ${who} — open Screen Sharing to the Mini and sign in again in the ${profile} browser.`;
    case 'wrong_account':
      return `${label} on the Mini is signed in as "${detail || 'someone else'}", not ${who} — open Screen Sharing to the Mini, sign out, and sign in as ${who} in the ${profile} browser.`;
    case 'gateway_down':
      return `OpenClaw on the Mini is not answering${detail ? ` (${detail})` : ''}, so nothing can be posted. `
        + 'This is the service, not the sign-in: on the Mini run ./scripts/install_openclaw.sh --status, and --install if it is not running.';
    default:
      return `The Mini could not tell whether ${label} is signed in as ${who}${detail ? `: ${detail}` : '.'}`;
  }
}

/**
 * What the browser's answer means. `call` is the OpenClaw reply envelope;
 * `extractJson` reads the JSON out of its text.
 */
function readCall(call, site, extractJson) {
  if (!call || !call.ok) {
    // The probe found the gateway up a moment ago, so a refused connection
    // now is the gateway going down mid-check — still the gateway's alarm.
    if (call && call.status === 502 && /Failed to reach OpenClaw/i.test(text(call.error))) {
      return { state: 'gateway_down', detail: 'it stopped answering during the check' };
    }
    return { state: 'cannot_tell', detail: text(call?.error) || 'OpenClaw gave no answer' };
  }
  const verdict = signIn.judge(extractJson(call.text), site);
  if (verdict.kind === 'wrong_account') return { state: 'wrong_account', detail: verdict.name };
  if (verdict.kind === 'cannot_tell') return { state: 'cannot_tell', detail: verdict.message };
  return { state: verdict.kind, detail: verdict.name || '' };
}

/**
 * Should this key's alarm post, clear, or stay quiet? Pure; the six-hour
 * window and the clearing rule are decided here and nowhere else.
 *
 *   entry  the ledger's record for this key: { state, postedAt } or undefined
 *   state  what the check found this time
 */
function decideAlarm({ entry, state, now, everyMs = REPOST_EVERY_MS }) {
  if (ALARM_STATES.includes(state)) {
    const postedAt = Date.parse(entry?.postedAt || '');
    const fresh = entry && entry.state === state && Number.isFinite(postedAt) && now - postedAt < everyMs;
    if (fresh) return { action: 'quiet', entry };
    return { action: 'post', entry: { state, postedAt: new Date(now).toISOString() } };
  }
  if (state === 'cannot_tell') return { action: 'quiet', entry };
  // A good reading: clear what was open, say nothing if nothing was.
  return entry ? { action: 'clear', entry: undefined, was: entry.state } : { action: 'quiet', entry: undefined };
}

/** The bus wording, prefixed so a reader knows which machine and which job. */
function alarmPost(node, message) {
  return `⚠️ **YouTube outreach (${node || 'the Mini'})** — ${message}\n\n`
    + `_Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until a check comes back good; checked hourly._`;
}

function clearPost(node, message) {
  return `✅ **YouTube outreach (${node || 'the Mini'})** — cleared: ${message}`;
}

// ── The ledger: which alarms are open, and when each last posted ───────────

function readLedger(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * One check of every account, plus the alarms it calls for.
 *
 *   checks  [{ site, accountKey, profile, who, record(reading) }] — from the
 *           adapters' browserChecks(); `record` writes the settings row.
 *   deps    { probe(), ask(request), extractJson(text), post(text),
 *             readLedger(), writeLedger(ledger), node }
 *
 * Returns { results, posts, problems }. Throws nothing a seam threw.
 */
async function runHealthCheck({ checks, deps, now = Date.now() }) {
  const problems = [];
  const results = [];
  const checkedAt = new Date(now).toISOString();

  let gateway;
  try {
    gateway = await deps.probe();
  } catch (err) {
    gateway = { up: false, why: `the probe itself failed: ${err.message}` };
  }

  for (const check of checks) {
    let reading;
    if (!gateway.up) {
      reading = { state: 'gateway_down', detail: gateway.why };
    } else {
      let call;
      try {
        call = await deps.ask(signIn.signInRequest(check.site, check.profile));
      } catch (err) {
        call = { ok: false, error: `the check threw: ${err.message}` };
      }
      reading = readCall(call, check.site, deps.extractJson);
    }
    const message = sentence(reading.state, { site: check.site, who: check.who, profile: check.profile, detail: reading.detail });
    let write;
    try {
      write = await check.record({ state: reading.state, message, checkedAt });
    } catch (err) {
      write = { ok: false, error: err.message };
    }
    if (!write || !write.ok) {
      problems.push(`${check.site}/${check.accountKey}: the reading could not be saved for the screen: ${write?.error || 'no answer'}`);
    }
    results.push({ ...check, ...reading, message });
  }

  // ALARMS. The gateway is one alarm for the whole machine, however many
  // accounts it failed; each account's sign-in is its own.
  const ledger = deps.readLedger();
  const posts = [];
  const decisions = [];
  const anyGatewayDown = results.some((r) => r.state === 'gateway_down');
  if (checks.length) {
    const gw = results.find((r) => r.state === 'gateway_down');
    decisions.push({
      key: GATEWAY_KEY,
      decision: decideAlarm({ entry: ledger[GATEWAY_KEY], state: anyGatewayDown ? 'gateway_down' : 'signed_in', now }),
      message: gw ? gw.message : 'OpenClaw on the Mini is answering again.',
    });
  }
  for (const r of results) {
    // While the gateway is down the browser could not be asked: an open
    // sign-in alarm is neither confirmed nor cleared by that.
    if (r.state === 'gateway_down') continue;
    const key = `${r.site}:${r.accountKey}`;
    decisions.push({ key, decision: decideAlarm({ entry: ledger[key], state: r.state, now }), message: r.message });
  }

  for (const { key, decision, message } of decisions) {
    if (decision.action === 'quiet') continue;
    const body = decision.action === 'post' ? alarmPost(deps.node, message) : clearPost(deps.node, message);
    try {
      await deps.post(body);
    } catch (err) {
      // Not recorded as sent, so the next hourly check tries again.
      problems.push(`the ${decision.action === 'post' ? 'alarm' : 'all-clear'} for ${key} could not be posted to the bus: ${err.message}`);
      continue;
    }
    if (decision.entry) ledger[key] = decision.entry;
    else delete ledger[key];
    posts.push({ key, action: decision.action, text: body });
  }

  try {
    deps.writeLedger(ledger);
  } catch (err) {
    // Posted but not remembered: the next check may post a duplicate. Noisy,
    // and far better than an unwritable file silencing the alarm.
    problems.push(`the alarm ledger could not be written (${err.message}); an alarm may repeat early`);
  }

  return { at: checkedAt, results, posts, problems };
}

/** One line per account, for the worker's log. */
function formatHealth(run) {
  const lines = run.results.map((r) => `[outreach-health] ${r.site}/${r.accountKey}: ${r.state.toUpperCase()} — ${r.message}`);
  for (const p of run.posts) lines.push(`[outreach-health] bus: ${p.action === 'post' ? 'alarm posted' : 'all-clear posted'} for ${p.key}`);
  for (const p of run.problems) lines.push(`[outreach-health] PROBLEM: ${p}`);
  return lines.join('\n');
}

/**
 * The real seams, on the Mini. The ClickUp token comes from Doppler (the
 * worker runs under `doppler run`, scripts/install_youtube_outreach_worker.sh).
 */
function liveDeps({ node, ledgerFile, busChannel = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474' } = {}) {
  const client = require('../../lib/openclawResponsesClient');
  return {
    node,
    probe: () => signIn.probeGateway(client.getOpenClawConfig().baseUrl),
    ask: (request) => client.callOpenClawResponses(request),
    extractJson: (raw) => client.extractJsonFromText(raw),
    post: async (body) => require('../../scripts/lib/clickup.cjs').postBusMessage(busChannel, body),
    readLedger: () => readLedger(ledgerFile),
    writeLedger: (ledger) => writeLedger(ledgerFile, ledger),
  };
}

/** Where the ledger lives: beside the heartbeat stamps, in the machine's state folder. */
function defaultLedgerFile() {
  return path.join(require('../../lib/nodeHeartbeat.js').heartbeatDir(), 'youtube-outreach-alarms.json');
}

module.exports = {
  CHECK_EVERY_MS,
  REPOST_EVERY_MS,
  ALARM_STATES,
  GATEWAY_KEY,
  sentence,
  readCall,
  decideAlarm,
  alarmPost,
  clearPost,
  runHealthCheck,
  formatHealth,
  liveDeps,
  defaultLedgerFile,
  readLedger,
  writeLedger,
};
